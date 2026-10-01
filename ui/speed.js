// The speed part of the activity line and its tooltip. While a request streams, the rate is
// estimated from the streamed text (about 4 characters a token) over the time since its first
// token; once it ends, the agent's figures for it replace the estimate (see TaskMetrics).
// Words are counted in the streamed text, so the words per second are real either way.

export const countWords = (text) => text.split(/\s+/).filter(Boolean).length;

// now, requestStarted, firstTokenAt: ms timestamps; firstTokenAt is null before the first token.
// chars, text: what the current request has streamed. final: the agent's figures, once it ends.
// local: the latest context share and GPU share a local server reported, if any.
export function speedParts({ now, requestStarted, firstTokenAt, chars, text, final, local = {} }) {
  const parts = [];
  const tips = [];
  const words = countWords(text);
  const rate = (perSecond, secs) => {
    parts.push(`${Math.round(perSecond)} tok/s`);
    if (words) parts.push(`~${Math.round(words / secs)} w/s`);
  };
  if (final) {
    if (final.tokensPerSecond) rate(final.tokensPerSecond, final.rateMs / 1000);
    if (final.promptPerSecond) tips.push(`pp ${Math.round(final.promptPerSecond)} tok/s`);
    if (final.firstTokenMs != null) tips.push(`first token ${(final.firstTokenMs / 1000).toFixed(1)}s`);
    if (final.loadMs) tips.push(`model load ${(final.loadMs / 1000).toFixed(1)}s`);
  } else if (requestStarted && firstTokenAt === null) {
    parts.push(`reading prompt ${Math.floor((now - requestStarted) / 1000)}s`);
  } else if (firstTokenAt !== null && now - firstTokenAt >= 500) {
    const secs = (now - firstTokenAt) / 1000;
    rate(chars / 4 / secs, secs);
  }
  if (local.contextShare != null) parts.push(`ctx ${Math.round(local.contextShare * 100)}%`);
  // Shown only when the model is split between GPU and CPU.
  if (local.gpuShare != null && Math.round(local.gpuShare * 100) < 100) parts.push(`GPU ${Math.round(local.gpuShare * 100)}%`);
  return { parts, tips };
}
