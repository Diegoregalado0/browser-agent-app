#!/usr/bin/env python3
"""Per-task and per-run timing for a Browsby benchmark run.

Usage: step_timing.py <run-dir> [--model ID] [--json]

Reads <run-dir>/run.log for task results and the llama-browsby journal for the run's time
window. Per model segment it reports the request count, prompt tokens evaluated (cache
misses), generation tokens, prompt and generation tokens per second, and how often a
request landed on a slot by LRU or with low prefix similarity (a cache eviction).
Tasks are placed in the window in run order from their reported durations, so per-task
journal figures are approximate; the task results themselves are exact. When
<task>.events.jsonl files exist beside run.log, event counts and wall time per task are
added from them.
"""
import glob, json, os, re, subprocess, sys
from datetime import datetime

TS = r"(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)"
fmt = "%Y-%m-%d %H:%M:%S"


def parse_runlog(path):
    segs, cur, task = [], None, None
    for line in open(path):
        m = re.match(TS + r" start \S+ (\S+) \(timeout (\d+)ms\)", line)
        if m:
            cur = {"model": m.group(2), "start": datetime.strptime(m.group(1), fmt), "tasks": [], "end": None}
            segs.append(cur)
            continue
        m = re.match(TS + r" done \S+ (\S+):", line)
        if m and cur:
            cur["end"] = datetime.strptime(m.group(1), fmt)
            continue
        m = re.match(r"\[run (\d+)\] (\S+):", line)
        if m:
            task = m.group(2)
            continue
        m = re.match(r"\s+-> (PASS|FAIL)\b(.*?) steps=(\d+) tokens=(\d+) time=([\d.]+)s", line)
        if m and cur and task:
            cur["tasks"].append({"task": task, "pass": m.group(1) == "PASS", "steps": int(m.group(3)),
                                 "tokens": int(m.group(4)), "secs": float(m.group(5))})
            task = None
    return segs


def journal(since, until):
    out = subprocess.run(["journalctl", "--user", "-u", "llama-browsby", "--no-pager", "-o", "short-iso",
                          "--since", since.strftime(fmt), "--until", until.strftime(fmt)],
                         capture_output=True, text=True).stdout
    reqs, cur = [], {}
    for line in out.splitlines():
        ts = line[:19].replace("T", " ")
        if "slot get_availabl" in line:
            sim = re.search(r"f_sim_best = ([\d.]+)", line)
            cur = {"ts": datetime.strptime(ts, fmt), "lru": "by LRU" in line,
                   "sim": float(sim.group(1)) if sim else None}
            continue
        m = re.search(r"task (\d+) \| prompt eval time =\s+([\d.]+) ms /\s+(\d+) tokens", line)
        if m:
            cur.setdefault("ts", datetime.strptime(ts, fmt))
            cur.update(task_id=int(m.group(1)), pe_ms=float(m.group(2)), pe_tok=int(m.group(3)))
            continue
        m = re.search(r"task (\d+) \|\s+eval time =\s+([\d.]+) ms /\s+(\d+) tokens", line)
        if m and "pe_ms" in cur:
            cur.update(ev_ms=float(m.group(2)), ev_tok=int(m.group(3)))
            reqs.append(cur)
            cur = {}
    return reqs


def agg(rs):
    pe_t = sum(r["pe_tok"] for r in rs); pe_s = sum(r["pe_ms"] for r in rs) / 1000
    ev_t = sum(r["ev_tok"] for r in rs); ev_s = sum(r["ev_ms"] for r in rs) / 1000
    return {"requests": len(rs), "prompt_tokens_evaluated": pe_t, "prompt_s": round(pe_s, 1),
            "prompt_tok_s": round(pe_t / pe_s, 1) if pe_s else None, "gen_tokens": ev_t, "gen_s": round(ev_s, 1),
            "gen_tok_s": round(ev_t / ev_s, 2) if ev_s else None,
            "lru_or_low_sim": sum(1 for r in rs if r.get("lru") or (r.get("sim") is not None and r["sim"] < 0.5))}


def events(run_dir, task):
    res = []
    for p in sorted(glob.glob(os.path.join(run_dir, task + "*.events.jsonl"))):
        rows = [json.loads(l) for l in open(p) if l.strip()]
        if rows:
            res.append({"events": len(rows), "wall_s": round((rows[-1]["t"] - rows[0]["t"]) / 1000, 1)})
    return res


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    run_dir = args[0]
    only = sys.argv[sys.argv.index("--model") + 1] if "--model" in sys.argv else None
    report = []
    for seg in parse_runlog(os.path.join(run_dir, "run.log")):
        if only and seg["model"] != only:
            continue
        end = seg["end"] or seg["start"]
        reqs = [r for r in journal(seg["start"], end) if "ts" in r]
        t0, rows = seg["start"], []
        for t in seg["tasks"]:
            span = [r for r in reqs if 0 <= (r["ts"] - t0).total_seconds() <= t["secs"] + 30]
            row = {**t, **(agg(span) if span else {})}
            row["s_per_step"] = round(t["secs"] / t["steps"], 1) if t["steps"] else None
            ev = events(run_dir, t["task"])
            if ev:
                row["event_log"] = ev
            rows.append(row)
            t0 = t0.fromtimestamp(t0.timestamp() + t["secs"])
        report.append({"model": seg["model"], "tasks": rows, "window": agg(reqs) if reqs else {},
                       "passed": sum(t["pass"] for t in seg["tasks"]), "total": len(seg["tasks"])})
    if "--json" in sys.argv:
        print(json.dumps(report, indent=1))
        return
    for r in report:
        print(f"== {r['model']}: {r['passed']}/{r['total']} passed; window {r['window']}")
        print(f"{'task':22} {'ok':4} {'steps':>5} {'secs':>7} {'s/step':>6} {'reqs':>5} {'prompt_tok':>10} {'gen_tok':>8} {'evict':>5}")
        for t in r["tasks"]:
            print(f"{t['task']:22} {'PASS' if t['pass'] else 'FAIL':4} {t['steps']:5} {t['secs']:7.1f} {t['s_per_step'] or 0:6} "
                  f"{t.get('requests', 0):5} {t.get('prompt_tokens_evaluated', 0):10} {t.get('gen_tokens', 0):8} {t.get('lru_or_low_sim', 0):5}")


main()
