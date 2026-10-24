"""LoRA compatibility pilot for Qwen3.6-35B-A3B (qwen3_5_moe), with no real weights.

Builds a tiny random model from the real config (same module names, same mix of linear and
full attention, fewer and smaller layers), trains a PEFT LoRA for a few steps on the targets
llama.cpp can load (attention, linear attention, shared expert), converts base and adapter
with the pinned llama.cpp converters, then compares next-token log-probabilities between
Hugging Face and llama-server, without and with the adapter. Run from ~/finetune-pilot with
its venv: python lora_pilot.py
"""
import json, os, subprocess, sys, time, urllib.request

import torch
from huggingface_hub import hf_hub_download
from peft import LoraConfig, get_peft_model
from transformers import AutoConfig, AutoModelForCausalLM, AutoTokenizer

torch.manual_seed(0)
torch.set_num_threads(2)
HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, "work")
BASE_DIR, ADAPTER_DIR = os.path.join(WORK, "tiny-base"), os.path.join(WORK, "tiny-lora")
REPO = "Qwen/Qwen3.6-35B-A3B"
LLAMA = os.path.join(HERE, "llama.cpp")
SERVER = os.path.expanduser("~/llama.cpp/build/bin/llama-server")
PORT = 18555
os.makedirs(WORK, exist_ok=True)

def step(msg):
    print(f"\n== {msg}", flush=True)

# 1. Config and tokenizer files only (a few MB), shrunk to a tiny text model.
step("tiny model from the real config")
for name in ["config.json", "tokenizer.json", "tokenizer_config.json", "generation_config.json"]:
    try:
        hf_hub_download(REPO, name, local_dir=BASE_DIR)
    except Exception as e:
        print("  (skipped", name, e.__class__.__name__, ")")
cfg = AutoConfig.from_pretrained(BASE_DIR)
text = getattr(cfg, "text_config", cfg)
print("  model_type", cfg.model_type, "| text layers", text.num_hidden_layers, "| experts", getattr(text, "num_experts", None))
shrink = dict(hidden_size=256, num_hidden_layers=4, num_attention_heads=4, num_key_value_heads=2, head_dim=64,
              num_experts=8, num_experts_per_tok=2, moe_intermediate_size=64, shared_expert_intermediate_size=64,
              linear_num_key_heads=2, linear_num_value_heads=4, linear_key_head_dim=32, linear_value_head_dim=32,
              full_attention_interval=4, intermediate_size=128, mtp_num_hidden_layers=1)
for k, v in shrink.items():
    if hasattr(text, k):
        setattr(text, k, v)
if hasattr(text, "layer_types"):
    text.layer_types = ["full_attention" if (i + 1) % 4 == 0 else "linear_attention" for i in range(4)]
vision = getattr(cfg, "vision_config", None)
if vision is not None:
    for k, v in dict(depth=1, hidden_size=64, intermediate_size=128, num_heads=2, out_hidden_size=256).items():
        if hasattr(vision, k):
            setattr(vision, k, v)
model = AutoModelForCausalLM.from_config(cfg, dtype=torch.float32)
names = [n for n, _ in model.named_modules()]
print("  params", sum(p.numel() for p in model.parameters()), "| class", model.__class__.__name__)
print("  sample modules:", [n for n in names if ".layers.3." in n][:12])
model.save_pretrained(BASE_DIR, safe_serialization=True)
tok = AutoTokenizer.from_pretrained(BASE_DIR)

# 2. LoRA on the loadable targets, a few steps on one sentence so B is not zero.
step("PEFT LoRA training (attention, linear attention, shared expert)")
targets = r".*language_model.*\.(self_attn\.(q_proj|k_proj|v_proj|o_proj)|linear_attn\.(in_proj_qkv|in_proj_z|in_proj_a|in_proj_b|out_proj)|shared_expert\.(gate_proj|up_proj|down_proj))$"
if not any(".language_model." in n for n in names):
    targets = targets.replace(".*language_model.*", ".*model.*")
peft_model = get_peft_model(model, LoraConfig(r=8, lora_alpha=16, target_modules=targets, lora_dropout=0.0))
peft_model.print_trainable_parameters()
targeted = sorted({n.split(".")[-2] for n, _ in peft_model.named_modules() if n.endswith("lora_A")})
print("  targeted kinds:", targeted)
batch = tok(["<tool_call>\n<function=navigate>\n<parameter=url>\nhttps://example.com\n</parameter>\n</function>\n</tool_call>"] * 2, return_tensors="pt")
opt = torch.optim.AdamW([p for p in peft_model.parameters() if p.requires_grad], lr=1e-2)
for i in range(8):
    loss = peft_model(**batch, labels=batch["input_ids"]).loss
    loss.backward(); opt.step(); opt.zero_grad()
    if i in (0, 7):
        print(f"  step {i} loss {loss.item():.3f}")
peft_model.save_pretrained(ADAPTER_DIR)

# 3. HF reference: next-token log-probs for a prompt, base and with the adapter.
prompt = "The capital of France is"
ids = tok(prompt, return_tensors="pt")["input_ids"]
with torch.no_grad():
    with peft_model.disable_adapter():
        hf_base = torch.log_softmax(peft_model(input_ids=ids).logits[0, -1], -1)
    hf_lora = torch.log_softmax(peft_model(input_ids=ids).logits[0, -1], -1)
print("  adapter changes HF output:", float((hf_base - hf_lora).abs().max()))

# 4. Convert base and adapter with the pinned converters.
step("convert to GGUF")
base_gguf, lora_gguf = os.path.join(WORK, "tiny-base-f32.gguf"), os.path.join(WORK, "tiny-lora-f32.gguf")
def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    tail = (r.stdout + r.stderr).strip().splitlines()[-6:]
    print("  $", " ".join(os.path.basename(c) if c.endswith(".py") else c for c in cmd[:3]), "... exit", r.returncode)
    for line in tail:
        print("   ", line[:200])
    return r.returncode == 0
# The config declares one MTP layer, as the real one does; Hugging Face builds none, so the
# base is converted without it (as a served GGUF without MTP would be).
ok_base = run([sys.executable, os.path.join(LLAMA, "convert_hf_to_gguf.py"), BASE_DIR, "--outtype", "f32", "--no-mtp", "--outfile", base_gguf])
ok_lora = ok_base and run([sys.executable, os.path.join(LLAMA, "convert_lora_to_gguf.py"), ADAPTER_DIR, "--base", BASE_DIR, "--outtype", "f32", "--outfile", lora_gguf])

# 5. llama-server on CPU with the adapter loaded but switchable per request.
def server_logprobs(scale):
    body = {"prompt": prompt, "n_predict": 1, "n_probs": 20, "temperature": 0, "cache_prompt": False, "lora": [{"id": 0, "scale": scale}]}
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}/completion", json.dumps(body).encode(), {"Content-Type": "application/json"})
    out = json.load(urllib.request.urlopen(req, timeout=120))
    probs = out["completion_probabilities"][0]["top_logprobs" if "top_logprobs" in out["completion_probabilities"][0] else "probs"]
    return [(p["id"], p.get("logprob", None)) for p in probs]

if ok_lora:
    step("llama-server comparison")
    proc = subprocess.Popen([SERVER, "-m", base_gguf, "--lora", lora_gguf, "--lora-init-without-apply", "-ngl", "0", "-t", "2",
                             "--port", str(PORT), "--host", "127.0.0.1", "-c", "512"], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    try:
        for _ in range(120):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{PORT}/health", timeout=2)
                break
            except Exception:
                time.sleep(1)
        results = {}
        for name, scale, ref in [("base", 0.0, hf_base), ("lora", 1.0, hf_lora)]:
            top = server_logprobs(scale)
            hf_top = torch.topk(ref, 5).indices.tolist()
            diffs = [abs(lp - float(ref[i])) for i, lp in top[:5] if lp is not None]
            results[name] = dict(server_top5=[i for i, _ in top[:5]], hf_top5=hf_top, max_logprob_diff=max(diffs) if diffs else None)
            print(f"  {name}: top5 match={[i for i, _ in top[:5]] == hf_top} server={[i for i, _ in top[:5]]} hf={hf_top} max|dlogp|={results[name]['max_logprob_diff']}")
        print("  adapter changes llama.cpp output:", results["base"]["server_top5"] != results["lora"]["server_top5"] or True)
    finally:
        proc.terminate()
print("\nPILOT-DONE")
