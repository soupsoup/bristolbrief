// Render a manual story body. Deliberately small: blank lines separate
// paragraphs, "## " starts a subheading, "> " a quote, "- " a list item,
// and bare URLs become links. Everything is HTML-escaped first.

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const inline = (s: string) =>
  esc(s)
    .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" rel="noopener">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

export function renderBody(text = '') {
  const out: string[] = [];
  let para: string[] = [];
  let list: string[] = [];
  let quote: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br />')}</p>`);
    if (list.length) out.push(`<ul>${list.map((l) => `<li>${inline(l)}</li>`).join('')}</ul>`);
    if (quote.length) out.push(`<blockquote>${quote.map(inline).join('<br />')}</blockquote>`);
    para = [];
    list = [];
    quote = [];
  };
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) {
      flush();
    } else if (line.startsWith('## ')) {
      flush();
      out.push(`<h2>${inline(line.slice(3))}</h2>`);
    } else if (/^[-*] /.test(line)) {
      if (para.length || quote.length) flush();
      list.push(line.slice(2));
    } else if (line.startsWith('>')) {
      if (para.length || list.length) flush();
      quote.push(line.replace(/^>\s?/, ''));
    } else {
      if (list.length || quote.length) flush();
      para.push(line);
    }
  }
  flush();
  return out.join('\n');
}
