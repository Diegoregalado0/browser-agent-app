// Notes panel: the session notepad (src/notes.js) as the agent keeps it, read-only, updated
// live while a task runs. A new conversation starts with an empty notepad.

export function createNotesPanel({ $, el, setInertBehind, renderMarkdown, toast }) {
  const panel = $("notes-panel");
  const body = $("notes-body");
  const button = $("open-notes");
  let notes = "";
  // Where focus goes back to when the panel closes.
  let opener = null;

  function render() {
    body.replaceChildren();
    if (!notes) {
      body.append(el("p", "group-desc", "When a task needs the agent to keep track of something exactly, such as prices, names or a list it is working through, it writes it here. Each conversation has its own notes."));
    } else {
      const text = el("div", "notes-text");
      text.innerHTML = renderMarkdown(notes);
      body.append(text);
    }
    $("copy-notes").disabled = !notes;
    button.classList.toggle("has-notes", Boolean(notes));
  }

  function set(text) {
    notes = text || "";
    render();
  }

  $("copy-notes").onclick = async () => {
    await navigator.clipboard.writeText(notes);
    toast("Copied the notes");
  };

  render();
  return {
    open() {
      if (panel.hidden) opener = document.activeElement;
      panel.hidden = false;
      setInertBehind(panel, true);
      $("notes-title").focus();
    },
    close() {
      if (panel.hidden) return;
      const hadFocus = panel.contains(document.activeElement) || document.activeElement === document.body;
      panel.hidden = true;
      setInertBehind(panel, false);
      if (hadFocus) (opener?.isConnected && opener.offsetParent ? opener : $("input")).focus();
    },
    get isOpen() {
      return !panel.hidden;
    },
    handlers: {
      notes: (msg) => set(msg.text),
      conversation: (msg) => set(msg.notes),
      cleared: () => set(""),
    },
  };
}
