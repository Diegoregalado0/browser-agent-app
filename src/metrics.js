// Speed figures for the activity line and the summary after each task. Local servers
// (Ollama, llama.cpp) report token counts with their durations; for hosted providers the
// rate comes from the stream's own timing, and no prompt figures are made up for them.

// A model load longer than this is a cold start; shorter ones are not shown. Ollama reports
// about 200 ms on every request to a model already in memory.
export const MODEL_LOAD_MS = 500;

const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export class TaskMetrics {
  started = Date.now();
  input = 0;
  output = 0;
  // Output tokens and the generation time they took, for the average rate.
  rateTokens = 0;
  rateMs = 0;
  checkMs = 0;

  // Records a finished model request. Returns its figures for the activity line.
  // metrics: the provider's own figures, all optional (see the providers' turn).
  // firstTokenMs: time to the first streamed token, measured here when the provider did not.
  request({ usage, metrics, ms, firstTokenMs }) {
    const m = metrics ?? {};
    this.input += usage?.input ?? 0;
    this.output += usage?.output ?? 0;
    const first = m.firstTokenMs ?? firstTokenMs ?? null;
    const exact = Boolean(m.generatedTokens && m.generationMs);
    // Hosted: the output tokens over the time from the first token to the end of the stream.
    const tokens = exact ? m.generatedTokens : usage?.output;
    const rateMs = exact ? m.generationMs : first !== null ? ms - first : 0;
    const figures = { exact, firstTokenMs: first };
    if (tokens && rateMs > 0) {
      this.rateTokens += tokens;
      this.rateMs += rateMs;
      Object.assign(figures, { tokensPerSecond: tokens / (rateMs / 1000), rateMs });
    }
    if (m.promptTokens && m.promptMs) figures.promptPerSecond = m.promptTokens / (m.promptMs / 1000);
    if (m.loadMs > MODEL_LOAD_MS) figures.loadMs = m.loadMs;
    if (m.contextSize && usage?.input) figures.contextShare = usage.input / m.contextSize;
    if (m.gpuShare != null) figures.gpuShare = m.gpuShare;
    return figures;
  }

  // Time spent in a safety check of an action or a scan of tool output.
  check(ms) {
    this.checkMs += ms;
  }

  // One line: average rate, tokens, total time, and the share of it in safety checks.
  summary(now = Date.now()) {
    const total = now - this.started;
    const parts = [];
    if (this.rateMs) parts.push(`${Math.round(this.rateTokens / (this.rateMs / 1000))} tok/s average`);
    parts.push(`${fmt(this.input + this.output)} tokens (${fmt(this.input)} in, ${fmt(this.output)} out)`);
    parts.push(`${Math.round(total / 1000)}s`);
    parts.push(`safety checks ${total ? Math.round((this.checkMs / total) * 100) : 0}% of the time`);
    return parts.join(" · ");
  }
}
