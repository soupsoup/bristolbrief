// Which stories the admin's main list shows. One table row per story makes the
// page heavy (about 2.5 KB each), and Vercel rejects responses over 4.5 MB, so
// the list is bounded two ways:
//   - pro-team feeds (Red Sox, Patriots, Bruins, Celtics, Revolution) add
//     thousands of stories and get their own capped view;
//   - the main list shows the last two weeks by default, with links to look
//     further back, and never more than MAX_ROWS rows.

export const TEAM_VIEW_LIMIT = 300;
export const DEFAULT_DAYS = 14;
export const MAX_ROWS = 800;

/** "?days=" value: a number of days, or "all". Anything else is the default. */
export function parseDays(value) {
  if (value === 'all') return Infinity;
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), 365) : DEFAULT_DAYS;
}

/**
 * @param items  every story
 * @param opts.teams  true for the pro-team view
 * @param opts.days   how far back the main list reaches (Infinity for everything kept)
 * @returns rows to render (newest first), how many team stories the main list leaves out,
 *          how many older stories fall outside the window, and whether the cap cut the list
 */
export function adminRows(items, { teams = false, days = DEFAULT_DAYS, now = new Date() } = {}) {
  const newestFirst = (a, b) => b.date.localeCompare(a.date);
  const team = items.filter((i) => i.team).sort(newestFirst);
  if (teams) return { rows: team.slice(0, TEAM_VIEW_LIMIT), teamCount: team.length, olderCount: 0, capped: team.length > TEAM_VIEW_LIMIT };
  const since = days === Infinity ? 0 : now.valueOf() - days * 864e5;
  const news = items.filter((i) => !i.team).sort(newestFirst);
  const inWindow = news.filter((i) => Date.parse(i.date) >= since);
  return {
    rows: inWindow.slice(0, MAX_ROWS),
    teamCount: team.length,
    olderCount: news.length - inWindow.length,
    capped: inWindow.length > MAX_ROWS,
  };
}
