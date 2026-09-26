// Feed parsing and normalization. Pure functions, no network, so they can be
// unit tested against fixtures.
import { XMLParser } from 'fast-xml-parser';
import { createHash } from 'node:crypto';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  textNodeName: '#text',
  cdataPropName: false,
  processEntities: true,
  htmlEntities: true,
  trimValues: true,
});

const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

const text = (v) => {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === 'object') return text(v['#text'] ?? '');
  return '';
};

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
};

function decodeEntities(str) {
  return str.replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function stripHtml(html = '') {
  // Decode twice: some feeds double-encode (&amp;hellip;).
  return decodeEntities(
    decodeEntities(
      String(html)
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]+>/g, ' '),
    ),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

export function excerpt(html, max = 280) {
  const t = stripHtml(html)
    // WordPress boilerplate: "The post X appeared first on Y."
    .replace(/\s*The post .{1,300}? appeared first on .{1,120}?\.?$/, '')
    .replace(/\s*(Continue reading|Read more)\s*(…|\.\.\.)?\s*$/i, '')
    .replace(/\s*\[(…|\.\.\.)\]\s*$/, '…')
    .trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(' ') > max * 0.6 ? cut.lastIndexOf(' ') : max).replace(/[,;:\s]+$/, '') + '…';
}

function atomLink(links) {
  const list = arr(links);
  const alt = list.find((l) => !l['@rel'] || l['@rel'] === 'alternate') ?? list[0];
  return alt ? alt['@href'] ?? text(alt) : '';
}

function toDate(v) {
  const s = text(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.valueOf()) ? null : d;
}

/** Parse RSS 2.0, RSS 1.0 (RDF) or Atom into raw entries. */
export function parseFeed(xml) {
  const doc = parser.parse(xml);
  if (doc.rss?.channel) {
    const ch = arr(doc.rss.channel)[0];
    return arr(ch.item).map((it) => ({
      title: text(it.title),
      link: text(it.link) || text(it.guid),
      guid: text(it.guid),
      date: toDate(it.pubDate ?? it['dc:date']),
      summary: text(it.description) || text(it['content:encoded']),
      categories: arr(it.category).map(text).filter(Boolean),
      image: it['media:content']?.['@url'] ?? it.enclosure?.['@url'] ?? null,
    }));
  }
  if (doc.feed) {
    return arr(doc.feed.entry).map((e) => ({
      title: text(e.title),
      link: atomLink(e.link),
      guid: text(e.id),
      date: toDate(e.published ?? e.updated),
      summary: text(e.summary) || text(e.content) || text(e['media:group']?.['media:description']),
      categories: arr(e.category).map((c) => c['@term'] ?? text(c)).filter(Boolean),
      image: e['media:group']?.['media:thumbnail']?.['@url'] ?? null,
    }));
  }
  if (doc['rdf:RDF']) {
    return arr(doc['rdf:RDF'].item).map((it) => ({
      title: text(it.title),
      link: text(it.link),
      guid: it['@rdf:about'] ?? '',
      date: toDate(it['dc:date']),
      summary: text(it.description),
      categories: [],
      image: null,
    }));
  }
  throw new Error('Not an RSS, RDF or Atom document');
}

// Village and variant names map to their municipality. Longer, more specific
// names are listed first so "North Attleborough" never also counts as "Attleboro".
const PLACE_ALIASES = [
  ['north-attleborough', ['north attleborough', 'north attleboro', 'n. attleborough', 'n. attleboro', 'no. attleboro']],
  ['attleboro', ['south attleboro', 'attleboro falls', 'attleboro']],
  ['dartmouth', ['north dartmouth', 'south dartmouth', 'dartmouth']],
  ['easton', ['north easton', 'south easton', 'easton']],
  ['freetown', ['east freetown', 'assonet', 'freetown']],
  ['new-bedford', ['new bedford']],
  ['fall-river', ['fall river', 'durfee']],
  ['swansea', ['ocean grove', 'swansea']],
  ['somerset', ['pottersville', 'somerset']],
  ['dighton', ['north dighton', 'dighton']],
  ['taunton', ['east taunton', 'taunton']],
  ['westport', ['westport point', 'central village', 'westport']],
  ['acushnet', ['acushnet']],
  ['berkley', ['berkley']],
  ['fairhaven', ['fairhaven']],
  ['mansfield', ['mansfield']],
  ['norton', ['norton']],
  ['raynham', ['raynham']],
  ['rehoboth', ['rehoboth']],
  ['seekonk', ['seekonk']],
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ALIAS_RES = PLACE_ALIASES.map(([slug, names]) => [
  slug,
  new RegExp(`\\b(?:${names.map(esc).join('|')})\\b`, 'gi'),
]);

// Places elsewhere that share a Bristol County town name.
const FALSE_FRIENDS = [
  /\bdartmouth college\b/gi,
  /\bdartmouth,? (?:n\.?h\.?|nova scotia|devon)\b/gi,
  /\bwestport,? (?:ct|conn\.?|connecticut)\b/gi,
  /\bnorton,? (?:oh|ohio|va|virginia|ks|kansas)\b/gi,
  /\bmansfield,? (?:oh|ohio|tx|texas|ct|conn\.?|pa)\b/gi,
  /\bsomerset,? (?:nj|new jersey|pa|ky|county)\b/gi,
  /\beaston,? (?:pa|md|pennsylvania|maryland)\b/gi,
  /\bswansea,? (?:wales|il|illinois|sc)\b/gi,
  /\bnorton (?:healthcare|antivirus|simon)\b/gi,
];

export function matchTowns(str) {
  let s = ` ${str} `;
  for (const re of FALSE_FRIENDS) s = s.replace(re, ' ');
  const found = [];
  for (const [slug, re] of ALIAS_RES) {
    re.lastIndex = 0;
    if (re.test(s)) {
      found.push(slug);
      // Remove matches so shorter aliases (e.g. "attleboro") can't re-match.
      re.lastIndex = 0;
      s = s.replace(re, ' ');
    }
  }
  return found;
}

// "Bristol County" means Massachusetts unless the text says Rhode Island.
const COUNTY_RE = /\bbristol county\b/i;
const RI_COUNTY_RE = /\bbristol county,? (?:r\.?\s?i\.?\b|rhode island)|\brhode island'?s bristol county\b/i;

export const mentionsBristolCountyMA = (str) => COUNTY_RE.test(str) && !RI_COUNTY_RE.test(str);

const SECTION_RULES = [
  ['public-safety', /\b(ICE|police|arrest(?:ed)?|charged|crash|fire(?:fighters?)?|shooting|stabbing|murder|homicide|district attorney|court|arraign|sentenced|indicted|overdose|rescue)\b/i],
  ['schools', /\b(school|schools|superintendent|student|students|teacher|teachers|classroom|MCAS|DESE|graduat)/i],
  ['government', /\b(council|select ?board|selectmen|town meeting|mayor|budget|zoning|planning board|ordinance|election|ballot|warrant|state rep|senator|legislat)/i],
  ['real-estate', /\b(housing|apartments?|development|developer|condo|real estate|home sales?|affordable housing|MBTA communities)\b/i],
  ['food-drink', /\b(restaurant|bakery|café|cafe|brewery|pizza|diner|food truck|chef|menu)\b/i],
  ['business', /\b(business|opens|opening|closing|closes|jobs|layoffs|company|store|retail|economy|power outages?|lose power)\b/i],
  ['things-to-do', /\b(festival|concert|parade|exhibit|museum|farmers market|things to do|book sale|open house)\b/i],
];

export function guessSection(str, fallback = 'news') {
  for (const [section, re] of SECTION_RULES) if (re.test(str)) return section;
  return fallback;
}

export const itemId = (link, title) =>
  createHash('sha1').update((link || title).trim().toLowerCase()).digest('hex').slice(0, 12);

/**
 * Turn raw feed entries into wire items for one source.
 *
 * Institutional sources (a town hall, police department or agenda center,
 * i.e. anything that isn't category "news" and has defaultTowns) speak for
 * their own town, so every item is kept and tagged with that town.
 *
 * Everything else must name at least one of the 20 Bristol County
 * municipalities (or a village within one) in its headline or summary.
 * An item that names no town but mentions Bristol County (Massachusetts)
 * is kept as countywide: it appears in the main wire but on no town page.
 * "South Coast" doesn't count; it also covers Plymouth County towns.
 */
export function normalize(entries, source, now = new Date()) {
  const out = [];
  const institutional = source.category !== 'news' && source.defaultTowns?.length > 0;
  for (const e of entries) {
    let title = stripHtml(e.title);
    if (!title || !e.link) continue;
    // Google News appends " - Publisher" to titles.
    if (source.via === 'google-news') title = title.replace(/\s+-\s+[^-]{2,80}$/, '');
    let summary = source.via === 'google-news' ? '' : excerpt(e.summary);
    // CivicPlus and others repeat the headline as the description.
    if (summary.toLowerCase().startsWith(title.toLowerCase())) summary = summary.slice(title.length).replace(/^[\s:.-]+/, '');
    const haystack = `${title} ${summary} ${e.categories.join(' ')}`;
    // Headline towns win; the summary often names opponents, hometowns, etc.
    const titleTowns = matchTowns(title);
    const matched = titleTowns.length ? titleTowns : matchTowns(haystack);
    const countywide = !institutional && matched.length === 0 && mentionsBristolCountyMA(haystack);
    if (!institutional && matched.length === 0 && !countywide) continue;
    const towns = institutional ? source.defaultTowns : matched;
    const date = e.date && e.date <= now ? e.date : now;
    out.push({
      id: itemId(e.link, title),
      title,
      link: e.link.trim(),
      summary,
      date: date.toISOString(),
      source: source.id,
      sourceName: source.name,
      category: source.category,
      // Headline only: summaries mislead ("the whale charged the ship" is not crime news).
      section: source.section ?? guessSection(title),
      towns,
      ...(countywide ? { countywide: true } : {}),
    });
  }
  return out;
}

/** National Weather Service alerts (api.weather.gov GeoJSON). */
export function normalizeNws(json) {
  return (json.features ?? []).map((f) => {
    const p = f.properties ?? {};
    return {
      id: p.id,
      event: p.event,
      headline: p.headline,
      severity: p.severity,
      urgency: p.urgency,
      areas: p.areaDesc,
      effective: p.effective,
      expires: p.ends ?? p.expires,
      description: excerpt(p.description, 400),
      instruction: excerpt(p.instruction ?? '', 400),
      link: `https://alerts.weather.gov/search?id=${encodeURIComponent(p.id ?? '')}`,
    };
  });
}

/** Merge new items into the stored list: dedupe, sort newest first, prune. */
export function mergeItems(existing, incoming, { maxAgeDays = 45, maxItems = 2000, now = new Date() } = {}) {
  const byId = new Map(existing.map((i) => [i.id, i]));
  const titleKey = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const seenTitles = new Set(existing.map((i) => titleKey(i.title)));
  for (const item of incoming) {
    if (byId.has(item.id)) {
      // Keep the first-seen date so items don't jump around between runs.
      byId.set(item.id, { ...item, date: byId.get(item.id).date });
    } else if (!seenTitles.has(titleKey(item.title))) {
      byId.set(item.id, item);
      seenTitles.add(titleKey(item.title));
    }
  }
  const cutoff = now.valueOf() - maxAgeDays * 864e5;
  return [...byId.values()]
    .filter((i) => new Date(i.date).valueOf() >= cutoff)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, maxItems);
}
