// Minimal Markdown for replies: bold, italic, inline code, http(s) links, bullet and
// numbered lists. A table row becomes a bullet of its cells and a heading becomes bold,
// since the panel is too narrow for either. Everything is escaped first, so reply text
// cannot inject HTML.
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
  const isRow = (l) => /^\s*\|.*\|\s*$/.test(l);
  const isSeparator = (l) => isRow(l) && /^[\s|:-]+$/.test(l);
  // Blank lines between table rows are dropped, and so is the header row above a separator.
  const lines = src.split("\n").filter((l, i, all) => l.trim() || !(isRow(all[i - 1] ?? "") && isRow(all.slice(i + 1).find((n) => n.trim()) ?? "")));
  const header = new Set(lines.flatMap((l, i) => (isSeparator(l) && isRow(lines[i - 1] ?? "") ? [i - 1] : [])));
  for (let [index, line] of lines.entries()) {
    if (header.has(index)) continue;
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (heading) line = `**${heading[1]}**`;
    if (isRow(line)) {
      // A header separator or empty row adds nothing; other rows keep their filled cells.
      const cells = line.trim().slice(1, -1).split("|").map((c) => c.trim()).filter((c) => c && !/^[-:\s]+$/.test(c) && c !== "—" && c !== "-");
      if (!cells.length) continue;
      line = `- ${cells.join(" · ")}`;
    }
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
