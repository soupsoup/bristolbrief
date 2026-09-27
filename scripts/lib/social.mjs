// Social media posts featured on the site. X (Twitter) and Bluesky posts are
// looked up through their public oEmbed endpoints (no API key); any other link
// is shown as a simple card with text the editor provides.
// Pure functions except `fetchOembed`, which does the network call.

export class SocialError extends Error {}

const X_RE = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{1,25})/i;
const BSKY_RE = /^https?:\/\/(?:www\.)?bsky\.app\/profile\/([a-z0-9.:-]+)\/post\/([a-z0-9]+)/i;

/** Identify the platform and a canonical URL. Throws on anything that isn't an http(s) link. */
export function parseSocialUrl(raw) {
  const url = String(raw ?? '').trim();
  let m = url.match(X_RE);
  if (m) {
    return { platform: 'x', url: `https://x.com/${m[1]}/status/${m[2]}`, key: `x-${m[2]}`, handle: m[1] };
  }
  m = url.match(BSKY_RE);
  if (m) {
    return { platform: 'bluesky', url: `https://bsky.app/profile/${m[1]}/post/${m[2]}`, key: `bsky-${m[2]}`, handle: m[1] };
  }
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new SocialError('Paste the full link to the post, starting with https://');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new SocialError('Paste the full link to the post, starting with https://');
  u.hash = '';
  const host = u.hostname.replace(/^www\./, '');
  const key = `link-${host}${u.pathname}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
  return { platform: 'link', url: u.toString(), key, handle: null, host };
}

const decode = (s) =>
  s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e) => {
      if (e[0] === '#') {
        const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : m;
      }
      return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…' }[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+/g, ' ')
    .trim();

/** Pull text, author and date out of an oEmbed response. */
export function parseOembed(platform, json) {
  const html = String(json?.html ?? '');
  const para = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  const text = para ? decode(para[1]) : '';
  if (platform === 'x') {
    const author = String(json?.author_name ?? '').trim();
    const handle = (String(json?.author_url ?? '').match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})/i) ?? [])[1] ?? null;
    const date = (html.match(/<a [^>]*>([^<]+)<\/a>\s*<\/blockquote>/i) ?? [])[1] ?? null;
    return { text, authorName: author || handle, handle, postedLabel: date ? decode(date) : null };
  }
  if (platform === 'bluesky') {
    const uri = (html.match(/data-bluesky-uri="(at:\/\/[^"]+)"/) ?? [])[1] ?? null;
    const cid = (html.match(/data-bluesky-cid="([a-z0-9]+)"/i) ?? [])[1] ?? null;
    const nameMatch = String(json?.author_name ?? '').match(/^(.*?)\s*\(@([^)]+)\)\s*$/);
    return {
      text,
      authorName: nameMatch ? nameMatch[1] : String(json?.author_name ?? ''),
      handle: nameMatch ? nameMatch[2] : null,
      postedLabel: null,
      ...(uri && /^at:\/\/did:[a-z0-9:.]+\/app\.bsky\.feed\.post\/[a-z0-9]+$/i.test(uri) && { uri }),
      ...(cid && { cid }),
    };
  }
  return { text };
}

/** Look a post up through its platform's public oEmbed endpoint. Returns null if unavailable. */
export async function fetchOembed(parsed, { fetchImpl = fetch } = {}) {
  const endpoint =
    parsed.platform === 'x'
      ? `https://publish.x.com/oembed?omit_script=true&dnt=true&url=${encodeURIComponent(parsed.url)}`
      : parsed.platform === 'bluesky'
        ? `https://embed.bsky.app/oembed?url=${encodeURIComponent(parsed.url)}`
        : null;
  if (!endpoint) return null;
  try {
    const res = await fetchImpl(endpoint, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; BristolBriefBot/1.0)', accept: 'application/json' },
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return parseOembed(parsed.platform, await res.json());
  } catch {
    return null;
  }
}
