// Editorial layer on top of the ingested wire: headline/summary edits,
// hidden items, extra sections and towns, photos, a featured (priority)
// list, and stories added by hand. Stored in src/data/editorial.json.
//
// Shared by the site build (src/lib/wire.ts), the admin API and
// `npm run pin`. Pure functions, no file or network access.

import { SECTIONS, TOWNS } from '../../src/site.config.ts';

export const EMPTY_EDITORIAL = Object.freeze({ overrides: {}, manual: [], featured: [] });

const SECTION_SLUGS = new Set(SECTIONS.map((s) => s.slug));
const TOWN_SLUGS = new Set(TOWNS.map((t) => t.slug));

export class EditorialError extends Error {}

const clean = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : v);

export function slugify(str) {
  return String(str)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70)
    .replace(/-+$/, '');
}

function checkList(values, allowed, what) {
  if (!Array.isArray(values)) throw new EditorialError(`${what} must be a list`);
  const bad = values.filter((v) => !allowed.has(v));
  if (bad.length) throw new EditorialError(`Unknown ${what}: ${bad.join(', ')}`);
  return [...new Set(values)];
}

function checkUrl(v) {
  if (!/^https?:\/\/[^\s]+$/i.test(v)) throw new EditorialError('Link must start with http:// or https://');
  return v;
}

function checkImage(v) {
  if (!/^\/uploads\/[a-z0-9/_.-]+\.(jpe?g|png|webp)$/i.test(v)) throw new EditorialError('Photo path is not a valid upload');
  return v;
}

function checkDate(v) {
  const d = new Date(v);
  if (Number.isNaN(d.valueOf())) throw new EditorialError('Invalid date');
  return d.toISOString();
}

/**
 * Validate the editable fields shared by wire overrides and manual stories.
 * `null` or "" clears a field. Returns a new object with normalized values.
 */
function validateFields(fields, { manual = false } = {}) {
  const out = {};
  for (const [key, raw] of Object.entries(fields ?? {})) {
    const v = typeof raw === 'string' ? (key === 'body' ? raw.trim() : clean(raw)) : raw;
    const empty = v == null || v === '' || (Array.isArray(v) && v.length === 0);
    switch (key) {
      case 'title':
        // null restores a feed item's own headline; manual stories always need one.
        if (v === null && !manual) {
          out.title = null;
          break;
        }
        if (empty) throw new EditorialError('Headline cannot be empty');
        if (v.length > 200) throw new EditorialError('Headline is longer than 200 characters');
        out.title = v;
        break;
      case 'summary':
        if (!empty && v.length > 600) throw new EditorialError('Summary is longer than 600 characters');
        out.summary = empty ? null : v;
        break;
      case 'sections':
        out.sections = empty ? null : checkList(v, SECTION_SLUGS, 'section');
        break;
      case 'towns':
        out.towns = empty ? null : checkList(v, TOWN_SLUGS, 'town');
        break;
      case 'image':
        out.image = empty ? null : checkImage(v);
        break;
      case 'imageAlt':
        if (!empty && v.length > 300) throw new EditorialError('Photo caption is longer than 300 characters');
        out.imageAlt = empty ? null : v;
        break;
      case 'hidden':
        out.hidden = v ? true : null;
        break;
      case 'link':
        if (!manual) throw new EditorialError('Only manual stories can change their link');
        out.link = empty ? null : checkUrl(v);
        break;
      case 'body':
        if (!manual) throw new EditorialError('Only manual stories have a body');
        if (!empty && v.length > 50000) throw new EditorialError('Story body is too long');
        out.body = empty ? null : v;
        break;
      case 'sourceName':
        if (!manual) throw new EditorialError('Only manual stories can change the source');
        out.sourceName = empty ? null : v;
        break;
      case 'date':
        if (!manual) throw new EditorialError('Only manual stories can change the date');
        out.date = empty ? null : checkDate(v);
        break;
      default:
        throw new EditorialError(`Unknown field: ${key}`);
    }
  }
  return out;
}

/** Merge fields into an object; null removes a key. */
function mergeFields(target, fields) {
  const next = { ...target };
  for (const [k, v] of Object.entries(fields)) {
    if (v == null) delete next[k];
    else next[k] = v;
  }
  return next;
}

const isActive = (entry, now) => !entry.until || new Date(entry.until) > now;

/** Normalize a possibly partial editorial document. */
export function normalizeEditorial(doc) {
  return {
    overrides: { ...(doc?.overrides ?? {}) },
    manual: [...(doc?.manual ?? [])],
    featured: [...(doc?.featured ?? [])],
  };
}

/**
 * Apply one admin operation and return a new editorial document.
 * `knownIds` (optional) lets callers reject edits to items that don't exist.
 * @param {any} doc
 * @param {any} op
 * @param {{ now?: Date, knownIds?: Set<string> }} [options]
 */
export function applyOp(doc, op, { now = new Date(), knownIds = undefined } = {}) {
  const ed = normalizeEditorial(doc);
  // Expired featured entries are dropped on every write.
  ed.featured = ed.featured.filter((f) => isActive(f, now));
  const manualIndex = (id) => ed.manual.findIndex((m) => m.id === id);
  const exists = (id) => manualIndex(id) !== -1 || !knownIds || knownIds.has(id);

  switch (op?.type) {
    case 'update': {
      if (!op.id) throw new EditorialError('Missing story id');
      const i = manualIndex(op.id);
      if (i !== -1) {
        const fields = validateFields(op.fields, { manual: true });
        // A manual story always keeps a date and a headline.
        if (fields.date === null) delete fields.date;
        if (fields.title === null) delete fields.title;
        ed.manual[i] = { ...mergeFields(ed.manual[i], fields), updatedAt: now.toISOString() };
        if (!ed.manual[i].title) throw new EditorialError('Headline cannot be empty');
        if (!ed.manual[i].sections?.length) ed.manual[i].sections = ['news'];
      } else {
        if (!exists(op.id)) throw new EditorialError('That story is no longer in the feed');
        const fields = validateFields(op.fields);
        const next = mergeFields(ed.overrides[op.id] ?? {}, fields);
        delete next.updatedAt;
        if (Object.keys(next).length === 0) delete ed.overrides[op.id];
        else ed.overrides[op.id] = { ...next, updatedAt: now.toISOString() };
      }
      return ed;
    }

    case 'feature': {
      if (!op.id || !exists(op.id)) throw new EditorialError('That story is no longer in the feed');
      const until = op.until ? checkDate(op.until) : undefined;
      if (until && new Date(until) <= now) throw new EditorialError('Featured-until time is in the past');
      const rest = ed.featured.filter((f) => f.id !== op.id);
      const entry = { id: op.id, ...(until && { until }) };
      const at = op.position === 'bottom' ? rest.length : Math.max(0, Math.min(Number(op.position) || 0, rest.length));
      rest.splice(at, 0, entry);
      ed.featured = rest;
      return ed;
    }

    case 'unfeature':
      ed.featured = ed.featured.filter((f) => f.id !== op.id);
      return ed;

    case 'move': {
      const i = ed.featured.findIndex((f) => f.id === op.id);
      if (i === -1) throw new EditorialError('That story is not featured');
      const j = op.direction === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= ed.featured.length) return ed;
      [ed.featured[i], ed.featured[j]] = [ed.featured[j], ed.featured[i]];
      return ed;
    }

    case 'addManual': {
      const fields = validateFields(op.story, { manual: true });
      if (!fields.title) throw new EditorialError('Headline cannot be empty');
      if (!fields.sections?.length) throw new EditorialError('Pick at least one section');
      let base = slugify(fields.title) || 'story';
      let slug = base;
      for (let n = 2; ed.manual.some((m) => m.slug === slug); n++) slug = `${base}-${n}`;
      const story = {
        id: `m-${slug}`,
        slug,
        ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v != null)),
        date: fields.date ?? now.toISOString(),
        createdAt: now.toISOString(),
      };
      ed.manual.unshift(story);
      if (op.feature) ed.featured.unshift({ id: story.id });
      return ed;
    }

    case 'deleteManual': {
      const i = manualIndex(op.id);
      if (i === -1) throw new EditorialError('Story not found');
      ed.manual.splice(i, 1);
      ed.featured = ed.featured.filter((f) => f.id !== op.id);
      return ed;
    }

    default:
      throw new EditorialError(`Unknown operation: ${op?.type}`);
  }
}

/** Turn a manual story into a wire-shaped item. */
function manualToItem(m) {
  return {
    id: m.id,
    title: m.title,
    link: m.link ?? `/stories/${m.slug}/`,
    summary: m.summary ?? '',
    date: m.date,
    source: 'bristol-brief',
    sourceName: m.sourceName ?? 'The Bristol Brief',
    category: 'news',
    section: m.sections[0],
    sections: m.sections,
    towns: m.towns ?? [],
    image: m.image,
    imageAlt: m.imageAlt,
    manual: true,
    slug: m.slug,
    body: m.body,
    external: Boolean(m.link),
  };
}

/**
 * Apply editorial changes to wire items. Returns all visible items (wire +
 * manual), newest first, each with a `sections` list. Hidden items are
 * dropped unless `includeHidden` is set (the admin wants to see them).
 * @param {any[]} wireItems
 * @param {any} doc
 * @param {{ now?: Date, includeHidden?: boolean }} [options]
 * @returns {any[]}
 */
export function applyEditorial(wireItems, doc, { now = new Date(), includeHidden = false } = {}) {
  const ed = normalizeEditorial(doc);
  const featuredRank = new Map(ed.featured.filter((f) => isActive(f, now)).map((f, i) => [f.id, i]));
  const out = [];
  for (const item of wireItems) {
    const o = ed.overrides[item.id] ?? {};
    if (o.hidden && !includeHidden) continue;
    out.push({
      ...item,
      ...(o.title && { title: o.title, originalTitle: item.title }),
      ...(o.summary != null && { summary: o.summary }),
      sections: o.sections ?? [item.section],
      section: (o.sections ?? [item.section])[0],
      ...(o.towns && { towns: o.towns, countywide: false }),
      ...(o.image && { image: o.image, imageAlt: o.imageAlt ?? '' }),
      ...(o.hidden && { hidden: true }),
      ...(Object.keys(o).length > 0 && { edited: true }),
      ...(featuredRank.has(item.id) && { featuredRank: featuredRank.get(item.id) }),
    });
  }
  for (const m of ed.manual) {
    const item = manualToItem(m);
    if (featuredRank.has(item.id)) item.featuredRank = featuredRank.get(item.id);
    out.push(item);
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/** Active featured items in priority order. */
export function featuredItems(items) {
  return items.filter((i) => i.featuredRank != null).sort((a, b) => a.featuredRank - b.featuredRank);
}
