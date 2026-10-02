#!/bin/bash
# Usage: run-experiment.sh <model-id> [timeout_ms]
# Runs the benchmark for one models.ini section through ~/bench-run.sh in a tmux session
# (the runner takes the GPU lock and checks gaming mode), then writes the timing report
# next to the run results and under experiments/model-opt/results/.
set -eu
id=${1:?model id}; timeout=${2:-360000}
here=$(cd "$(dirname "$0")" && pwd)
curl -sf -m 10 127.0.0.1:8090/v1/models | grep -q "\"id\": \"$id\"" \
  || { echo "model id $id is not served; append its section to ~/browsby/models.ini first"; exit 1; }
curl -sf -m 10 127.0.0.1:8090/gaming/status | grep -q '"gaming": false' || { echo "gaming mode is on"; exit 1; }
tmux new-session -d -s "bench-exp-$id" "$HOME/bench-run.sh openai:$id:$timeout"
echo "started bench-exp-$id; when it ends run: $here/collect.sh $id"
