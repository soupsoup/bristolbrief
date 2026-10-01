import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickStories, pickMeetings, trimSummary, cleanLink, buildNewsletter } from '../scripts/lib/newsletter.mjs';

const now = new Date('2026-10-01T10:00:00Z');
const hoursAgo = (h) => new Date(now.valueOf() - h * 3600e3).toISOString();
const item = (o) => ({
  id: o.id ?? o.title,
  title: o.title,
  summary: o.summary ?? 'A long enough summary of the story that passes the minimum length check for the newsletter.',
  date: hoursAgo(o.age ?? 3),
  source: o.source ?? 'a',
  sourceName: o.sourceName ?? 'Outlet A',
  category: o.category ?? 'news',
  section: o.section ?? 'news',
  towns: o.towns ?? ['taunton'],
  link: o.link ?? 'https://example.com/' + (o.id ?? o.title).replace(/\W+/g, '-'),
  ...(o.team && { team: o.team }),
});

test('trimSummary strips bylines, press-release labels and soft hyphens, and cuts at a sentence', () => {
  assert.equal(trimSummary('By Beth David, Editor Town votes on budget.'), 'Town votes on budget.');
  assert.equal(trimSummary('Acushnet Fire Department Press Release Crews responded to a crash.'), 'Crews responded to a crash.');
  assert.equal(trimSummary('Depart­ments met.'), 'Departments met.');
  const two = 'The council voted to approve the harbor plan after a long meeting on Tuesday night. ' + 'More detail follows '.repeat(10);
  assert.equal(trimSummary(two, 100), 'The council voted to approve the harbor plan after a long meeting on Tuesday night.');
  assert.ok(trimSummary('word '.repeat(80), 60).endsWith('…'));
});

test('cleanLink removes utm parameters only', () => {
  assert.equal(cleanLink('https://x.com/a?id=2&utm_source=rss&utm_medium=rss'), 'https://x.com/a?id=2');
});

test('pickStories skips old items, listings, sports, team stories and thin summaries', () => {
  const picked = pickStories(
    [
      item({ title: 'Fresh council vote on schools', source: 's1' }),
      item({ title: 'Yesterday old story about bridge', age: 40, source: 's2' }),
      item({ title: 'House for sale on Main', section: 'listings', source: 's3' }),
      item({ title: 'Bruins win overtime', team: 'bruins', source: 's4' }),
      item({ title: 'Soccer team wins', section: 'sports', source: 's5' }),
      item({ title: 'Short summary story', summary: 'Too short.', source: 's6' }),
    ],
    { now },
  );
  assert.deepEqual(picked.map((s) => s.title), ['Fresh council vote on schools']);
});

test('pickStories leads with the story several outlets ran, and keeps one copy of it', () => {
  const picked = pickStories(
    [
      item({ title: 'Mayor announces harbor dredging project', source: 'a', section: 'government', age: 2 }),
      item({ title: 'Attorney general releases diocese abuse investigation', source: 'b', age: 6 }),
      item({ title: 'Diocese abuse investigation released by attorney general', source: 'c', age: 7 }),
      item({ title: 'Attorney general diocese investigation finds abuse decades', source: 'd', age: 8 }),
    ],
    { now },
  );
  assert.match(picked[0].title, /diocese/i);
  assert.equal(picked.filter((s) => /diocese/i.test(s.title)).length, 1);
});

test('pickStories allows at most two stories per source', () => {
  const picked = pickStories(
    ['Alpha harbor plan', 'Bravo school budget', 'Charlie library grant'].map((title) => item({ title, source: 'same' })),
    { now },
  );
  assert.equal(picked.length, 2);
});

test('pickMeetings keeps only meetings on the same Eastern date, in time order', () => {
  const m = (id, start) => ({ id, title: id, town: 'taunton', start, link: 'https://x.test/' + id, hasAgenda: false });
  const got = pickMeetings([m('late', '2026-10-01T22:30:00Z'), m('early', '2026-10-01T13:00:00Z'), m('tomorrow', '2026-10-02T13:00:00Z'), m('yesterday', '2026-09-30T13:00:00Z')], { now });
  assert.deepEqual(got.map((x) => x.title), ['early', 'late']);
  assert.equal(got[0].time, '9:00 AM');
});

test('buildNewsletter escapes HTML and includes alerts and a text copy', () => {
  const out = buildNewsletter({
    items: [item({ title: 'Cats <b>& dogs</b> adopt day', source: 'a' })],
    alerts: [{ event: 'Flood Warning', areas: 'Bristol, MA', link: 'https://alerts.test/1' }],
    now,
  });
  assert.ok(out.html.includes('Cats &lt;b&gt;&amp; dogs&lt;/b&gt; adopt day'));
  assert.ok(!out.html.includes('<b>& dogs'));
  assert.ok(out.html.includes('Flood Warning'));
  assert.ok(out.text.startsWith('THE BRISTOL BRIEF'));
  assert.equal(out.counts.alerts, 1);
});

test('buildNewsletter still produces a valid email on a quiet day', () => {
  const out = buildNewsletter({ items: [], now });
  assert.equal(out.counts.stories, 0);
  assert.match(out.subject, /^The Bristol Brief:/);
  assert.ok(out.html.includes('bristolbrief.com'));
});
