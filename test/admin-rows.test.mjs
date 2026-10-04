import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitStories, queryStories, pageNumbers, parsePage, STORY_SORTS, RECENT_DAYS, PAGE_SIZE } from '../scripts/lib/admin-rows.mjs';

const NOW = new Date('2026-10-04T12:00:00Z');
const ago = (days) => new Date(NOW.valueOf() - days * 864e5).toISOString();
const story = (id, daysAgo = 1, extra = {}) => ({ id, title: id, source: 's', sourceName: 'Source', category: 'news', sections: ['news'], towns: [], date: ago(daysAgo), ...extra });
const team = (id, daysAgo = 1) => story(id, daysAgo, { team: 'red-sox' });
const ids = (r) => r.rows.map((x) => x.id);

test('splitStories separates recent news, archived news and pro-team stories, newest first', () => {
  const { recent, archive, team: t } = splitStories(
    [story('old', 20), story('new', 1), team('t1', 2), story('edge', 6.9), story('just-over', 7.1), team('t2', 30)],
    { now: NOW },
  );
  assert.deepEqual(recent.map((r) => r.id), ['new', 'edge']);
  assert.deepEqual(archive.map((r) => r.id), ['just-over', 'old']);
  assert.deepEqual(t.map((r) => r.id), ['t1', 't2']);
  assert.equal(RECENT_DAYS, 7);
});

test('each scope lists only its own stories and reports the size of all three', () => {
  const items = [story('a', 1), team('b'), story('c', 3), story('old', 12), team('d', 40)];
  const recent = queryStories(items, { now: NOW });
  assert.deepEqual(ids(recent), ['a', 'c']);
  assert.deepEqual(recent.counts, { recent: 2, archive: 1, team: 2 });
  assert.deepEqual(ids(queryStories(items, { now: NOW, scope: 'archive' })), ['old']);
  assert.deepEqual(ids(queryStories(items, { now: NOW, scope: 'teams' })), ['b', 'd']);
});

test('a list is paged at 50 stories and the page number is clamped', () => {
  const items = Array.from({ length: PAGE_SIZE * 2 + 20 }, (_, n) => story(`s${n}`, n / 1000));
  const p1 = queryStories(items, { now: NOW });
  const p3 = queryStories(items, { now: NOW, page: 3 });
  assert.equal(PAGE_SIZE, 50);
  assert.equal(p1.rows.length, 50);
  assert.equal(p1.pages, 3);
  assert.equal(p1.total, 120);
  assert.equal(p3.rows.length, 20);
  assert.equal(p3.rows[0].id, 's100');
  assert.equal(queryStories(items, { now: NOW, page: 99 }).page, 3);
  assert.equal(queryStories(items, { now: NOW, page: -4 }).page, 1);
  assert.equal(queryStories([], { now: NOW }).pages, 1);
});

test('filters narrow the whole list before it is paged', () => {
  const items = [
    story('Harbor dredging plan', 1, { sourceName: 'Standard-Times', source: 'st', category: 'news', sections: ['government'], towns: ['fairhaven'] }),
    story('School budget vote', 2, { sourceName: 'Sun Chronicle', source: 'sc', category: 'news', sections: ['schools'], towns: ['attleboro'], edited: true }),
    story('Regional jobs report', 3, { source: 'sc', category: 'government', sections: ['business'], countywide: true, image: '/x.jpg' }),
    story('Statewide recall notice', 4, { source: 'st', sections: ['news'], hidden: true }),
    story('Featured thing', 5, { featuredRank: 0 }),
  ];
  const f = (o) => ids(queryStories(items, { now: NOW, ...o }));
  assert.deepEqual(f({ q: 'HARBOR' }), ['Harbor dredging plan']);
  assert.deepEqual(f({ q: 'sun chronicle' }), ['School budget vote']);
  assert.deepEqual(f({ source: 'sc' }), ['School budget vote', 'Regional jobs report']);
  assert.deepEqual(f({ category: 'government' }), ['Regional jobs report']);
  assert.deepEqual(f({ section: 'schools' }), ['School budget vote']);
  assert.deepEqual(f({ town: 'fairhaven' }), ['Harbor dredging plan']);
  assert.deepEqual(f({ town: 'countywide' }), ['Regional jobs report']);
  assert.deepEqual(f({ town: 'none' }), ['Statewide recall notice', 'Featured thing']);
  assert.deepEqual(f({ status: 'edited' }), ['School budget vote']);
  assert.deepEqual(f({ status: 'hidden' }), ['Statewide recall notice']);
  assert.deepEqual(f({ status: 'photo' }), ['Regional jobs report']);
  assert.deepEqual(f({ status: 'featured' }), ['Featured thing']);
  assert.deepEqual(f({ q: 'report', source: 'sc', section: 'business' }), ['Regional jobs report']);
  assert.equal(queryStories(items, { now: NOW, q: 'nothing like this' }).total, 0);
});

test('"published within" keeps recent hours and leaves out undated stories', () => {
  const items = [story('hour', 0.02), story('five-hours', 5 / 24), story('day', 1), story('undated', 0.01, { undated: true })];
  assert.deepEqual(ids(queryStories(items, { now: NOW, within: 1 })), ['hour']);
  assert.deepEqual(ids(queryStories(items, { now: NOW, within: 6 })), ['hour', 'five-hours']);
  assert.deepEqual(ids(queryStories(items, { now: NOW })).includes('undated'), true);
});

test('the sorts match the menu: section order, town, source and headline, ties newest first', () => {
  const items = [
    story('b-story', 3, { title: 'Bravo', sourceName: 'Zeta News', sections: ['schools'], towns: ['taunton'] }),
    story('a-story', 4, { title: 'alpha', sourceName: 'Alpha News', sections: ['news'], towns: ['attleboro'] }),
    story('region', 5, { title: 'Charlie', sourceName: 'Alpha News', sections: ['news'], countywide: true }),
    story('no-town', 6, { title: 'Delta', sourceName: 'Beta News', sections: ['government'] }),
    story('b2', 2.5, { title: 'Echo', sourceName: 'Zeta News', sections: ['news'], towns: ['attleboro'] }),
  ];
  const opts = { now: NOW, sectionOrder: ['news', 'government', 'schools'], townLabel: (s) => ({ attleboro: 'Attleboro', taunton: 'Taunton' })[s] ?? s };
  const by = (sort) => ids(queryStories(items, { ...opts, sort }));
  assert.deepEqual(by('newest'), ['b2', 'b-story', 'a-story', 'region', 'no-town']);
  assert.deepEqual(by('oldest'), ['no-town', 'region', 'a-story', 'b-story', 'b2']);
  assert.deepEqual(by('section'), ['b2', 'a-story', 'region', 'no-town', 'b-story']);
  assert.deepEqual(by('town'), ['b2', 'a-story', 'b-story', 'region', 'no-town']);
  assert.deepEqual(by('source'), ['a-story', 'region', 'no-town', 'b2', 'b-story']);
  assert.deepEqual(by('title'), ['a-story', 'b-story', 'region', 'no-town', 'b2']);
  assert.deepEqual(by('bogus'), by('newest'));
  assert.deepEqual(STORY_SORTS, ['newest', 'oldest', 'section', 'town', 'source', 'title']);
});

test('a sort orders the whole list, not just the first page', () => {
  const items = Array.from({ length: PAGE_SIZE + 10 }, (_, n) => story(`s${n}`, 1 + n / 1000, { title: `Title ${String(PAGE_SIZE + 10 - n).padStart(3, '0')}` }));
  const page1 = queryStories(items, { now: NOW, sort: 'title' });
  assert.equal(page1.rows[0].title, 'Title 001');
  assert.equal(page1.rows.at(-1).title, 'Title 050');
  assert.equal(queryStories(items, { now: NOW, sort: 'title', page: 2 }).rows[0].title, 'Title 051');
});

test('parsePage accepts a positive whole number and falls back to 1', () => {
  assert.equal(parsePage('4'), 4);
  assert.equal(parsePage('2.9'), 2);
  for (const bad of ['', null, undefined, '0', '-3', 'x']) assert.equal(parsePage(bad), 1);
});

test('pageNumbers shows the ends and a few pages around the current one', () => {
  assert.deepEqual(pageNumbers(1, 1), [1]);
  assert.deepEqual(pageNumbers(1, 4), [1, 2, 3, 4]);
  assert.deepEqual(pageNumbers(1, 10), [1, 2, 3, null, 10]);
  assert.deepEqual(pageNumbers(5, 10), [1, null, 3, 4, 5, 6, 7, null, 10]);
  assert.deepEqual(pageNumbers(10, 10), [1, null, 8, 9, 10]);
});
