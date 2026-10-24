#!/bin/bash
# LoRA compatibility pilot environment (2026-10-24): Python venv with CPU PyTorch,
# Transformers, PEFT, gguf; llama.cpp source pinned to the router build (0c1e57098) for its
# converters. Low priority so the GPU benchmark is not disturbed.
set -e
cd ~/finetune-pilot
python3 -m venv .venv
. .venv/bin/activate
nice -n 19 pip install --quiet --upgrade pip
nice -n 19 pip install --quiet torch --index-url https://download.pytorch.org/whl/cpu
nice -n 19 pip install --quiet "transformers>=5.2" peft safetensors numpy sentencepiece "huggingface_hub>=0.30"
if [ ! -d llama.cpp ]; then nice -n 19 git clone --quiet --filter=blob:none https://github.com/ggml-org/llama.cpp.git; fi
cd llama.cpp && git checkout --quiet 0c1e57098 && cd ..
nice -n 19 pip install --quiet -e llama.cpp/gguf-py
python -c "import torch, transformers, peft, gguf; print(\"torch\", torch.__version__, \"transformers\", transformers.__version__, \"peft\", peft.__version__, \"gguf ok\")"
echo SETUP-DONE
