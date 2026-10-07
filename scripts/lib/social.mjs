// Social media posts featured on the site. X (Twitter) and Bluesky posts are
// looked up through their public oEmbed endpoints and Mastodon posts through
// the server's public API (no keys); any other link is shown as a simple card
// with text the editor provides. The hourly scan (`scanSocial`) finds
// candidate posts on Bluesky and Mastodon for editors to approve.
// Pure functions except `fetchOembed` and `scanSocial`, which do network calls.

import { matchTowns } from './parse.mjs';

export class SocialError extends Error {}

const X_RE = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{1,25})/i;
const BSKY_RE = /^https?:\/\/(?:www\.)?bsky\.app\/profile\/([a-z0-9.:-]+)\/post\/([a-z0-9]+)/i;
// Mastodon (and compatible servers) post pages: https://server/@user/123456
const MASTODON_RE = /^https:\/\/([a-z0-9.-]+\.[a-z]{2,})\/@([A-Za-z0-9_.]{1,64})(?:@[a-z0-9.-]+)?\/(\d{6,25})\/?$/i;

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
  m = url.split(/[?#]/)[0].match(MASTODON_RE);
  if (m) {
    const host = m[1].toLowerCase();
    return {
      platform: 'mastodon',
      url: `https://${host}/@${m[2]}/${m[3]}`,
      key: `mastodon-${host.replace(/[^a-z0-9]+/g, '-')}-${m[3]}`,
      handle: `${m[2]}@${host}`,
      host,
      statusId: m[3],
    };
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

const UA = { 'user-agent': 'Mozilla/5.0 (compatible; BristolBriefBot/1.0; +https://bristolbrief.com/sources/)', accept: 'application/json' };

/** Mastodon HTML content to plain text, keeping paragraph breaks. */
export function mastodonText(html = '') {
  return decode(String(html).replace(/<\/p>\s*<p>/gi, '\n\n'));
}

const httpsUrl = (u) => (typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : undefined);

/** A Mastodon API status to a post record. */
export function normalizeMastodonStatus(st) {
  const s = st?.reblog ?? st;
  if (!s?.url || !s.account) return null;
  let parsed;
  try {
    parsed = parseSocialUrl(s.url);
  } catch {
    return null;
  }
  const media = (s.media_attachments ?? []).find((m) => m.type === 'image');
  return {
    platform: parsed.platform === 'mastodon' ? 'mastodon' : 'link',
    url: parsed.url,
    key: parsed.key,
    text: mastodonText(s.content),
    authorName: decode(s.account.display_name || s.account.username || ''),
    handle: s.account.acct.includes('@') ? s.account.acct : `${s.account.acct}@${parsed.host ?? ''}`.replace(/@$/, ''),
    postedAt: s.created_at,
    isReply: Boolean(s.in_reply_to_id),
    sensitive: Boolean(s.sensitive || s.spoiler_text),
    ...(httpsUrl(media?.preview_url) && { image: media.preview_url, imageAlt: media.description ?? '' }),
  };
}

/** A Bluesky search result post to a post record. */
export function normalizeBlueskyPost(p) {
  const rkey = String(p?.uri ?? '').split('/').pop();
  const handle = p?.author?.handle;
  if (!rkey || !handle || !p.record?.text) return null;
  const img = p.embed?.images?.[0] ?? p.embed?.media?.images?.[0];
  return {
    platform: 'bluesky',
    url: `https://bsky.app/profile/${handle}/post/${rkey}`,
    key: `bsky-${rkey}`,
    text: String(p.record.text).replace(/\r\n?/g, '\n').trim(),
    authorName: p.author.displayName || handle,
    handle,
    postedAt: p.record.createdAt ?? p.indexedAt,
    uri: p.uri,
    cid: p.cid,
    isReply: Boolean(p.record.reply),
    sensitive: (p.labels ?? []).some((l) => /porn|sexual|nudity|graphic|gore/i.test(l.val ?? '')),
    ...(httpsUrl(img?.thumb) && { image: img.thumb, imageAlt: img.alt ?? '' }),
  };
}

// Town names that are also common elsewhere (Dartmouth NH/UK, Westport CT,
// Somerset UK/NJ, Taunton UK, Acushnet the golf company, …). Posts naming
// only these need a Massachusetts cue.
const AMBIGUOUS = new Set(['dartmouth', 'westport', 'easton', 'norton', 'mansfield', 'somerset', 'swansea', 'berkley', 'taunton', 'acushnet']);
const MA_CUE = /\b(MA|Mass\.?|Massachusetts|South ?Coast|Bristol Co(?:unty|\.)?(?!,? R\.?I))\b/;

/** Towns a post is about, or [] when it isn't clearly Bristol County, Mass. */
export function socialTowns(text) {
  const towns = matchTowns(text);
  if (towns.length === 0) return [];
  const clear = towns.some((t) => !AMBIGUOUS.has(t)) || MA_CUE.test(text);
  return clear ? towns : [];
}

/** Bluesky search terms and Mastodon hashtags the hourly scan uses. */
export const BLUESKY_QUERIES = [
  '"New Bedford"', '"Fall River"', 'Taunton', 'Attleboro', '"North Attleborough"', '"North Attleboro"',
  'Fairhaven', 'Acushnet', 'Seekonk', 'Rehoboth', 'Raynham', 'Dighton', 'Freetown', 'Assonet',
  '"Dartmouth MA"', '"Westport MA"', '"Easton MA"', '"Norton MA"', '"Mansfield MA"', '"Somerset MA"',
  '"Swansea MA"', '"Berkley MA"', '"Bristol County"', '"SouthCoast"',
];
export const MASTODON_TAGS = [
  'NewBedford', 'NewBedfordMA', 'FallRiver', 'FallRiverMA', 'Taunton', 'TauntonMA', 'Attleboro',
  'BristolCounty', 'SouthCoast', 'SouthCoastMA', 'Fairhaven', 'Dartmouth', 'Westport',
];
export const MASTODON_SERVERS = ['mastodon.social'];

/**
 * Search Bluesky and Mastodon for recent Bristol County posts. Returns
 * candidates (newest first) with the towns they mention, skipping replies,
 * reposts and posts flagged sensitive.
 */
export async function scanSocial({ fetchImpl = fetch, maxAgeDays = 7, now = new Date() } = {}) {
  const get = async (url) => {
    const res = await fetchImpl(url, { headers: UA, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };
  const found = new Map();
  const errors = [];
  const add = (post) => {
    if (!post || post.isReply || post.sensitive || !post.text) return;
    // Text only: account names like "NWS Boston/Norton" would tag every alert as Norton.
    const towns = socialTowns(post.text);
    if (!towns.length) return;
    if (now.valueOf() - new Date(post.postedAt).valueOf() > maxAgeDays * 864e5) return;
    const { isReply, sensitive, ...rest } = post;
    found.set(post.key, { id: `s-${post.key}`, ...rest, towns });
  };

  await Promise.all(
    BLUESKY_QUERIES.map(async (q) => {
      try {
        const json = await get(`https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?sort=latest&limit=40&q=${encodeURIComponent(q)}`);
        (json.posts ?? []).forEach((p) => add(normalizeBlueskyPost(p)));
      } catch (err) {
        errors.push(`bluesky ${q}: ${err.message}`);
      }
    }),
  );
  await Promise.all(
    MASTODON_SERVERS.flatMap((server) =>
      MASTODON_TAGS.map(async (tag) => {
        try {
          const json = await get(`https://${server}/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=40`);
          (Array.isArray(json) ? json : []).forEach((st) => add(normalizeMastodonStatus(st)));
        } catch (err) {
          errors.push(`mastodon ${server} #${tag}: ${err.message}`);
        }
      }),
    ),
  );
  const posts = [...found.values()].sort((a, b) => String(b.postedAt).localeCompare(String(a.postedAt)));
  return { posts, errors };
}

/** Look a post up through its platform's public oEmbed endpoint. Returns null if unavailable. */
export async function fetchOembed(parsed, { fetchImpl = fetch } = {}) {
  if (parsed.platform === 'mastodon') {
    try {
      const res = await fetchImpl(`https://${parsed.host}/api/v1/statuses/${parsed.statusId}`, {
        headers: UA,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return null;
      const post = normalizeMastodonStatus(await res.json());
      return post && { text: post.text, authorName: post.authorName, handle: post.handle, postedAt: post.postedAt, image: post.image, imageAlt: post.imageAlt };
    } catch {
      return null;
    }
  }
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

/**
 * When a post went up on its own platform, in ms. Bluesky and Mastodon give an exact time
 * (`postedAt`); X's embed gives only a date label ("September 26, 2026"). A post with neither
 * falls back to when an editor added it.
 */
export function postedTime(post) {
  for (const raw of [post?.postedAt, post?.postedLabel]) {
    const t = raw ? Date.parse(raw) : NaN;
    if (Number.isFinite(t)) return t;
  }
  const added = Date.parse(post?.addedAt ?? '');
  return Number.isFinite(added) ? added : 0;
}

/** Newest first by the time posted on the original platform; ties go to the one added later. */
export function sortByPosted(posts) {
  return [...posts].sort((a, b) => postedTime(b) - postedTime(a) || Date.parse(b.addedAt ?? '') - Date.parse(a.addedAt ?? '') || 0);
}
