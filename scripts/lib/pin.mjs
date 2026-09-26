// Pinned lead story. Shared by the site build (src/lib/wire.ts) and the
// `npm run pin` command. Pure functions, no file access.

/** Compare URLs loosely: ignore protocol, www, trailing slash, tracking params. */
export function normalizeUrl(url = '') {
  try {
    const u = new URL(url.trim());
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|mc_)/i.test(k)) u.searchParams.delete(k);
    u.hash = '';
    const host = u.hostname.replace(/^www\./, '');
    return `${host}${u.pathname.replace(/\/+$/, '')}${u.search}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

/** Find wire items matching a URL or a piece of the headline. */
export function findItems(items, query) {
  const q = query.trim();
  if (/^https?:\/\//i.test(q)) {
    const n = normalizeUrl(q);
    return items.filter((i) => normalizeUrl(i.link) === n);
  }
  const needle = q.toLowerCase();
  return items.filter((i) => i.title.toLowerCase().includes(needle));
}

/**
 * Resolve the pin to a wire item, or null when there is no pin, it has
 * expired, or it matches nothing. A pin may carry its own title, summary,
 * source, towns and section: these override the matched item, or describe a
 * story that isn't in the wire at all (then title, url and sourceName are required).
 */
export function resolvePin(pin, items, now = new Date()) {
  if (!pin || !pin.url) return { item: null, reason: 'none' };
  if (pin.until && new Date(pin.until) <= now) return { item: null, reason: 'expired' };

  const [match] = findItems(items, pin.url);
  const overrides = Object.fromEntries(
    ['title', 'summary', 'sourceName', 'towns', 'section'].filter((k) => pin[k] != null).map((k) => [k, pin[k]]),
  );
  if (match) return { item: { ...match, ...overrides, pinned: true }, reason: 'matched' };

  if (pin.title && pin.sourceName) {
    return {
      item: {
        id: `pinned-${normalizeUrl(pin.url)}`,
        title: pin.title,
        link: pin.url,
        summary: pin.summary ?? '',
        date: pin.date ?? pin.pinnedAt ?? now.toISOString(),
        source: 'pinned',
        sourceName: pin.sourceName,
        category: 'news',
        section: pin.section ?? 'news',
        towns: pin.towns ?? [],
        pinned: true,
      },
      reason: 'manual',
    };
  }
  return { item: null, reason: 'unmatched' };
}
