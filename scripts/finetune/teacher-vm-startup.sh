#!/bin/bash
# Startup script for a one-off Compute Engine VM that runs teacher-run.sh away from the
# local benchmark host, then deletes itself. Runs as root at boot.
#
# Instance metadata: bucket (gs://...), max-usd, passes. The VM's attached service account
# authorizes Vertex AI and the bucket, so no key or token is passed in. The code comes from
# <bucket>/vm/teacher-data.bundle (a git bundle of the teacher-data branch); progress, the
# run log, the spend ledger and results go to <bucket>/vm/ every few minutes and at the end.
set -u
MD=http://metadata.google.internal/computeMetadata/v1
md() { curl -sf -H 'Metadata-Flavor: Google' "$MD/$1"; }
NAME=$(md instance/name)
ZONE=$(md instance/zone | sed 's|.*/||')
BUCKET=$(md instance/attributes/bucket)
MAX_USD=$(md instance/attributes/max-usd)
PASSES=$(md instance/attributes/passes)
export PATH="/snap/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
U=teacher
H=/home/$U
# runuser keeps the working directory, and the teacher user cannot read root's.
cd /tmp
PROGRESS=/var/log/teacher-progress.txt

say() {
  echo "$(date -u +%FT%TZ) $*" | tee -a "$PROGRESS"
  gcloud storage cp -q "$PROGRESS" "$BUCKET/vm/progress.txt" >/dev/null 2>&1 || true
}

sync_up() {
  [ -d "$H/app/bench-results" ] && gcloud storage rsync -q --recursive "$H/app/bench-results" "$BUCKET/vm/app-bench-results" >/dev/null 2>&1
  [ -d "$H/bench-results" ] && gcloud storage rsync -q --recursive "$H/bench-results" "$BUCKET/vm/bench-results" >/dev/null 2>&1
  true
}

finish() {
  say "finishing: final sync, then deleting $NAME"
  sync_up
  say "deleting $NAME"
  gcloud compute instances delete "$NAME" --zone "$ZONE" --quiet >/dev/null 2>&1 || shutdown -h now
}

# A reboot reruns the startup script; a VM that already ran only cleans up.
if [ -f /var/lib/teacher-started ]; then finish; exit 0; fi
touch /var/lib/teacher-started
trap finish EXIT

say "setup: packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q >/dev/null && apt-get install -yq xvfb xauth git curl zip ca-certificates fonts-liberation >/dev/null || { say "apt failed"; exit 1; }
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null && apt-get install -yq nodejs >/dev/null || { say "node install failed"; exit 1; }
curl -fsSLo /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
  && apt-get install -yq /tmp/chrome.deb >/dev/null || { say "chrome install failed"; exit 1; }
say "setup: node $(node -v), $(google-chrome --version)"

id $U >/dev/null 2>&1 || useradd -m -s /bin/bash $U || { say "useradd failed"; exit 1; }
gcloud storage cp -q "$BUCKET/vm/teacher-data.bundle" /tmp/teacher-data.bundle || { say "bundle download failed"; exit 1; }
chmod 644 /tmp/teacher-data.bundle
runuser -u $U -- git clone -q -b teacher-data /tmp/teacher-data.bundle "$H/app" 2>/tmp/clone.err || { say "clone failed: $(tail -1 /tmp/clone.err)"; exit 1; }
runuser -u $U -- bash -c "cd $H/app && npm ci --no-audit --no-fund >/tmp/npm.log 2>&1" || { say "npm ci failed: $(tail -1 /tmp/npm.log)"; exit 1; }
say "setup done at $(runuser -u $U -- git -C "$H/app" rev-parse --short HEAD); starting $PASSES pass(es), ceiling \$$MAX_USD"

( while sleep 300; do sync_up; done ) &
SYNC_PID=$!

runuser -u $U -- env HOME=$H TEACHER_ON_VM=1 MAX_USD="$MAX_USD" BUCKET="$BUCKET" \
  bash "$H/app/scripts/finetune/teacher-run.sh" "$PASSES"
say "teacher-run.sh exited $?; ledger $(node -e "console.log(JSON.parse(require('fs').readFileSync('$H/bench-results/cloud-spend.json','utf8')).spentUsd.toFixed(4))" 2>/dev/null) USD"
kill $SYNC_PID 2>/dev/null
