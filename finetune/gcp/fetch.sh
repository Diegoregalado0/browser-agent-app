#!/bin/bash
# Downloads a finished run (adapter, GGUF adapter, metrics, logs) from the bucket into
# finetune/gcp/out/RUN_ID and makes sure a GGUF adapter exists. The VM normally converts the
# adapter itself; when it did not, this converts it locally with llama.cpp's
# convert_lora_to_gguf.py, which reads the base model's config from Hugging Face (no weights). That
# works for adapters trained on a 4-bit base too; if it still fails and the run was made with
# MERGE_16BIT=1, the merged 16-bit model is converted to a bf16 GGUF instead.
#
# Usage: finetune/gcp/fetch.sh [--dry-run] RUN_ID
# Serve with: llama-server -m <base>.gguf --lora finetune/gcp/out/RUN_ID/adapter.gguf
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=finetune/gcp/config.sh
. "$HERE/config.sh"

RUN_ID=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    -*) echo "unknown option $1" >&2; exit 1 ;;
    *) RUN_ID=$1 ;;
  esac
  shift
done
[ -n "$RUN_ID" ] || { echo "usage: fetch.sh [--dry-run] RUN_ID" >&2; exit 1; }
model_profile "$BASE_MODEL"

LLAMA_CPP="${LLAMA_CPP:-$HOME/llama.cpp}"
PYTHON="${PYTHON:-python3}"
OUT="$HERE/out/$RUN_ID"
SRC="$BUCKET/runs/$RUN_ID"

run mkdir -p "$OUT"
run gcloud storage cp -r "$SRC/*" "$OUT/"
if [ "${DRY_RUN:-0}" != "1" ]; then
  status=$(cat "$OUT/STATUS" 2>/dev/null || echo missing)
  echo "run status: $status"
  [ -d "$OUT/adapter" ] || { echo "no adapter in $SRC; see $OUT/browsby-ft.log" >&2; exit 1; }
fi

if [ "${DRY_RUN:-0}" = "1" ] || [ ! -f "$OUT/adapter.gguf" ]; then
  if ! run "$PYTHON" "$LLAMA_CPP/convert_lora_to_gguf.py" --base-model-id "$HF_MODEL" \
    --outtype f16 --outfile "$OUT/adapter.gguf" "$OUT/adapter"; then
    # The adapter converter rejected the adapter: use the 16-bit merge (a run with MERGE_16BIT=1)
    # and requantize it to the served format (llama-quantize, for example to Q8_0 or IQ4_XS).
    [ -d "$OUT/merged" ] || { echo "conversion failed and the run has no merged model; rerun with MERGE_16BIT=1" >&2; exit 1; }
    run "$PYTHON" "$LLAMA_CPP/convert_hf_to_gguf.py" --outtype bf16 --outfile "$OUT/merged-bf16.gguf" "$OUT/merged"
    echo "merged: $OUT/merged-bf16.gguf (requantize with llama-quantize, serve it with its mmproj instead of --lora)"
    exit 0
  fi
fi
echo "adapter: $OUT/adapter.gguf"
