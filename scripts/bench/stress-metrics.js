// Per-task figures for the stress suite, read from a finished task's agent events: how long
// each step took and whether that drifted over the task, how large the context grew, how
// often it was compacted, and what went wrong (loop checks, tool errors, the stop reason).
// Debug events (run.js --debug) carry the per-request tokens and compactions; without them
// those fields stay null.

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round = (x, d = 1) => (x == null || Number.isNaN(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

// Least-squares slope of ys over their index: seconds gained per step.
function slope(ys) {
  const n = ys.length;
  if (n < 3) return null;
  const mx = (n - 1) / 2;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  ys.forEach((y, i) => {
    num += (i - mx) * (y - my);
    den += (i - mx) ** 2;
  });
  return num / den;
}

const textOf = (content) => (Array.isArray(content) ? content.filter((b) => b.type === "text").map((b) => b.text).join("\n") : String(content || ""));

export function errorType(reason = "") {
  if (/context|n_ctx|too long|exceeds|maximum context/i.test(reason)) return "context overflow";
  if (/seems stuck|loop/i.test(reason)) return "loop stop";
  if (/Stopped after \d+ steps|max steps/i.test(reason)) return "max steps";
  if (/stalled/i.test(reason)) return "stall";
  if (/timed out/i.test(reason)) return "timeout";
  if (/harness error/i.test(reason)) return "harness";
  if (/agent error/i.test(reason)) return "agent error";
  return reason ? "wrong answer" : null;
}

export function taskMetrics(events, { agentError = null, timedOut = false, stalled = false } = {}) {
  // A step is one model request plus the tools it called: assistant_start to the next one.
  const starts = events.filter((e) => e.type === "assistant_start" && e.at).map((e) => e.at);
  const endAt = events.length ? events.at(-1).at : null;
  const stepSecs = starts.map((t, i) => ((starts[i + 1] ?? endAt) - t) / 1000).filter((s) => s >= 0);
  const q = Math.max(1, Math.floor(stepSecs.length / 4));

  const requests = events
    .filter((e) => e.type === "debug" && /^Request \d+: \d+ input tokens/.test(e.text))
    .map((e) => {
      const m = /^Request (\d+): (\d+) input tokens \((\d+) cached\), (\d+) output, (\d+) ms/.exec(e.text);
      return m ? { input: Number(m[2]), cached: Number(m[3]), output: Number(m[4]), ms: Number(m[5]) } : null;
    })
    .filter(Boolean);
  const reqSecs = requests.map((r) => r.ms / 1000);
  const rq = Math.max(1, Math.floor(reqSecs.length / 4));

  const notices = events.filter((e) => e.type === "notice").map((e) => e.text);
  const toolResults = events.filter((e) => e.type === "tool_result");
  const errors = toolResults.filter((e) => e.isError).map((e) => textOf(e.content).split("\n")[0].replace(/\d+/g, "#").slice(0, 100));
  const errorCounts = {};
  for (const e of errors) errorCounts[e] = (errorCounts[e] || 0) + 1;
  const calls = events.filter((e) => e.type === "tool_call");
  const toolCounts = {};
  for (const c of calls) toolCounts[c.name] = (toolCounts[c.name] || 0) + 1;

  let stop = "answered";
  if (agentError) stop = /context|n_ctx|too long|exceed/i.test(agentError) ? "context overflow" : "agent error";
  else if (stalled) stop = "stall";
  else if (timedOut) stop = "timeout";
  else if (notices.some((n) => /seems stuck/.test(n))) stop = "loop stop";
  else if (notices.some((n) => /^Stopped after \d+ steps/.test(n))) stop = "max steps";
  else if (notices.some((n) => /output limit/.test(n))) stop = "output limit";
  else if (notices.some((n) => /without a reply/.test(n))) stop = "empty reply";

  return {
    stop,
    modelSteps: starts.length,
    stepSecMedian: round(median(stepSecs)),
    stepSecFirstQ: round(median(stepSecs.slice(0, q))),
    stepSecLastQ: round(median(stepSecs.slice(-q))),
    stepSecSlope: round(slope(stepSecs), 3),
    reqSecMedian: round(median(reqSecs)),
    reqSecFirstQ: round(median(reqSecs.slice(0, rq))),
    reqSecLastQ: round(median(reqSecs.slice(-rq))),
    maxInputTokens: requests.length ? Math.max(...requests.map((r) => r.input)) : null,
    lastInputTokens: requests.length ? requests.at(-1).input : null,
    compactions: events.filter((e) => e.type === "debug" && /^Trimmed old screenshots/.test(e.text)).length,
    unreadableReplies: events.filter((e) => e.type === "debug" && /could not be read/.test(e.text)).length,
    loopNotes: toolResults.filter((e) => /\[Loop check\]/.test(textOf(e.content))).length,
    toolErrors: errors.length,
    topErrors: Object.entries(errorCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([text, n]) => `${n}x ${text}`),
    toolCounts,
    tabsOpened: calls.filter((c) => (c.name === "tabs" && c.input?.action === "create") || (c.name === "navigate" && c.input?.new_tab)).length,
    guardBlocks: events.filter((e) => e.type === "guard" && /block/i.test(e.verdict || "")).length,
    replyChars: events.filter((e) => e.type === "reply").reduce((n, e) => n + e.text.length, 0),
  };
}
