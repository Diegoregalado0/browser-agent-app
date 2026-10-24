// Trajectory recording: per task, exactly what the model was sent (messages, system prompt
// and tool definitions) and what it answered, with each tool call's outcome, as material for
// supervised fine-tuning data. Preparation only: nothing is recorded unless the
// recordTrajectories setting is on, never in Ghost mode, only in internal builds (the host
// supplies the recorder), and nothing is ever sent anywhere; records go to a local sink
// (extension/trajectory-store.js in the panel, scripts/trajectory-file.js for the benchmark).
//
// Privacy is applied before a record reaches its sink: passwords typed into password fields
// are hidden (Agent.secretCalls, withoutSecret) wherever they appear, the redaction classes
// below replace personal and secret-looking text, steps on sensitive sites are dropped,
// screenshots become placeholders, and the provider's native copy of each reply (raw) is
// never kept.
//
// A record, one per task (schema TRAJECTORY_SCHEMA):
//   id, runId (the benchmark run, else null), sessionId, taskIndex, startedAt, endedAt
//   provider, model, settings (thinking, effort, experiments...), sampling (null: the server's
//   defaults, which the agent does not set), promptHash, toolSchemaHash, system, tools
//   steps[]: index, at, page (the tab's address when the reply came), input { prefix, messages }
//     (the request's messages are the previous step's first `prefix` messages followed by
//     these; see inputsOf), output { content, stop, error, usage, latencyMs, firstTokenMs },
//     toolResults[] { id, name, isError, durationMs, content }
//   end { reason, error, page { url, title } }, reason one of END_REASONS
//   excluded: null, or { reason: "sensitive_site", fromStep } when the task reached one
//   outcome { label }: "unlabeled" until the benchmark sets it from its checker
//   screenshots: "omitted" or "inline"; redactions: counts by class

import { SECRET_FIELD, redactSecrets } from "./browser-tools.js";
import { isSensitiveSite } from "./limits.js";
import { withoutSecret } from "./agent.js";

export const TRAJECTORY_SCHEMA = "browsby-trajectory/1";
export const END_REASONS = ["reply", "ask_user", "max_steps", "loop_stop", "limit", "refusal", "error", "user_stop"];
// Kept on write by every sink: records older than maxDays go, then the oldest past maxTrajectories.
export const RETENTION = { maxDays: 30, maxTrajectories: 1000 };
export const SCREENSHOT_PLACEHOLDER = "[screenshot not stored]";
const DAY_MS = 86400000;

// ---- Redaction ----

// Keys whose values are identifiers, labels or encoded data rather than text anyone wrote.
const STRUCTURAL = new Set([
  "type", "id", "nativeId", "name", "role", "mediaType", "stop", "data", "file", "schema", "runId", "sessionId",
  "provider", "model", "promptHash", "toolSchemaHash", "startedAt", "endedAt", "at", "label", "reason", "screenshots",
]);
// Query parameters that carry secrets or personal details besides SECRET_FIELD's.
const SECRET_PARAM = /^(code|state|sig|signature|nonce|ticket|sid|key|email|e-mail|mail|phone|tel|hash)$/i;
const URL_RE = /\bhttps?:\/\/[^\s"'<>\\)\]]+/gi;
// Well-known key and token formats, and JSON web tokens.
const KNOWN_TOKEN = /\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|glpat-[A-Za-z0-9_-]{20,}|bzk1_[A-Za-z0-9_-]{40,}|bgk_[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/g;
const AUTH_HEADER = /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/-]{8,}=*/g;
// A long run of key characters with digits and both cases, the shape of a random key. Hex
// hashes (no capitals) and ordinary words are left alone.
const LONG_RUN = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_-])/g;
const looksRandom = (s) => /\d/.test(s) && /[a-z]/.test(s) && /[A-Z]/.test(s);
const IBAN_RE = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/g;
const CARD_RE = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
// International numbers with a +, and numbers grouped with spaces, dots or dashes, (415) 555-0100
// style. Bare digit runs (order numbers, ids) are not phone numbers here.
const PHONE_RE = /(?<![\w+])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?|\d{2,4}[\s.-])\d{3,4}[\s.-]?\d{3,4}(?![\w])/g;
// A one-time code where the text says it is one ("verification code is 482913", "OTP: 1234").
const CODE_RE = /\b(code|otp|pin|passcode|one[- ]time password)\b([^\n\d]{0,20}?)(?<!\d)(\d{4,8})(?!\d)/gi;
// Typed text that is only 6 to 8 digits is most often a one-time code.
const TYPED_CODE = /^\s*\d{6,8}\s*$/;

function luhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return sum % 10 === 0;
}

function ibanValid(compact) {
  const moved = compact.slice(4) + compact.slice(0, 4);
  let rest = 0;
  for (const ch of moved) for (const d of /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55)) rest = (rest * 10 + Number(d)) % 97;
  return rest === 1;
}

// An address with secret-looking query values, fragments and sign-in details hidden.
function redactUrl(raw) {
  const hashAt = raw.indexOf("#");
  const base = hashAt < 0 ? raw : raw.slice(0, hashAt);
  let hash = hashAt < 0 ? null : raw.slice(hashAt + 1);
  const queryAt = base.indexOf("?");
  const path = (queryAt < 0 ? base : base.slice(0, queryAt)).replace(/^(https?:\/\/)[^/@]*@/i, "$1[hidden]@");
  let query = queryAt < 0 ? null : base.slice(queryAt + 1);
  const decode = (s) => {
    try {
      return decodeURIComponent(s.replace(/\+/g, " "));
    } catch {
      return s;
    }
  };
  if (query) {
    query = query
      .split("&")
      .map((pair) => {
        const at = pair.indexOf("=");
        if (at < 0) return pair;
        const key = decode(pair.slice(0, at));
        const value = decode(pair.slice(at + 1));
        const secret = SECRET_FIELD.test(key) || SECRET_PARAM.test(key) || (value.length >= 16 && looksRandom(value)) || EMAIL_RE.test(value);
        EMAIL_RE.lastIndex = 0;
        return secret ? `${pair.slice(0, at)}=[hidden]` : pair;
      })
      .join("&");
  }
  // A fragment carrying values (#access_token=...) or long enough to be a token.
  if (hash && (hash.includes("=") || hash.length > 16)) hash = "[hidden]";
  return `${path}${query !== null ? `?${query}` : ""}${hash !== null ? `#${hash}` : ""}`;
}

// A redactor for one trajectory. secrets: text typed into password fields, hidden wherever it
// appears. counts: replacements by class.
export function redactor(secrets = []) {
  const counts = {};
  const hidden = [...new Set(secrets.filter((s) => typeof s === "string" && s.length >= 4))].sort((a, b) => b.length - a.length);
  const sub = (text, re, cls, fn) =>
    text.replace(re, (...m) => {
      const out = fn(...m);
      if (out !== m[0]) counts[cls] = (counts[cls] ?? 0) + 1;
      return out;
    });
  const text = (s) => {
    for (const secret of hidden) if (s.includes(secret)) s = sub(s, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "password", () => "[hidden]");
    s = sub(s, URL_RE, "url", redactUrl);
    const fields = redactSecrets(s);
    if (fields !== s) counts.secretField = (counts.secretField ?? 0) + 1;
    s = sub(fields, AUTH_HEADER, "token", (m, scheme) => `${scheme} [token]`);
    s = sub(s, KNOWN_TOKEN, "token", () => "[token]");
    s = sub(s, LONG_RUN, "token", (m) => (looksRandom(m) ? "[token]" : m));
    s = sub(s, IBAN_RE, "iban", (m) => (ibanValid(m.replace(/ /g, "")) ? "[iban]" : m));
    s = sub(s, CARD_RE, "card", (m) => {
      const digits = m.replace(/\D/g, "");
      return digits.length >= 13 && digits.length <= 19 && luhn(digits) ? "[card]" : m;
    });
    s = sub(s, EMAIL_RE, "email", () => "[email]");
    s = sub(s, PHONE_RE, "phone", (m) => {
      const n = m.replace(/\D/g, "").length;
      return n >= 8 && n <= 15 ? "[phone]" : m;
    });
    return sub(s, CODE_RE, "code", (m, word, between) => `${word}${between}[code]`);
  };
  const value = (v) => {
    if (typeof v === "string") return text(v);
    if (Array.isArray(v)) return v.map(value);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, STRUCTURAL.has(k) ? x : value(x)]));
    return v;
  };
  return { text, value, counts };
}

// ---- Retention and reading records back ----

// The records a sink keeps after a write, oldest first.
export function retain(records, { maxDays, maxTrajectories } = RETENTION, now = Date.now()) {
  const since = now - maxDays * DAY_MS;
  const kept = records.filter((r) => Date.parse(r.endedAt) >= since).sort((a, b) => Date.parse(a.endedAt) - Date.parse(b.endedAt));
  return kept.slice(Math.max(0, kept.length - maxTrajectories));
}

// Every step's full request messages, rebuilt from the stored prefixes.
export function inputsOf(record) {
  let previous = [];
  return record.steps.map((s) => (previous = [...previous.slice(0, s.input.prefix), ...s.input.messages]));
}

// ---- Recorder ----

const sha = async (text) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 12);

export class TrajectoryRecorder {
  // sink: { append(record, retention) }. allowed(): false while nothing may be recorded
  // (Ghost mode), checked when a task starts and again before its record is written.
  // sessionId(): the saved conversation's id, read when the task ends.
  constructor({ sink, allowed = () => true, sessionId = () => null, retention = RETENTION }) {
    this.sink = sink;
    this.allowed = allowed;
    this.sessionId = sessionId;
    this.retention = retention;
    this.current = null;
    this.pending = Promise.resolve();
  }

  // Resolves once every record of an ended task is written.
  idle() {
    return this.pending;
  }

  begin(agent, task, { config, model, system, tools }) {
    this.current = null;
    if (!config.recordTrajectories || !this.allowed()) return;
    // The tasks of this conversation before this one: requests the user sent.
    const taskIndex = agent.messages
      .slice(0, task.firstMessage)
      .filter((m) => m.role === "user" && !m.content.some((b) => b.type === "tool_result") && m.content.some((b) => b.type === "text" && !b.text.startsWith("[Agent]"))).length;
    this.current = { agent, task, config, model, system, tools, taskIndex, steps: [], startedAt: new Date().toISOString(), error: null };
  }

  // A model reply. messages: what the provider was sent; kept as references (the agent replaces
  // messages rather than changing them), so serializing at the end costs nothing per step.
  step({ messages, result, ms, firstTokenMs }) {
    const t = this.current;
    if (!t) return;
    const url = Promise.resolve()
      .then(() => t.agent.browser.currentUrl())
      .catch(() => "");
    t.steps.push({ sent: messages.slice(), output: result, ms, firstTokenMs, at: new Date().toISOString(), url, tools: [] });
  }

  // A tool call starting; its duration (safety checks and prompts included) runs to the next
  // call's start or to toolsDone.
  toolStart(call) {
    const step = this.current?.steps.at(-1);
    if (!step) return;
    this.#closeTool(step);
    step.tools.push({ call, started: Date.now() });
  }

  toolsDone() {
    const step = this.current?.steps.at(-1);
    if (step) this.#closeTool(step);
  }

  fail(err) {
    if (this.current) this.current.error = String(err?.message ?? err);
  }

  #closeTool(step) {
    const last = step.tools.at(-1);
    if (last && last.ms === undefined) last.ms = Date.now() - last.started;
  }

  // The task ended (finished or stopped). Everything that can change afterwards (the page, the
  // history, the password marks, which a new conversation replaces) is read now; the record
  // is built and written in the background (see idle).
  end(agent, task) {
    const t = this.current;
    if (!t || t.task !== task) return;
    this.current = null;
    const last = t.steps.at(-1);
    if (last) this.#closeTool(last);
    if (!this.allowed()) return;
    const snapshot = {
      reason: this.#reason(agent, task, t),
      page: agent.browser.currentPage().catch(() => null),
      urls: t.steps.map((s) => s.url),
      finalMessages: agent.messages.slice(),
      secretCalls: agent.secretCalls,
      sessionId: this.sessionId(),
    };
    const write = this.#write(t, snapshot).catch((err) => console.error(`Could not record the trajectory: ${err.message}`));
    this.pending = this.pending.then(() => write);
  }

  #reason(agent, task, t) {
    if (task.controller.signal.aborted) return "user_stop";
    if (t.error) return "error";
    if (agent.loopGuard?.stopReason) return "loop_stop";
    const last = t.steps.at(-1);
    if (!last) return "error";
    const limits = t.config.limits ?? {};
    const atMax = t.steps.length >= t.config.maxSteps;
    if (limits.taskTokens && agent.taskTokens >= limits.taskTokens) return "limit";
    if (last.output.stop === "refusal") return "refusal";
    if (last.output.stop === "unreadable") return atMax ? "max_steps" : "error";
    const calls = last.output.content.filter((b) => b.type === "tool_call");
    if (calls.some((c) => c.name === "ask_user")) return "ask_user";
    if (!calls.length) return "reply";
    // Calls that never ran stopped at a usage limit; calls that ran used the last step.
    return last.tools.length && atMax ? "max_steps" : "limit";
  }

  async #write(t, snap) {
    const config = t.config;
    const sensitive = (url) => typeof url === "string" && isSensitiveSite(url, config.sensitiveSites ?? []);
    const urls = await Promise.all(snap.urls);
    const page = await snap.page;
    // Steps from the first one on a sensitive site are dropped (every later request carries
    // that site's content), and so is the content of the tool results that led there.
    const cut = urls.findIndex(sensitive);
    if (cut === 0) return;
    const steps = cut < 0 ? t.steps : t.steps.slice(0, cut);
    const lastResultsHidden = cut > 0 || sensitive(page?.url);

    const isSecret = (b) => snap.secretCalls.has(b);
    const secrets = [];
    const keep = Boolean(config.recordScreenshots);
    const cleanBlock = (b) => {
      if (b.type === "image") return keep ? { type: "image", mediaType: b.mediaType, data: b.data } : { type: "image", mediaType: b.mediaType, omitted: SCREENSHOT_PLACEHOLDER };
      if (b.type === "tool_call") {
        let input = b.input;
        if (isSecret(b)) {
          secrets.push(input?.text, input?.value);
          input = withoutSecret(input);
        }
        const typed = b.name === "form_input" ? "value" : b.name === "browser" && input?.action === "type" ? "text" : null;
        if (typed && typeof input[typed] === "string" && TYPED_CODE.test(input[typed])) input = { ...input, [typed]: "[code]" };
        return { type: "tool_call", id: b.id, ...(b.nativeId !== undefined && { nativeId: b.nativeId }), name: b.name, input };
      }
      if (b.type === "tool_result") return { ...b, content: (b.content ?? []).map(cleanBlock) };
      return b;
    };
    const cleanMessage = (m) => ({ role: m.role, content: m.content.map(cleanBlock) });
    // Results as they were first sent: in the next request, or for the last step the history.
    const resultsIn = (messages) => new Map(messages.flatMap((m) => (m.role === "user" ? m.content.filter((b) => b.type === "tool_result").map((r) => [r.id, r]) : [])));

    let previous = [];
    const recorded = steps.map((s, i) => {
      let prefix = 0;
      while (prefix < previous.length && prefix < s.sent.length && previous[prefix] === s.sent[prefix]) prefix++;
      previous = s.sent;
      const results = resultsIn(t.steps[i + 1]?.sent ?? snap.finalMessages);
      const hideResults = lastResultsHidden && i === steps.length - 1;
      return {
        index: i,
        at: s.at,
        page: urls[i] || null,
        input: { prefix, messages: s.sent.slice(prefix).map(cleanMessage) },
        output: {
          content: (s.output.content ?? []).map(cleanBlock),
          stop: s.output.stop ?? null,
          ...(s.output.error && { error: String(s.output.error) }),
          usage: s.output.usage ?? null,
          latencyMs: s.ms,
          firstTokenMs: s.output.metrics?.firstTokenMs ?? s.firstTokenMs ?? null,
        },
        toolResults: s.tools.map(({ call, ms }) => {
          const r = results.get(call.id);
          return { id: call.id, name: call.name, isError: Boolean(r?.isError), durationMs: ms ?? null, content: hideResults ? [] : r ? r.content.map(cleanBlock) : null };
        }),
      };
    });

    const thinking = config.provider === "ollama" ? config.localThinking : config.thinking;
    const record = {
      schema: TRAJECTORY_SCHEMA,
      id: crypto.randomUUID(),
      runId: null,
      sessionId: snap.sessionId,
      taskIndex: t.taskIndex,
      startedAt: t.startedAt,
      endedAt: new Date().toISOString(),
      provider: config.provider,
      model: t.model,
      settings: {
        thinking: Boolean(thinking),
        effort: config.effort ?? null,
        openaiEffort: config.openaiEffort ?? null,
        localKind: config.provider === "ollama" ? config.localKind : null,
        contextSize: config.provider === "ollama" ? config.ollamaContext : null,
        permissionMode: config.permissionMode,
        maxSteps: config.maxSteps,
        experiments: config.experiments ?? {},
      },
      sampling: null,
      promptHash: await sha(t.system),
      toolSchemaHash: await sha(JSON.stringify(t.tools)),
      system: t.system,
      steps: recorded,
      end: {
        reason: snap.reason,
        error: t.error,
        page: sensitive(page?.url) ? { url: "[sensitive site]", title: "[sensitive site]" } : { url: page?.url ?? null, title: page?.title ?? null },
      },
      excluded: cut > 0 ? { reason: "sensitive_site", fromStep: cut } : null,
      outcome: { label: "unlabeled" },
      screenshots: keep ? "inline" : "omitted",
    };
    const redact = redactor(secrets);
    // The tool definitions are the agent's own text and stay as sent.
    const out = { ...redact.value(record), tools: t.tools, redactions: redact.counts };
    if (!this.allowed()) return;
    await this.sink.append(out, this.retention);
  }
}
