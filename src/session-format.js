// How a conversation is stored and shown, shared by the local session files and the
// extension edition's storage.

const TRANSCRIPT_RESULT_MAX_CHARS = 4000;
// The current-tab note the agent appends to each request.
export const CURRENT_TAB_TAG = /\n*<current_tab[^>]*\/>$/;
export const SESSION_ID_PATTERN = /^\d{8}-\d{6}-[0-9a-f]{6}$/;

export function newSessionId(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  const random = [...crypto.getRandomValues(new Uint8Array(3))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${stamp}-${random}`;
}

// Screenshots are not kept: they would make each file megabytes, and a reopened
// conversation takes fresh ones anyway.
export function withoutImages(blocks) {
  return blocks.map((b) => {
    if (b.type === "image") return { type: "text", text: "[screenshot not kept in the saved conversation]" };
    if (b.type === "tool_result") return { ...b, content: withoutImages(b.content) };
    return b;
  });
}

export function titleFor(messages) {
  const first = messages.find((m) => m.role === "user")?.content.find((b) => b.type === "text")?.text || "Untitled";
  const text = first.replace(CURRENT_TAB_TAG, "").replace(/\s+/g, " ").trim();
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

export function metaOf(session) {
  return {
    id: session.id,
    title: session.title,
    created: session.created,
    updated: session.updated,
    requests: session.messages.filter((m) => m.role === "user" && m.content.some((b) => b.type === "text")).length,
  };
}

// A stored copy of a conversation: history without screenshots, plus metadata.
export function sessionRecord({ id, title, created, messages, usage }) {
  return {
    id,
    title,
    created,
    updated: new Date().toISOString(),
    usage,
    messages: messages.map((m) => (m.role === "user" ? { ...m, content: withoutImages(m.content) } : m)),
  };
}

// The conversation as the UI renders it: requests, replies, and tool calls with results.
export function transcriptOf(messages) {
  const items = [];
  for (const m of messages) {
    for (const b of m.content) {
      if (b.type === "text") {
        items.push(m.role === "user" ? { type: "user", text: b.text.replace(CURRENT_TAB_TAG, "") } : { type: "assistant", text: b.text });
      } else if (b.type === "tool_call") {
        items.push({ type: "tool_call", id: b.id, name: b.name, input: b.input });
      } else if (b.type === "tool_result") {
        const content = b.content.map((c) =>
          c.type === "text" && c.text.length > TRANSCRIPT_RESULT_MAX_CHARS ? { ...c, text: `${c.text.slice(0, TRANSCRIPT_RESULT_MAX_CHARS)}\n[truncated]` } : c,
        );
        items.push({ type: "tool_result", id: b.id, isError: b.isError, content });
      }
    }
  }
  return items;
}
