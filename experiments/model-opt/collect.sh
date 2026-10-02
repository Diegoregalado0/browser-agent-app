#!/bin/bash
# Usage: collect.sh <model-id> [run-dir]   (default: newest run containing the model)
set -eu
id=${1:?model id}; here=$(cd "$(dirname "$0")" && pwd); mkdir -p "$here/results"
run=${2:-$(grep -l "start openai $id " "$HOME"/bench-results/runs/*/run.log | tail -1 | xargs dirname)}
python3 "$here/step_timing.py" "$run" --model "$id" | tee "$here/results/$id.txt"
python3 "$here/step_timing.py" "$run" --model "$id" --json > "$here/results/$id.json"
echo "run dir: $run" >> "$here/results/$id.txt"
