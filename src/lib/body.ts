// Render a manual story body. Deliberately small, and shared by the story page
// and the admin's live preview:
//   blank line        new paragraph
//   ## Subhead        large subheading;  ### Subhead  small subheading
//   - item            list item
//   > quote           block quote
//   ---               divider
//   **bold**  *italic*  [link text](https://…)  and bare URLs become links.
// Everything is HTML-escaped first, and links must be http(s) or mailto.

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const inline = (s: string) => {
  // Pull out [text](url) links first so the bare-URL rule can't touch them.
  const links: string[] = [];
  const text = s.replace(/\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g, (_, label: string, url: string) => {
    links.push(`<a href="${esc(url)}" rel="noopener">${esc(label)}</a>`);
    return `\u0000${links.length - 1}\u0000`;
  });
  return esc(text)
    .replace(/(https?:\/\/[^\s<\u0000]+[^\s<.,;:!?)\u0000])/g, '<a href="$1" rel="noopener">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?![*\w])/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_([^_\s][^_]*?)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/\u0000(\d+)\u0000/g, (_, i: string) => links[+i]);
};

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
    } else if (/^-{3,}$/.test(line)) {
      flush();
      out.push('<hr />');
    } else if (line.startsWith('### ')) {
      flush();
      out.push(`<h3>${inline(line.slice(4))}</h3>`);
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
