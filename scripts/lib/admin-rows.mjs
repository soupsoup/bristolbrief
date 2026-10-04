// Which stories the admin lists show. One table row per story makes a page
// heavy (about 2.5 KB each) and Vercel rejects responses over 4.5 MB, so the
// admin splits stories three ways:
//   - the main page is the daily manager: the last RECENT_DAYS days;
//   - the archive holds older stories, filtered and paged on the server;
//   - pro-team feeds (Red Sox, Patriots, Bruins, Celtics, Revolution) add
//     thousands of stories and get their own capped view.

export const RECENT_DAYS = 7;
export const MAX_ROWS = 800;
export const TEAM_VIEW_LIMIT = 300;
export const ARCHIVE_PAGE_SIZE = 100;

const newestFirst = (a, b) => b.date.localeCompare(a.date);

/** Newest first, split into recent news, archived news and pro-team stories. */
export function splitStories(items, { now = new Date() } = {}) {
  const since = now.valueOf() - RECENT_DAYS * 864e5;
  const team = items.filter((i) => i.team).sort(newestFirst);
  const news = items.filter((i) => !i.team).sort(newestFirst);
  const recent = news.filter((i) => Date.parse(i.date) >= since);
  const archive = news.filter((i) => Date.parse(i.date) < since);
  return { recent, archive, team };
}

/**
 * Rows for the main page: the last RECENT_DAYS days (capped), or the pro-team view.
 * Also reports how many stories sit in the archive and the team list.
 */
export function adminRows(items, { teams = false, now = new Date() } = {}) {
  const { recent, archive, team } = splitStories(items, { now });
  if (teams) return { rows: team.slice(0, TEAM_VIEW_LIMIT), teamCount: team.length, archiveCount: archive.length, capped: team.length > TEAM_VIEW_LIMIT };
  return { rows: recent.slice(0, MAX_ROWS), teamCount: team.length, archiveCount: archive.length, capped: recent.length > MAX_ROWS };
}

// Same meaning as the town filter on the main page.
function matchesTown(i, town) {
  if (!town) return true;
  if (town === 'countywide') return Boolean(i.countywide);
  if (town === 'none') return !(i.towns?.length) && !i.countywide;
  return (i.towns ?? []).includes(town);
}

/** A positive whole number from a query string, else 1. */
export const parsePage = (value) => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 1 ? n : 1;
};

/**
 * One page of the archive, filtered on the server.
 * @param filters  q (headline or source text), source (id), section (slug), town (slug, "countywide" or "none"), sort ("newest" or "oldest"), page
 */
export function archivePage(items, { now = new Date(), q = '', source = '', section = '', town = '', sort = 'newest', page = 1 } = {}) {
  const { archive } = splitStories(items, { now });
  const needle = q.toLowerCase().trim();
  const matched = archive.filter(
    (i) =>
      (!needle || `${i.title} ${i.originalTitle ?? ''} ${i.sourceName}`.toLowerCase().includes(needle)) &&
      (!source || i.source === source) &&
      (!section || (i.sections ?? []).includes(section)) &&
      matchesTown(i, town),
  );
  if (sort === 'oldest') matched.reverse();
  const pages = Math.max(1, Math.ceil(matched.length / ARCHIVE_PAGE_SIZE));
  const current = Math.min(parsePage(page), pages);
  return {
    rows: matched.slice((current - 1) * ARCHIVE_PAGE_SIZE, current * ARCHIVE_PAGE_SIZE),
    total: matched.length,
    archiveCount: archive.length,
    page: current,
    pages,
  };
}
