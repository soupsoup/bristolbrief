// Which stories the admin lists show. A table row is about 2.5 KB and Vercel
// rejects responses over 4.5 MB, so every admin list is filtered, sorted and
// paged on the server, PAGE_SIZE stories at a time. Stories split three ways:
//   - recent: news from the last RECENT_DAYS days, the daily manager on /admin/;
//   - archive: older news, on /admin/archive/;
//   - team: pro-team feeds (Red Sox, Patriots, Bruins, Celtics, Revolution),
//     thousands of stories, reached from a link on /admin/.

export const RECENT_DAYS = 7;
export const PAGE_SIZE = 50;
export const STORY_SORTS = ['newest', 'oldest', 'section', 'town', 'source', 'title'];

const newestFirst = (a, b) => b.date.localeCompare(a.date);
const byText = (a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' });

/** Newest first, split into recent news, archived news and pro-team stories. */
export function splitStories(items, { now = new Date() } = {}) {
  const since = now.valueOf() - RECENT_DAYS * 864e5;
  const team = items.filter((i) => i.team).sort(newestFirst);
  const news = items.filter((i) => !i.team).sort(newestFirst);
  const recent = news.filter((i) => Date.parse(i.date) >= since);
  const archive = news.filter((i) => Date.parse(i.date) < since);
  return { recent, archive, team };
}

/** A positive whole number from a query string, else 1. */
export const parsePage = (value) => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 1 ? n : 1;
};

// Same meaning as the town menu.
function matchesTown(i, town) {
  if (!town) return true;
  if (town === 'countywide') return Boolean(i.countywide);
  if (town === 'none') return !i.towns?.length && !i.countywide;
  return (i.towns ?? []).includes(town);
}

const STATUS = {
  featured: (i) => i.featuredRank != null,
  edited: (i) => Boolean(i.edited),
  hidden: (i) => Boolean(i.hidden),
  manual: (i) => Boolean(i.manual),
  photo: (i) => Boolean(i.image),
};

/**
 * One page of one list, filtered and sorted.
 * @param opts.scope   "recent", "archive" or "teams"
 * @param opts.q       text in the headline, original headline or source name
 * @param opts.source  source id
 * @param opts.category  feed type (news, public-safety, government, meetings, sports)
 * @param opts.section   section slug
 * @param opts.status    featured, edited, hidden, manual or photo
 * @param opts.town      town slug, "countywide" or "none"
 * @param opts.within    only stories published in the last N hours (leaves out undated ones)
 * @param opts.sort      one of STORY_SORTS
 * @param opts.sectionOrder  section slugs in site order, for the "section" sort
 * @param opts.townLabel     slug to display name, for the "town" sort
 */
export function queryStories(
  items,
  { scope = 'recent', now = new Date(), q = '', source = '', category = '', section = '', status = '', town = '', within = 0, sort = 'newest', page = 1, sectionOrder = [], townLabel = (s) => s } = {},
) {
  const split = splitStories(items, { now });
  const pool = split[scope === 'teams' ? 'team' : scope] ?? split.recent;
  const needle = q.toLowerCase().trim();
  const since = within > 0 ? now.valueOf() - within * 3600e3 : 0;
  const matched = pool.filter(
    (i) =>
      (!needle || `${i.title} ${i.originalTitle ?? ''} ${i.sourceName}`.toLowerCase().includes(needle)) &&
      (!source || i.source === source) &&
      (!category || i.category === category) &&
      (!section || (i.sections ?? []).includes(section)) &&
      (!status || STATUS[status]?.(i)) &&
      matchesTown(i, town) &&
      (!since || (!i.undated && Date.parse(i.date) >= since)),
  );

  // The menu's orderings; ties go to the newest story.
  const sectionKey = (i) => String(Math.max(0, sectionOrder.indexOf((i.sections ?? [])[0]))).padStart(2, '0');
  // Named towns first (A to Z), then Region, then stories with no town.
  const townKey = (i) => (i.towns?.length ? i.towns.map(townLabel).sort(byText)[0] : i.countywide ? '￿1' : '￿2');
  const SORTS = {
    oldest: (a, b) => a.date.localeCompare(b.date),
    section: (a, b) => sectionKey(a).localeCompare(sectionKey(b)) || newestFirst(a, b),
    town: (a, b) => townKey(a).localeCompare(townKey(b)) || newestFirst(a, b),
    source: (a, b) => byText(a.sourceName ?? '', b.sourceName ?? '') || newestFirst(a, b),
    title: (a, b) => byText(a.title ?? '', b.title ?? ''),
  };
  if (SORTS[sort]) matched.sort(SORTS[sort]);

  const pages = Math.max(1, Math.ceil(matched.length / PAGE_SIZE));
  const current = Math.min(parsePage(page), pages);
  return {
    rows: matched.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE),
    total: matched.length,
    counts: { recent: split.recent.length, archive: split.archive.length, team: split.team.length },
    poolSize: pool.length,
    sourceIds: [...new Set(pool.map((i) => i.source))],
    page: current,
    pages,
    pageSize: PAGE_SIZE,
  };
}

/** Page links to show: the first and last page and a few around the current one, with gaps marked null. */
export function pageNumbers(page, pages, around = 2) {
  const out = [];
  let last = 0;
  for (let n = 1; n <= pages; n++) {
    if (n === 1 || n === pages || Math.abs(n - page) <= around) {
      if (n - last > 1) out.push(null);
      out.push(n);
      last = n;
    }
  }
  return out;
}
