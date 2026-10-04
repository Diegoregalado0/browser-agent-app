#!/bin/bash
# Deletes every VM and disk the pipeline labeled in the project, and with --bucket the data
# bucket too. Safe to run any time; it touches only resources labeled browsby-ft=1.
#
# Usage: finetune/gcp/teardown.sh [--dry-run] [--bucket]
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=finetune/gcp/config.sh
. "$HERE/config.sh"
guard_gcp

DELETE_BUCKET=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --bucket) DELETE_BUCKET=1 ;;
    *) echo "unknown option $1" >&2; exit 1 ;;
  esac
  shift
done

FILTER="labels.$LABEL_KEY=$LABEL_VALUE"
if [ "${DRY_RUN:-0}" = "1" ]; then
  run gcp compute instances list --filter "$FILTER" --format "value(name,zone.basename())"
  run gcp compute instances delete VM_NAME --zone ZONE --quiet
  run gcp compute disks list --filter "$FILTER" --format "value(name,zone.basename())"
  run gcp compute disks delete DISK_NAME --zone ZONE --quiet
else
  while read -r name zone; do
    [ -n "$name" ] && run gcp compute instances delete "$name" --zone "$zone" --quiet
  done < <(gcp compute instances list --filter "$FILTER" --format "value(name,zone.basename())")
  # Boot disks auto-delete with their VM; this catches any left behind.
  while read -r name zone; do
    [ -n "$name" ] && run gcp compute disks delete "$name" --zone "$zone" --quiet
  done < <(gcp compute disks list --filter "$FILTER OR name~^ft-" --format "value(name,zone.basename())")
fi

if [ "$DELETE_BUCKET" = "1" ]; then
  run gcp storage rm -r "$BUCKET"
fi
echo "teardown done"
