#!/bin/bash
# Teacher runs: Gemini on Vertex AI works through the train split of the extended task set,
# and its successful runs become fine-tuning trajectories. Billed to the Google Cloud
# project, under the spend ledger's dollar ceiling (see run.js).
#
# Waits until no bench-* tmux session exists and the shared bench lock is free, holds the
# lock for one pass over the train tasks at a time (so a local GPU benchmark queued meanwhile
# waits instead of sharing the CPU), and after each pass exports trajectories and copies
# results to the backup bucket.
#
# Usage: teacher-run.sh [passes]   (default 5)
# Env:   MODEL (gemini-3.8-flash), MAX_USD (15), TIMEOUT_MS (300000), POLL_S (300),
#        BUCKET (gs://YOUR_GCS_BUCKET), GCLOUD_PROJECT (YOUR_GCP_PROJECT)
# Auth:  short-lived access tokens for the teacher service account, which run.js gets from
#        gcloud by impersonation as GCLOUD_ACCOUNT; no key or token is stored.
set -u
export PATH="$HOME/google-cloud-sdk/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
PASSES="${1:-5}"
MODEL="${MODEL:-gemini-3.8-flash}"
MAX_USD="${MAX_USD:-15}"
TIMEOUT_MS="${TIMEOUT_MS:-300000}"
POLL_S="${POLL_S:-300}"
BUCKET="${BUCKET:-gs://YOUR_GCS_BUCKET}"
GCLOUD_PROJECT="${GCLOUD_PROJECT:-YOUR_GCP_PROJECT}"
GCLOUD_ACCOUNT="YOUR_GCP_ACCOUNT"
TEACHER_SA="browsby-teacher@$GCLOUD_PROJECT.iam.gserviceaccount.com"
RESULTS="$HOME/bench-results"
OUT="$RESULTS/teacher"
LEDGER="$RESULTS/cloud-spend.json"
mkdir -p "$OUT"
LOG="$OUT/teacher-$(date +%Y%m%d-%H%M%S).log"
say() { echo "$(date '+%F %T') $*" | tee -a "$LOG"; }

gcloud auth print-access-token --impersonate-service-account="$TEACHER_SA" --account="$GCLOUD_ACCOUNT" >/dev/null 2>&1 \
  || { say "gcloud cannot issue a token for $TEACHER_SA as $GCLOUD_ACCOUNT; stopping"; exit 1; }

bench_sessions() { tmux ls -F '#{session_name}' 2>/dev/null | grep '^bench-'; }

# Only this project's account and billing, never another one gcloud may know.
backup() {
  gcloud storage rsync --recursive --project "$GCLOUD_PROJECT" --account "$GCLOUD_ACCOUNT" \
    "$OUT" "$BUCKET/teacher" >>"$LOG" 2>&1 || say "backup to $BUCKET failed (see log)"
}

cd "$REPO" || exit 1
for pass in $(seq 1 "$PASSES"); do
  while :; do
    s=$(bench_sessions)
    [ -z "$s" ] && break
    say "waiting: bench sessions running ($(echo $s | tr '\n' ' '))"
    sleep "$POLL_S"
  done
  exec 9>"$RESULTS/.bench.lock"
  say "pass $pass/$PASSES: waiting for the bench lock"; flock 9; say "lock taken"
  if [ -n "$(bench_sessions)" ]; then
    say "a bench session started meanwhile; releasing the lock"
    exec 9>&-
    continue
  fi
  export BROWSER_AGENT_HOME="$(mktemp -d)"
  unset BROWSER_AGENT_CHROME
  touch "$OUT/.start"
  say "pass $pass: $MODEL on the train split, ceiling \$$MAX_USD"
  xvfb-run -a -s "-screen 0 1920x1080x24" node scripts/bench/run.js --provider gemini --model "$MODEL" \
    --taskfile tasks-extended.js --split train --runs 1 --timeout "$TIMEOUT_MS" \
    --max-usd "$MAX_USD" --ledger "$LEDGER" --vertex-project "$GCLOUD_PROJECT" \
    --vertex-sa "$TEACHER_SA" --gcloud-account "$GCLOUD_ACCOUNT" >>"$LOG" 2>&1
  code=$?
  rm -rf "$BROWSER_AGENT_HOME"
  find bench-results -maxdepth 1 -newer "$OUT/.start" -name "gemini-*" -exec cp -r {} "$OUT"/ \; 2>/dev/null
  exec 9>&-
  node scripts/finetune/export-trajectories.js --in "$OUT" --out "$OUT/trajectories.jsonl" >>"$LOG" 2>&1
  backup
  say "pass $pass done (exit $code); ledger: $(node -e "console.log(JSON.parse(require('fs').readFileSync('$LEDGER','utf8')).spentUsd.toFixed(2))" 2>/dev/null) USD"
  [ "$code" = 3 ] && { say "spend ceiling reached; stopping"; break; }
  [ "$code" = 0 ] || { say "run.js failed; stopping"; break; }
done
say "teacher runs finished; trajectories in $OUT/trajectories.jsonl"
