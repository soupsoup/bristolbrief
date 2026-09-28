// Team schedules and results for the Sports page, from free public JSON (no
// key): MLB's Stats API and the NHL's api-web for the Red Sox and Bruins, and
// fixturedownload.com's season files for the Patriots and Celtics (ESPN's
// site API rejects automated requests). fixturedownload covers the regular
// season only: no preseason or playoff games.

// Season files are named for the year the season starts.
const nflSeason = (now) => (now.getUTCMonth() >= 2 ? now.getUTCFullYear() : now.getUTCFullYear() - 1);
const nbaSeason = (now) => (now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1);

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
  {
    team: 'patriots',
    league: 'NFL',
    url: (now) => `https://fixturedownload.com/feed/json/nfl-${nflSeason(now)}`,
    normalize: (json) => normalizeFixtures(json, 'New England Patriots', { prefix: 'nfl', week: true }),
  },
  {
    team: 'celtics',
    league: 'NBA',
    url: (now) => `https://fixturedownload.com/feed/json/nba-${nbaSeason(now)}`,
    normalize: (json) => normalizeFixtures(json, 'Boston Celtics', { prefix: 'nba' }),
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

// "Seattle Seahawks" -> "Seahawks"; two-word nicknames kept whole.
const TWO_WORD = /\b(Trail Blazers|Red Sox|White Sox|Blue Jays)$/;
const nickname = (name) => name.match(TWO_WORD)?.[1] ?? name.split(' ').pop();

/** fixturedownload.com season file (array of matches) → games, oldest first. */
export function normalizeFixtures(json, teamName, { prefix, week = false }) {
  const games = [];
  for (const m of Array.isArray(json) ? json : []) {
    if (m.HomeTeam !== teamName && m.AwayTeam !== teamName) continue;
    const home = m.HomeTeam === teamName;
    const usScore = home ? m.HomeTeamScore : m.AwayTeamScore;
    const themScore = home ? m.AwayTeamScore : m.HomeTeamScore;
    const final = usScore != null && themScore != null;
    games.push({
      id: `${prefix}-${m.MatchNumber}`,
      date: new Date(m.DateUtc.replace(' ', 'T')).toISOString(),
      home,
      opponent: nickname(home ? m.AwayTeam : m.HomeTeam),
      status: final ? 'final' : 'scheduled',
      ...(final ? { us: usScore, them: themScore, result: usScore > themScore ? 'W' : usScore < themScore ? 'L' : 'T' } : {}),
      ...(week && m.RoundNumber ? { note: `Week ${m.RoundNumber}` } : {}),
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
