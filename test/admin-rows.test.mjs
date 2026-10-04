import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminRows, archivePage, splitStories, parsePage, ARCHIVE_SORTS, RECENT_DAYS, MAX_ROWS, TEAM_VIEW_LIMIT, ARCHIVE_PAGE_SIZE } from '../scripts/lib/admin-rows.mjs';

const NOW = new Date('2026-10-04T12:00:00Z');
const ago = (days) => new Date(NOW.valueOf() - days * 864e5).toISOString();
const story = (id, daysAgo = 1, extra = {}) => ({ id, title: id, source: 's', sourceName: 'Source', sections: ['news'], towns: [], date: ago(daysAgo), ...extra });
const team = (id, daysAgo = 1) => story(id, daysAgo, { team: 'red-sox' });

test('splitStories separates recent news, archived news and pro-team stories, newest first', () => {
  const { recent, archive, team: t } = splitStories(
    [story('old', 20), story('new', 1), team('t1', 2), story('edge', 6.9), story('just-over', 7.1), team('t2', 30)],
    { now: NOW },
  );
  assert.deepEqual(recent.map((r) => r.id), ['new', 'edge']);
  assert.deepEqual(archive.map((r) => r.id), ['just-over', 'old']);
  assert.deepEqual(t.map((r) => r.id), ['t1', 't2']);
});

test('the main list is the last 7 days of news and reports the archive and team counts', () => {
  const got = adminRows([story('a', 1), team('b'), story('c', 3), story('old', 12), team('d', 40)], { now: NOW });
  assert.deepEqual(got.rows.map((r) => r.id), ['a', 'c']);
  assert.equal(got.teamCount, 2);
  assert.equal(got.archiveCount, 1);
  assert.equal(got.capped, false);
  assert.equal(RECENT_DAYS, 7);
});

test('the main list never exceeds the row cap', () => {
  const items = Array.from({ length: MAX_ROWS + 50 }, (_, n) => story(`s${n}`, n / 1000));
  const got = adminRows(items, { now: NOW });
  assert.equal(got.rows.length, MAX_ROWS);
  assert.equal(got.capped, true);
  assert.equal(got.rows[0].id, 's0');
});

test('the team view shows only team stories, capped at the newest ones', () => {
  const items = [story('news'), ...Array.from({ length: TEAM_VIEW_LIMIT + 25 }, (_, n) => team(`t${n}`, n / 100))];
  const got = adminRows(items, { teams: true, now: NOW });
  assert.equal(got.rows.length, TEAM_VIEW_LIMIT);
  assert.equal(got.rows[0].id, 't0');
  assert.ok(got.rows.every((r) => r.team));
  assert.equal(got.teamCount, TEAM_VIEW_LIMIT + 25);
  assert.equal(got.capped, true);
});

test('with nothing to split, every list is empty', () => {
  assert.deepEqual(adminRows([], { now: NOW }), { rows: [], teamCount: 0, archiveCount: 0, capped: false });
  assert.deepEqual(adminRows([], { teams: true, now: NOW }), { rows: [], teamCount: 0, archiveCount: 0, capped: false });
});

test('the archive holds news older than 7 days, never recent or team stories', () => {
  const got = archivePage([story('recent', 2), story('a', 10), team('t', 10), story('b', 30)], { now: NOW });
  assert.deepEqual(got.rows.map((r) => r.id), ['a', 'b']);
  assert.equal(got.total, 2);
  assert.equal(got.archiveCount, 2);
});

test('the archive filters by text, source, section and town on the server', () => {
  const items = [
    story('Harbor dredging plan', 10, { sourceName: 'Standard-Times', source: 'st', sections: ['government'], towns: ['fairhaven'] }),
    story('School budget vote', 11, { sourceName: 'Sun Chronicle', source: 'sc', sections: ['schools'], towns: ['attleboro'] }),
    story('Regional jobs report', 12, { source: 'sc', sections: ['business'], countywide: true }),
    story('Statewide recall notice', 13, { source: 'st', sections: ['news'] }),
  ];
  const ids = (f) => archivePage(items, { now: NOW, ...f }).rows.map((r) => r.id);
  assert.deepEqual(ids({ q: 'HARBOR' }), ['Harbor dredging plan']);
  assert.deepEqual(ids({ q: 'sun chronicle' }), ['School budget vote']);
  assert.deepEqual(ids({ source: 'sc' }), ['School budget vote', 'Regional jobs report']);
  assert.deepEqual(ids({ section: 'schools' }), ['School budget vote']);
  assert.deepEqual(ids({ town: 'fairhaven' }), ['Harbor dredging plan']);
  assert.deepEqual(ids({ town: 'countywide' }), ['Regional jobs report']);
  assert.deepEqual(ids({ town: 'none' }), ['Statewide recall notice']);
  assert.deepEqual(ids({ sort: 'oldest' }).at(0), 'Statewide recall notice');
});

test('the archive pages at 100 stories and clamps the page number', () => {
  const items = Array.from({ length: ARCHIVE_PAGE_SIZE * 2 + 30 }, (_, n) => story(`s${n}`, 8 + n / 1000));
  const p1 = archivePage(items, { now: NOW });
  const p3 = archivePage(items, { now: NOW, page: 3 });
  assert.equal(p1.rows.length, ARCHIVE_PAGE_SIZE);
  assert.equal(p1.pages, 3);
  assert.equal(p3.rows.length, 30);
  assert.equal(p3.rows[0].id, `s${ARCHIVE_PAGE_SIZE * 2}`);
  assert.equal(archivePage(items, { now: NOW, page: 99 }).page, 3);
  assert.equal(archivePage([], { now: NOW }).pages, 1);
});

test('parsePage accepts a positive whole number and falls back to 1', () => {
  assert.equal(parsePage('4'), 4);
  assert.equal(parsePage('2.9'), 2);
  for (const bad of ['', null, undefined, '0', '-3', 'x']) assert.equal(parsePage(bad), 1);
});

test('the archive sorts like the main page: section order, town, source and headline', () => {
  const items = [
    story('b-story', 9, { title: 'Bravo', sourceName: 'Zeta News', sections: ['schools'], towns: ['taunton'] }),
    story('a-story', 10, { title: 'alpha', sourceName: 'Alpha News', sections: ['news'], towns: ['attleboro'] }),
    story('region', 11, { title: 'Charlie', sourceName: 'Alpha News', sections: ['news'], countywide: true }),
    story('no-town', 12, { title: 'Delta', sourceName: 'Beta News', sections: ['government'] }),
    story('b2', 8.5, { title: 'Echo', sourceName: 'Zeta News', sections: ['news'], towns: ['attleboro'] }),
  ];
  const opts = { now: NOW, sectionOrder: ['news', 'government', 'schools'], townLabel: (s) => ({ attleboro: 'Attleboro', taunton: 'Taunton' })[s] ?? s };
  const ids = (sort) => archivePage(items, { ...opts, sort }).rows.map((r) => r.id);
  assert.deepEqual(ids('newest'), ['b2', 'b-story', 'a-story', 'region', 'no-town']);
  assert.deepEqual(ids('oldest'), ['no-town', 'region', 'a-story', 'b-story', 'b2']);
  assert.deepEqual(ids('section'), ['b2', 'a-story', 'region', 'no-town', 'b-story']);
  assert.deepEqual(ids('town'), ['b2', 'a-story', 'b-story', 'region', 'no-town']);
  assert.deepEqual(ids('source'), ['a-story', 'region', 'no-town', 'b2', 'b-story']);
  assert.deepEqual(ids('title'), ['a-story', 'b-story', 'region', 'no-town', 'b2']);
  assert.deepEqual(ARCHIVE_SORTS, ['newest', 'oldest', 'section', 'town', 'source', 'title']);
  assert.deepEqual(ids('bogus'), ids('newest'));
});
