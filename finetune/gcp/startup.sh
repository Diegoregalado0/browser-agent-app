#!/bin/bash
# Startup script of the training VM. It reads its settings from instance metadata, installs
# Unsloth, pulls the data from the bucket, trains, converts the adapter to GGUF, uploads the
# adapter, GGUF, metrics and logs to gs://BUCKET/runs/RUN_ID/, and then deletes its own VM
# (falling back to a power-off). A watchdog powers the VM off after max_hours whatever happens,
# and the VM was also created with --max-run-duration and termination action DELETE.
set -uo pipefail

MD=http://metadata.google.internal/computeMetadata/v1
meta() { curl -sf -H "Metadata-Flavor: Google" "$MD/instance/attributes/$1"; }
NAME=$(curl -sf -H "Metadata-Flavor: Google" "$MD/instance/name")
ZONE=$(curl -sf -H "Metadata-Flavor: Google" "$MD/instance/zone" | awk -F/ '{print $NF}')

BUCKET=$(meta bucket)
RUN_ID=$(meta run_id)
HF_MODEL=$(meta hf_model)
LOADER=$(meta loader)
LOAD_4BIT=$(meta load_4bit)
MAX_HOURS=$(meta max_hours)
TRAIN_ARGS=$(meta train_args)
UNSLOTH_SPEC=$(meta unsloth_spec)
DEST="$BUCKET/runs/$RUN_ID"
WORK=/opt/browsby-ft
LOG=/var/log/browsby-ft.log
mkdir -p "$WORK"
exec > >(tee -a "$LOG") 2>&1

finish() {
  local status=$1
  echo "$(date -u +%FT%TZ) finished with status $status"
  echo "$status" > "$WORK/STATUS"
  gcloud storage cp "$WORK/STATUS" "$LOG" "$DEST/" || true
  touch "$WORK/done"
  gcloud compute instances delete "$NAME" --zone "$ZONE" --quiet || poweroff
  poweroff
  exit 0
}

# A reboot after the run (for example a Spot restart) must not train again.
if [ -f "$WORK/done" ]; then
  gcloud compute instances delete "$NAME" --zone "$ZONE" --quiet || poweroff
  poweroff
  exit 0
fi

# Hard stop: power off after max_hours even if training or the upload hangs.
( sleep "$(( ${MAX_HOURS:-4} * 3600 ))"; echo "watchdog: max runtime reached"; gcloud storage cp "$LOG" "$DEST/" ; poweroff ) &

# Logs reach the bucket every five minutes, so a preempted run still leaves a trace.
( while sleep 300; do gcloud storage cp "$LOG" "$DEST/" >/dev/null 2>&1; done ) &

echo "$(date -u +%FT%TZ) run $RUN_ID on $NAME ($ZONE): $HF_MODEL loader=$LOADER 4bit=$LOAD_4BIT"
nvidia-smi || { sleep 120; nvidia-smi || finish driver-missing; }

cd "$WORK" || finish no-workdir
gcloud storage cp "$DEST/data/train.jsonl" "$DEST/data/eval.jsonl" "$DEST/train.py" . || finish data-download-failed

python3 -m venv venv || { apt-get update -y && apt-get install -y python3-venv && python3 -m venv venv; } || finish venv-failed
# shellcheck disable=SC1091
. venv/bin/activate
pip install --upgrade pip >/dev/null
# shellcheck disable=SC2086
pip install $UNSLOTH_SPEC || finish install-failed
pip freeze > pip-freeze.txt

# Training stops itself and saves 30 minutes before the watchdog fires.
DEADLINE=$(( $(date +%s) + ${MAX_HOURS:-4} * 3600 - 1800 ))
FOURBIT=""
[ "$LOAD_4BIT" = "1" ] && FOURBIT="--load-4bit"
# shellcheck disable=SC2086
python train.py --model "$HF_MODEL" --loader "$LOADER" $FOURBIT --train train.jsonl --eval eval.jsonl \
  --out out --deadline "$DEADLINE" $TRAIN_ARGS || finish train-failed
gcloud storage cp -r out/adapter out/metrics.json pip-freeze.txt "$DEST/" || finish upload-failed

# The 16-bit merge (MERGE_16BIT=1) is the fallback when the GGUF adapter cannot be used.
if [ -d out/merged ]; then
  gcloud storage cp -r out/merged "$DEST/" || echo "merged model upload failed"
fi

# GGUF adapter for llama-server --lora. The converter reads only the adapter tensors and the base
# model's config (fetched from Hugging Face, no weights), so an adapter trained on a 4-bit base
# converts the same way as one trained on a bf16 base.
if git clone --depth 1 https://github.com/ggml-org/llama.cpp && pip install -q gguf sentencepiece \
  && python llama.cpp/convert_lora_to_gguf.py --base-model-id "$HF_MODEL" --outtype f16 --outfile out/adapter.gguf out/adapter; then
  gcloud storage cp out/adapter.gguf "$DEST/" || true
else
  echo "GGUF conversion failed; fetch.sh can convert locally"
fi

finish ok
