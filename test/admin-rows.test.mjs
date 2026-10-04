import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminRows, parseDays, TEAM_VIEW_LIMIT, DEFAULT_DAYS, MAX_ROWS } from '../scripts/lib/admin-rows.mjs';

const NOW = new Date('2026-10-04T12:00:00Z');
const ago = (days) => new Date(NOW.valueOf() - days * 864e5).toISOString();
const story = (id, team, daysAgo = 1) => ({ id, date: ago(daysAgo), ...(team && { team }) });

test('the main list leaves out pro-team stories and reports how many', () => {
  const { rows, teamCount, capped } = adminRows([story('a'), story('b', 'red-sox'), story('c'), story('d', 'bruins')], { now: NOW });
  assert.deepEqual(rows.map((r) => r.id), ['a', 'c']);
  assert.equal(teamCount, 2);
  assert.equal(capped, false);
});

test('the team view shows only team stories, capped at the newest ones', () => {
  const items = [story('news'), ...Array.from({ length: TEAM_VIEW_LIMIT + 25 }, (_, n) => ({ id: `t${n}`, team: 'patriots', date: ago(n / 100) }))];
  const { rows, teamCount, capped } = adminRows(items, { teams: true, now: NOW });
  assert.equal(rows.length, TEAM_VIEW_LIMIT);
  assert.equal(rows[0].id, 't0');
  assert.ok(rows.every((r) => r.team));
  assert.equal(teamCount, TEAM_VIEW_LIMIT + 25);
  assert.equal(capped, true);
});

test('with no team stories nothing is hidden or capped', () => {
  const two = [story('a', null, 1), story('b', null, 2)];
  assert.deepEqual(adminRows(two, { now: NOW }), { rows: two, teamCount: 0, olderCount: 0, capped: false });
  assert.deepEqual(adminRows([], { teams: true, now: NOW }), { rows: [], teamCount: 0, olderCount: 0, capped: false });
});

test('the main list shows the last two weeks, newest first, and counts what it leaves out', () => {
  const items = [story('old', null, 40), story('recent', null, 3), story('edge', null, 13.9), story('older', null, 15)];
  const got = adminRows(items, { now: NOW });
  assert.deepEqual(got.rows.map((r) => r.id), ['recent', 'edge']);
  assert.equal(got.olderCount, 2);
  assert.deepEqual(adminRows(items, { now: NOW, days: 45 }).rows.map((r) => r.id), ['recent', 'edge', 'older', 'old']);
  assert.deepEqual(adminRows(items, { now: NOW, days: Infinity }).olderCount, 0);
});

test('the main list never exceeds the row cap', () => {
  const items = Array.from({ length: MAX_ROWS + 50 }, (_, n) => ({ id: `s${n}`, date: ago(n / 1000) }));
  const got = adminRows(items, { now: NOW });
  assert.equal(got.rows.length, MAX_ROWS);
  assert.equal(got.capped, true);
  assert.equal(got.rows[0].id, 's0');
});

test('parseDays accepts a day count or "all" and falls back to the default', () => {
  assert.equal(parseDays(null), DEFAULT_DAYS);
  assert.equal(parseDays('45'), 45);
  assert.equal(parseDays('all'), Infinity);
  assert.equal(parseDays('nonsense'), DEFAULT_DAYS);
  assert.equal(parseDays('0'), DEFAULT_DAYS);
  assert.equal(parseDays('9999'), 365);
});
