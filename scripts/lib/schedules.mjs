// Team schedules and results for the Sports page, from the leagues' own public
// JSON APIs (no key): MLB's Stats API and the NHL's api-web. ESPN's API would
// cover the NFL and NBA too, but it rejects automated requests.

export const SCHEDULE_TEAMS = [
  {
    team: 'red-sox',
    league: 'MLB',
    url: (now) => {
      const day = (d) => new Date(now.valueOf() + d * 864e5).toISOString().slice(0, 10);
      return `https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=111&startDate=${day(-21)}&endDate=${day(45)}&hydrate=team`;
    },
    normalize: (json) => normalizeMlb(json, 111),
  },
  {
    team: 'bruins',
    league: 'NHL',
    url: () => 'https://api-web.nhle.com/v1/club-schedule-season/BOS/now',
    normalize: (json) => normalizeNhl(json, 'BOS'),
  },
];

// How many results and upcoming games to keep per team.
const KEEP_PAST = 5;
const KEEP_NEXT = 5;

const MLB_ROUNDS = { F: 'Wild Card', D: 'Division Series', L: 'LCS', W: 'World Series' };

/** MLB Stats API /schedule → games, oldest first. */
export function normalizeMlb(json, teamId) {
  const games = [];
  for (const day of json.dates ?? []) {
    for (const g of day.games ?? []) {
      const home = g.teams.home.team.id === teamId;
      const us = home ? g.teams.home : g.teams.away;
      const them = home ? g.teams.away : g.teams.home;
      const state = g.status?.abstractGameState;
      const detailed = g.status?.detailedState ?? '';
      const status = /postponed|cancel/i.test(detailed) ? 'postponed' : state === 'Final' ? 'final' : state === 'Live' ? 'live' : 'scheduled';
      let note = '';
      if (g.gameType === 'S') note = 'Spring training';
      else if (MLB_ROUNDS[g.gameType]) {
        note = g.seriesDescription || MLB_ROUNDS[g.gameType];
        if (g.seriesGameNumber) note += `, Game ${g.seriesGameNumber}`;
        if (g.ifNecessary === 'Y') note += ' (if necessary)';
      }
      games.push({
        id: `mlb-${g.gamePk}`,
        date: g.gameDate,
        tbd: Boolean(g.status?.startTimeTBD),
        home,
        opponent: them.team.teamName ?? them.team.name,
        status,
        ...(status === 'final' || status === 'live' ? { us: us.score ?? 0, them: them.score ?? 0 } : {}),
        ...(status === 'final' ? { result: us.isWinner ? 'W' : them.isWinner ? 'L' : 'T' } : {}),
        ...(note ? { note } : {}),
        ...(status === 'postponed' ? { note: detailed } : {}),
      });
    }
  }
  return games.sort((a, b) => a.date.localeCompare(b.date));
}

/** NHL api-web /club-schedule-season → games, oldest first. */
export function normalizeNhl(json, abbrev) {
  const games = [];
  for (const g of json.games ?? []) {
    const home = g.homeTeam.abbrev === abbrev;
    const us = home ? g.homeTeam : g.awayTeam;
    const them = home ? g.awayTeam : g.homeTeam;
    const st = g.gameState;
    const status = st === 'FINAL' || st === 'OFF' ? 'final' : st === 'LIVE' || st === 'CRIT' ? 'live' : g.gameScheduleState === 'PPD' ? 'postponed' : 'scheduled';
    const extra = g.gameOutcome?.lastPeriodType;
    const notes = [g.gameType === 1 ? 'Preseason' : g.gameType === 3 ? 'Playoffs' : '', extra && extra !== 'REG' ? extra : ''].filter(Boolean);
    let result;
    if (status === 'final') result = us.score > them.score ? 'W' : extra && extra !== 'REG' ? 'OTL' : 'L';
    games.push({
      id: `nhl-${g.id}`,
      date: g.startTimeUTC,
      tbd: g.gameScheduleState === 'TBD',
      home,
      opponent: them.commonName?.default ?? them.placeName?.default ?? them.abbrev,
      status,
      ...(status === 'final' || status === 'live' ? { us: us.score ?? 0, them: them.score ?? 0 } : {}),
      ...(result ? { result } : {}),
      ...(notes.length ? { note: notes.join(' · ') } : {}),
    });
  }
  return games.sort((a, b) => a.date.localeCompare(b.date));
}

/** The latest results and the next games (live games count as next). */
export function trimSchedule(games, now = new Date()) {
  const iso = now.toISOString();
  const past = games.filter((g) => g.status === 'final' || (g.status === 'postponed' && g.date < iso));
  const next = games.filter((g) => g.status === 'live' || (g.status !== 'final' && g.date >= iso) || (g.status === 'scheduled' && g.date < iso && Date.parse(iso) - Date.parse(g.date) < 5 * 3600e3));
  return { past: past.slice(-KEEP_PAST).reverse(), next: next.slice(0, KEEP_NEXT) };
}
