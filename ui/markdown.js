// Minimal Markdown for replies: bold, italic, inline code, http(s) links, bullet and
// numbered lists. Everything is escaped first, so reply text cannot inject HTML.
export function renderMarkdown(src) {
  const link = (href, text) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const inline = (t) =>
    esc(t)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
      // Links in one pass, so a URL inside a link is never turned into markup again.
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)"<]+)\)|(^|[\s(])(https?:\/\/[^\s)"<]+)/g, (_, text, url, before, bare) =>
        text ? link(url, text) : `${before}${link(bare, bare)}`,
      );
  const out = [];
  let list = null;
  for (const line of src.split("\n")) {
    const item = /^\s*(?:[-*]|(\d+)\.)\s+(.*)$/.exec(line);
    if (item) {
      const tag = item[1] ? "ol" : "ul";
      if (list !== tag) {
        if (list) out.push(`</${list}>`);
        out.push(`<${tag}>`);
        list = tag;
      }
      out.push(`<li>${inline(item[2])}</li>`);
      continue;
    }
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
    out.push(line.trim() ? `<p>${inline(line)}</p>` : "");
  }
  if (list) out.push(`</${list}>`);
  return out.join("");
}
