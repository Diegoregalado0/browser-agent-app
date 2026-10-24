# Fine-tuning readiness: Zigger 1.0 (Qwen3.6-35B-A3B)

Status 2026-10-24. Research only: nothing was trained, downloaded or installed. Sources were
read by a research subagent and spot-checked; items marked UNVERIFIED could not be confirmed.

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

## Proposed pilot (needs approval for downloads, installs and paid GPU time)

1. Compatibility, free: on ai-linux, build a tiny random qwen3_5_moe model with the same module
   names (4 layers, 8 experts, hidden 256), train a PEFT LoRA on the recommended targets for a
   few steps, convert with convert_lora_to_gguf.py at commit 0c1e57098, and compare llama.cpp
   logits with the adapter against the HF model with the adapter. Needs: llama.cpp source and
   Python packages (torch CPU, transformers, peft, gguf). Cost $0.
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
already moved; (3) the PEFT-to-GGUF path for qwen35moe has no confirmed public success: the
free pilot settles it; (4) a bf16 adapter on a Q3 base is untested (the only precedent is Q4).
