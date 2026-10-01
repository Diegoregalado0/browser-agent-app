// Remote sessions: every open, non-incognito Browsby panel shares its controller on a
// BroadcastChannel, so the one panel that runs the Discord bridge can list the windows and
// send each one tasks. BroadcastChannel reaches only pages of the same origin, here the
// extension's own pages. A panel joins as a remote client of its own controller, so the
// limits on remote clients (REMOTE_MESSAGES, LOCAL_ONLY_PROMPTS) apply in every window.

const CHANNEL = "browsby-remote";
// Controller events the bridge needs; everything else (streamed text, tool output,
// screenshots) stays in the panel.
const FORWARDED = new Set(["status", "tool_call", "permission_request", "permission_closed", "reply", "error", "notice"]);

// In each panel. id: the window id. Returns stop(), for when the panel closes.
export function shareSession({ controller, id, channel = new BroadcastChannel(CHANNEL) }) {
  const state = { id, opened: Date.now(), running: false, title: null };
  const announce = () => channel.postMessage({ type: "session", session: { ...state } });
  const client = {
    send(event) {
      if (event.type === "status") state.running = event.running;
      if (event.type === "session" || event.type === "conversation") state.title = event.title ?? null;
      if (event.type === "cleared") state.title = null;
      if (["status", "session", "conversation", "cleared"].includes(event.type)) announce();
      // Notices can quote a page (injection warnings), so only stop notices go out, and a
      // step goes out as its tool and action name only, without its input.
      if (!FORWARDED.has(event.type) || (event.type === "notice" && !/^Stopped/.test(event.text))) return;
      const forward = event.type === "tool_call" ? { type: "tool_call", name: event.name, action: event.input?.action } : event;
      channel.postMessage({ type: "event", id, event: forward });
    },
  };
  const receive = controller.connect(client, { remote: true });
  channel.onmessage = ({ data }) => {
    if (data?.type === "roll") announce();
    else if (data?.type === "to" && data.id === id) receive(data.msg);
  };
  announce();
  return () => {
    channel.postMessage({ type: "gone", id });
    controller.disconnect(client);
    channel.close();
  };
}

// In the panel that runs the bridge: the open sessions, oldest first, and their events.
export class SessionDirectory {
  constructor({ channel = new BroadcastChannel(CHANNEL), onEvent = () => {} } = {}) {
    this.channel = channel;
    this.onEvent = onEvent;
    this.sessions = new Map();
    channel.onmessage = ({ data }) => {
      if (data?.type === "session") this.sessions.set(data.session.id, data.session);
      else if (data?.type === "gone") this.sessions.delete(data.id);
      else if (data?.type === "event" && this.sessions.has(data.id)) this.onEvent(data.id, data.event);
    };
    channel.postMessage({ type: "roll" });
  }

  // Sorted by when each panel opened, with "Window 1", "Window 2" names in that order.
  list() {
    return [...this.sessions.values()].sort((a, b) => a.opened - b.opened).map((s, i) => ({ ...s, name: `Window ${i + 1}` }));
  }

  send(id, msg) {
    this.channel.postMessage({ type: "to", id, msg });
  }

  close() {
    this.channel.close();
  }
}
