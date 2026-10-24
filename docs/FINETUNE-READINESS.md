# Fine-tuning readiness: Zigger 1.0 (Qwen3.6-35B-A3B)

Status 2026-10-24. Research, plus a free compatibility pilot on ai-linux (approved: Python
packages and a pinned llama.cpp source checkout in ~/finetune-pilot). No real weights were
trained. Items marked UNVERIFIED could not be confirmed.

## The model

| | |
|---|---|
| Hugging Face | Qwen/Qwen3.6-35B-A3B, Transformers model type `qwen3_5_moe` (first in Transformers 5.2.0) |
| Size | 35.95B parameters (67 GiB in bf16), about 3B active per token |
| Layers | 40: 10 full attention (16 Q / 2 KV heads, head dim 256), 30 linear attention (Gated DeltaNet) |
| MoE | 256 routed experts (8 active, FFN 512) + 1 shared expert with its own gate |
| Served as | Unsloth UD-Q3_K_XL GGUF, llama.cpp build 11312 (router), 64k context, thinking off |
| Chat format | ChatML; tools in `<tools>`; calls as `<tool_call><function=…><parameter=…>` XML |

## LoRA targets (module names from modeling_qwen3_5_moe.py, under model.language_model.layers.N.)

| Part | Modules | LoRA? |
|---|---|---|
| Full attention | self_attn.q_proj, k_proj, v_proj, o_proj | Yes |
| Linear attention | linear_attn.in_proj_qkv, in_proj_z, in_proj_a, in_proj_b, out_proj | Yes (not conv1d, A_log, dt_bias) |
| Shared expert | mlp.shared_expert.gate_proj, up_proj, down_proj; mlp.shared_expert_gate | Yes |
| Router | mlp.gate.weight (a bare parameter) | Only via PEFT target_parameters; leave frozen |
| Routed experts | mlp.experts.gate_up_proj [256,1024,2048], mlp.experts.down_proj [256,2048,512] (fused) | Only via target_parameters; cannot be converted to GGUF |
| Vision | model.visual.* | Exclude (regex scoped to language_model) |

Recommended adapter: attention + linear attention + shared expert, router and routed experts
frozen. It avoids every known fused-expert problem and is the one shape llama.cpp can load.
PEFT's `all-linear` misses shared-expert modules on Transformers 5 MoE models (fix merged
2026-10-21, likely not in PEFT 0.21.2): list the modules explicitly.

## Tooling status

- Transformers >= 5.2 (latest 5.20.2); PEFT 0.21.2 (LoRA on Linear modules fine; fused experts
  only through target_parameters); TRL 1.16 has a qwen3_6 template and supports tools /
  tool_calls columns (verify loss masking on tool-call turns: the stock template has no
  generation markers).
- QLoRA: not recommended for this MoE (bitsandbytes loads fused experts in bf16; issue open).
  bf16 LoRA is the supported path. Unsloth reports about 74 GB VRAM for bf16 LoRA on the sibling
  Qwen3.5-35B-A3B; merges through Unsloth's MoE path have reported bugs: do not merge, serve
  the adapter.
- llama.cpp: build 11312 includes the qwen35moe LoRA conversion fix (PR #28324, V-head reorder
  for the linear-attention factors) and applies LoRA to the attention, linear-attention and
  shared-expert matmuls; adapters load on a quantized base (no base-type check). Expert LoRA
  has no conversion path. Per-request scaling exists (`lora` request field), but prompt caches
  can be reused across different adapters (issue #26207). UNVERIFIED: per-model `--lora` in
  router mode presets.
- Verified locally: the server's ~/llama.cpp holds only build/ and src/ (no git checkout, no
  convert_lora_to_gguf.py). Converting an adapter needs a llama.cpp source checkout pinned to
  commit 0c1e57098 (a download, needs approval) plus Python with torch/transformers/peft/gguf,
  none of which is installed.

## Memory and cost (estimates)

- Frozen bf16 weights 67 GiB, plus activations and logits (vocab 248,320: about 1 MB/token in
  fp32 without fused cross-entropy).
- 8k tokens: about 78 GB with fused cross-entropy (one H100 80 GB, barely). 16k: about 82 GB;
  32k: about 88 GB (a 96 GB card, an H200, or 2x80 GB).
- Local training on the RTX 3070 (8 GB) / 56 GB WSL: not feasible (weights alone exceed both).
- On-demand prices (RunPod, 2026-10-08): RTX PRO 6000 96 GB $1.69-2.49/h; H100 SXM $2.69-3.99/h;
  H200 $3.59-5.29/h. Lambda H100 $4.29/h. No published throughput for this model: a full run's
  time and cost are unknown until the pilot measures them.

## Pilot step 1 results (2026-10-24, scripts/finetune/)

Environment: ~/finetune-pilot venv (torch 2.14.1 CPU, transformers 5.20.2, peft 0.21.2, gguf
from llama.cpp at 0c1e57098, the router's build); setup.sh records it.
- lora_pilot.py: a tiny random qwen3_5_moe from the real config (4 layers: 3 linear attention,
  1 full attention; 8 experts; one MTP layer declared as in the real config), PEFT LoRA r=8 on
  12 module kinds (q/k/v/o_proj, in_proj_qkv/z/a/b, out_proj, shared gate/up/down_proj), 8
  training steps (loss 12.5 -> 9.1).
  - convert_hf_to_gguf.py (--no-mtp) and convert_lora_to_gguf.py: both succeed (62 adapter
    tensors). The converter asserts when a config declares no MTP layers; the real config
    declares one, so this does not affect the real model.
  - llama-server (the router's binary, CPU) with --lora and per-request scale: next-token top-5
    identical to Hugging Face with the adapter off and on; log-probabilities within 0.0003.
    The PEFT -> GGUF LoRA path for qwen35moe works.
- lora_quant.py: the same adapter on Q4_K_M and Q3_K_M quantizations of the tiny base loads and
  changes the output, switchable per request. Fidelity cannot be judged on a random tiny model
  (quantization noise dominates: the Q3 base's own top-5 shares 2/5 with f32). Whether a bf16
  adapter keeps its effect on the real 3-bit base must be measured on the real model (step 2).

## Proposed next pilot steps (paid GPU time needs approval)

1. Done (above).
2. Real-model smoke, about $5-15: rent one 96 GB GPU for 1-2 h; 30-50 steps (rank 16, 8k) on
   50 tool-call examples from the trajectory exporter; convert; load with --lora on the
   UD-Q3_K_XL base in a separate preset (not the public Zigger preset).
   Pass: outputs change between scale 0 and 1; the <tool_call> XML stays intact; benchmark
   tool-format errors do not increase.
3. Only then: a dataset of benchmark-verified trajectories (target 1-5k steps), rank 16-64,
   8-16k sequences, evaluated on the fixture suite's held-out split against the base model.
   Rollback: the adapter is a separate file; removing it from the preset restores the base.

## Verdict

No-go for training now; go for the free compatibility pilot once approved. Blockers, in order:
(1) no dataset (the trajectory recorder and exporter come first, and data rights for any
teacher model must be checked); (2) a measured baseline that the cheaper agent changes have
already moved; (3) settled: the PEFT-to-GGUF path works (pilot step 1); (4) a bf16 adapter on a Q3 base is untested (the only precedent is Q4).
