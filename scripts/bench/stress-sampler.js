// Samples host resources while a stress task runs, every N ms, into a JSONL file next to
// the task's event log, and summarizes them (mean and peak) when the task ends. Reads only
// /proc and one nvidia-smi query per sample, so it stays cheap next to the run it measures.
//
// Each sample: system CPU % (all cores), load average, MemAvailable, page cache, swap used,
// PSI avg10 (cpu some, memory some/full, io some), VRAM used, and CPU % (of one core) plus
// RSS for the process groups llama-server, chrome (every chrome process), Xvfb and node.

import { readFileSync, readdirSync, appendFileSync, existsSync } from "node:fs";
import { execFile } from "node:child_process";

const CLK_TCK = 100;
const PAGE_KB = 4;
const NVIDIA_SMI = ["/usr/lib/wsl/lib/nvidia-smi", "/usr/bin/nvidia-smi"].find((p) => existsSync(p)) || "nvidia-smi";
const GROUPS = ["llama", "chrome", "xvfb", "node"];
// Flags for a moment the host looked saturated (see summarize).
export const LIMITS = { memPsi: 10, load: 12, swapGrowMb: 32, cpuPct: 95 };

const read = (p) => {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return "";
  }
};

function groupOf(comm, pid) {
  if (comm.startsWith("llama-server")) return "llama";
  if (comm === "Xvfb") return "xvfb";
  if (comm === "node" || comm === "MainThread") return "node";
  if (/chrom|headless_shell/i.test(comm)) return "chrome";
  return null;
}

function cpuTotals() {
  const f = read("/proc/stat").split("\n")[0].trim().split(/\s+/).slice(1).map(Number);
  const idle = f[3] + (f[4] || 0);
  return { idle, total: f.reduce((a, b) => a + b, 0) };
}

function procs() {
  const out = {};
  for (const g of GROUPS) out[g] = { ticks: 0, rssKb: 0, n: 0 };
  for (const d of readdirSync("/proc")) {
    if (!/^\d+$/.test(d)) continue;
    const stat = read(`/proc/${d}/stat`);
    if (!stat) continue;
    const close = stat.lastIndexOf(")");
    const comm = stat.slice(stat.indexOf("(") + 1, close);
    const g = groupOf(comm, d);
    if (!g) continue;
    const f = stat.slice(close + 2).split(" ");
    // Fields after the comm: state is f[0], utime f[11], stime f[12], rss (pages) f[21].
    out[g].ticks += Number(f[11]) + Number(f[12]);
    out[g].rssKb += Number(f[21]) * PAGE_KB;
    out[g].n++;
  }
  return out;
}

function meminfo() {
  const m = {};
  for (const line of read("/proc/meminfo").split("\n")) {
    const [k, v] = line.split(":");
    if (v) m[k] = parseInt(v, 10);
  }
  return { availMb: Math.round(m.MemAvailable / 1024), cacheMb: Math.round((m.Cached || 0) / 1024), swapMb: Math.round((m.SwapTotal - m.SwapFree) / 1024) };
}

function psi(kind) {
  const text = read(`/proc/pressure/${kind}`);
  const get = (line) => Number((new RegExp(`^${line} avg10=([\\d.]+)`, "m").exec(text) || [])[1] ?? NaN);
  return { some: get("some"), full: get("full") };
}

function vram() {
  return new Promise((resolve) => {
    execFile(NVIDIA_SMI, ["--query-gpu=memory.used,utilization.gpu", "--format=csv,noheader,nounits"], { timeout: 5000 }, (err, stdout) => {
      if (err) return resolve({ vramMb: null, gpuPct: null });
      const [used, util] = stdout.split("\n")[0].split(",").map((s) => Number(s.trim()));
      resolve({ vramMb: used, gpuPct: util });
    });
  });
}

export class ResourceSampler {
  constructor(intervalMs) {
    this.intervalMs = Math.max(2000, intervalMs);
    this.samples = [];
    this.timer = null;
  }

  start(path) {
    this.path = path;
    this.prevCpu = cpuTotals();
    this.prevProcs = procs();
    this.prevAt = Date.now();
    this.timer = setInterval(() => this.#sample().catch(() => {}), this.intervalMs);
  }

  async #sample() {
    const at = Date.now();
    const cpu = cpuTotals();
    const pr = procs();
    const secs = (at - this.prevAt) / 1000;
    const dTotal = cpu.total - this.prevCpu.total;
    const s = {
      t: at,
      cpuPct: dTotal > 0 ? Math.round((1000 * (dTotal - (cpu.idle - this.prevCpu.idle))) / dTotal) / 10 : null,
      load1: Number(read("/proc/loadavg").split(" ")[0]),
      ...meminfo(),
      psiCpu: psi("cpu").some,
      psiMem: psi("memory").some,
      psiMemFull: psi("memory").full,
      psiIo: psi("io").some,
      ...(await vram()),
    };
    for (const g of GROUPS) {
      // A group whose processes were replaced between samples (a restarted server) can show
      // fewer ticks than before; that interval reads as 0 rather than negative.
      const dt = pr[g].ticks - this.prevProcs[g].ticks;
      s[`${g}Cpu`] = Math.max(0, Math.round((dt / CLK_TCK / secs) * 1000) / 10);
      s[`${g}RssMb`] = Math.round(pr[g].rssKb / 1024);
    }
    this.prevCpu = cpu;
    this.prevProcs = pr;
    this.prevAt = at;
    this.samples.push(s);
    try {
      appendFileSync(this.path, JSON.stringify(s) + "\n");
    } catch {}
  }

  async stop() {
    clearInterval(this.timer);
    return summarize(this.samples);
  }
}

const FIELDS = ["cpuPct", "load1", "availMb", "cacheMb", "swapMb", "psiCpu", "psiMem", "psiIo", "vramMb", "gpuPct", ...GROUPS.flatMap((g) => [`${g}Cpu`, `${g}RssMb`])];

// Mean and peak of every field (the minimum for available memory), plus the flagged moments:
// swap growing, memory pressure above 10, load above 12, all cores busy.
export function summarize(samples) {
  if (!samples.length) return null;
  const out = { samples: samples.length, mean: {}, peak: {} };
  for (const f of FIELDS) {
    const xs = samples.map((s) => s[f]).filter((x) => typeof x === "number" && !Number.isNaN(x));
    if (!xs.length) continue;
    out.mean[f] = Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;
    out.peak[f] = f === "availMb" ? Math.min(...xs) : Math.max(...xs);
  }
  const swap0 = samples[0].swapMb;
  out.swapGrowthMb = Math.max(...samples.map((s) => s.swapMb)) - swap0;
  out.flags = {
    swapGrowth: out.swapGrowthMb >= LIMITS.swapGrowMb,
    memPsiOver10: samples.filter((s) => s.psiMem > LIMITS.memPsi).length,
    loadOver12: samples.filter((s) => s.load1 > LIMITS.load).length,
    cpuSaturated: samples.filter((s) => s.cpuPct >= LIMITS.cpuPct).length,
  };
  out.firstFlagAt = (samples.find((s) => s.psiMem > LIMITS.memPsi || s.load1 > LIMITS.load || s.swapMb - swap0 >= LIMITS.swapGrowMb) || {}).t ?? null;
  return out;
}
