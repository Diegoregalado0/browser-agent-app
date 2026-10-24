"""Second pilot step: does the adapter load and act on a quantized base (Zigger runs 3-bit)?
Quantizes the tiny base to Q3_K_M and Q4_K_M, loads the f32 adapter on each with llama-server,
and compares the next-token top-5 with the adapter off and on against the f32 base's."""
import json, os, subprocess, time, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__))
W = os.path.join(HERE, "work")
QUANT = os.path.join(HERE, "llama.cpp/build-cpu/bin/llama-quantize")
SERVER = os.path.expanduser("~/llama.cpp/build/bin/llama-server")
PROMPT = "The capital of France is"

def top(port, scale):
    body = {"prompt": PROMPT, "n_predict": 1, "n_probs": 10, "temperature": 0, "cache_prompt": False, "lora": [{"id": 0, "scale": scale}]}
    out = json.load(urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{port}/completion", json.dumps(body).encode(), {"Content-Type": "application/json"}), timeout=120))
    p = out["completion_probabilities"][0]
    return [x["id"] for x in p.get("top_logprobs", p.get("probs", []))][:5]

def serve(model, port):
    proc = subprocess.Popen([SERVER, "-m", model, "--lora", os.path.join(W, "tiny-lora-f32.gguf"), "--lora-init-without-apply", "-ngl", "0", "-t", "2", "--port", str(port), "--host", "127.0.0.1", "-c", "512"], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    for _ in range(120):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=2)
            return proc, None
        except Exception:
            if proc.poll() is not None:
                return proc, proc.stderr.read()[-800:]
            time.sleep(1)
    return proc, "no answer"

results = {}
for name, path in [("f32", os.path.join(W, "tiny-base-f32.gguf"))] + [(q, os.path.join(W, f"tiny-base-{q}.gguf")) for q in ["Q4_K_M", "Q3_K_M"]]:
    if name != "f32":
        r = subprocess.run([QUANT, os.path.join(W, "tiny-base-f32.gguf"), path, name, "2"], capture_output=True, text=True)
        print(name, "quantize exit", r.returncode, (r.stdout + r.stderr).strip().splitlines()[-1][:160])
        if r.returncode:
            continue
    proc, err = serve(path, 18556)
    try:
        if err:
            print(name, "SERVER FAILED:", err)
            continue
        results[name] = (top(18556, 0.0), top(18556, 1.0))
        print(name, "off", results[name][0], "| on", results[name][1])
    finally:
        proc.terminate(); proc.wait()
ref_off, ref_on = results["f32"]
for name, (off, on) in results.items():
    print(f"{name}: adapter changes output={off != on}; top-5 overlap with f32 off={len(set(off) & set(ref_off))}/5 on={len(set(on) & set(ref_on))}/5")
print("QUANT-DONE")
