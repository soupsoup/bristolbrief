import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMlb, normalizeNhl, normalizeFixtures, trimSchedule } from '../scripts/lib/schedules.mjs';

test('MLB schedule: results, playoff notes and upcoming games', () => {
  const team = (id, teamName) => ({ team: { id, teamName, name: `X ${teamName}` } });
  const json = {
    dates: [
      { games: [{ gamePk: 1, gameDate: '2026-09-25T17:05:00Z', gameType: 'R', status: { abstractGameState: 'Final', detailedState: 'Final' },
        teams: { away: { ...team(112, 'Cubs'), score: 3, isWinner: false }, home: { ...team(111, 'Red Sox'), score: 4, isWinner: true } } }] },
      { games: [{ gamePk: 2, gameDate: '2026-10-02T00:00:00Z', gameType: 'F', seriesDescription: 'AL Wild Card Series', seriesGameNumber: 3, ifNecessary: 'Y',
        status: { abstractGameState: 'Preview', detailedState: 'Scheduled' }, teams: { away: team(111, 'Red Sox'), home: team(147, 'Yankees') } }] },
    ],
  };
  const [done, next] = normalizeMlb(json, 111);
  assert.deepEqual([done.result, done.us, done.them, done.home, done.opponent], ['W', 4, 3, true, 'Cubs']);
  assert.equal(next.note, 'AL Wild Card Series, Game 3 (if necessary)');
  assert.equal(next.home, false);
  const t = trimSchedule([done, next], new Date('2026-09-28T12:00:00Z'));
  assert.deepEqual([t.past.map((g) => g.id), t.next.map((g) => g.id)], [['mlb-1'], ['mlb-2']]);
});

test('NHL schedule: overtime losses and preseason notes', () => {
  const json = {
    games: [
      { id: 9, startTimeUTC: '2026-09-25T23:00:00Z', gameType: 1, gameState: 'OFF', gameOutcome: { lastPeriodType: 'OT' },
        awayTeam: { abbrev: 'BOS', score: 2, commonName: { default: 'Bruins' } }, homeTeam: { abbrev: 'WSH', score: 3, commonName: { default: 'Capitals' } } },
    ],
  };
  const [g] = normalizeNhl(json, 'BOS');
  assert.deepEqual([g.result, g.opponent, g.home, g.note], ['OTL', 'Capitals', false, 'Preseason · OT']);
});

test('fixturedownload schedule: Patriots results and next games', () => {
  const json = [
    { MatchNumber: 30, RoundNumber: 3, DateUtc: '2026-09-27 17:00:00Z', HomeTeam: 'Jacksonville Jaguars', AwayTeam: 'New England Patriots', HomeTeamScore: 35, AwayTeamScore: 6 },
    { MatchNumber: 45, RoundNumber: 4, DateUtc: '2026-10-04 17:00:00Z', HomeTeam: 'Buffalo Bills', AwayTeam: 'New England Patriots', HomeTeamScore: null, AwayTeamScore: null },
    { MatchNumber: 46, RoundNumber: 4, DateUtc: '2026-10-04 17:00:00Z', HomeTeam: 'Miami Dolphins', AwayTeam: 'New York Jets', HomeTeamScore: null, AwayTeamScore: null },
  ];
  const games = normalizeFixtures(json, 'New England Patriots', { prefix: 'nfl', week: true });
  assert.equal(games.length, 2);
  assert.deepEqual([games[0].result, games[0].us, games[0].them, games[0].opponent, games[0].home, games[0].note], ['L', 6, 35, 'Jaguars', false, 'Week 3']);
  assert.deepEqual([games[1].status, games[1].opponent, games[1].date], ['scheduled', 'Bills', '2026-10-04T17:00:00.000Z']);
});
