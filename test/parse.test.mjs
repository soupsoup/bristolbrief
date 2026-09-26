import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, normalize, matchTowns, mergeItems, excerpt, guessSection, normalizeNws } from '../scripts/lib/parse.mjs';

const RSS = `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
  <title>Test</title>
  <item>
    <title>Fall River council approves road bond</title>
    <link>https://example.com/a</link>
    <pubDate>Thu, 24 Sep 2026 14:00:00 GMT</pubDate>
    <description><![CDATA[<p>The council voted 8-1. Continue reading&amp;hellip;</p>]]></description>
    <category>Politics</category>
  </item>
  <item>
    <title>Red Sox win in extra innings</title>
    <link>https://example.com/b</link>
    <pubDate>Thu, 24 Sep 2026 13:00:00 GMT</pubDate>
    <description>Boston beat New York.</description>
  </item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Select Board</title>
    <link rel="alternate" href="https://town.example/AgendaCenter/1"/>
    <id>tag:1</id>
    <updated>2026-09-25T10:00:00Z</updated>
    <summary>Select Board agenda posted</summary>
  </entry>
</feed>`;

test('parses RSS 2.0 and Atom', () => {
  const rss = parseFeed(RSS);
  assert.equal(rss.length, 2);
  assert.equal(rss[0].link, 'https://example.com/a');
  assert.equal(rss[0].categories[0], 'Politics');
  const atom = parseFeed(ATOM);
  assert.equal(atom[0].link, 'https://town.example/AgendaCenter/1');
  assert.equal(atom[0].date.toISOString(), '2026-09-25T10:00:00.000Z');
});

test('rejects non-feed documents', () => {
  assert.throws(() => parseFeed('<html><body>nope</body></html>'));
});

test('matches towns, villages and variant spellings', () => {
  assert.deepEqual(matchTowns('Crash in North Attleboro'), ['north-attleborough']);
  assert.deepEqual(matchTowns('Assonet and South Dartmouth'), ['dartmouth', 'freetown']);
  assert.deepEqual(matchTowns('Attleboro and North Attleborough'), ['north-attleborough', 'attleboro']);
  assert.deepEqual(matchTowns('Durfee wins'), ['fall-river']);
});

test('ignores same-named places elsewhere', () => {
  assert.deepEqual(matchTowns('Dartmouth College hockey'), []);
  assert.deepEqual(matchTowns('A new cafe in Westport, CT'), []);
  assert.deepEqual(matchTowns('Mansfield, Ohio factory'), []);
});

test('news items must name a Bristol County town', () => {
  const items = normalize(parseFeed(RSS), { id: 'x', name: 'X', category: 'news' });
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Fall River council approves road bond');
  assert.deepEqual(items[0].towns, ['fall-river']);
  assert.equal(items[0].section, 'government');
  assert.equal(items[0].summary, 'The council voted 8-1.');
});

test('single-town sources fall back to their default town', () => {
  const items = normalize(parseFeed(ATOM), { id: 'y', name: 'Y', category: 'meetings', defaultTowns: ['norton'], section: 'government' });
  assert.deepEqual(items[0].towns, ['norton']);
  // Summary that only repeats the title is trimmed to the remainder.
  assert.equal(items[0].summary, 'agenda posted');
});

test('South Coast and Bristol County, R.I. do not qualify', () => {
  const xml = `<rss><channel>
    <item><title>Officer-involved shooting in Lakeville</title><link>https://e/1</link><description>Police across the South Coast responded.</description></item>
    <item><title>Bristol County, R.I. beaches reopen</title><link>https://e/2</link></item>
    <item><title>Rhode Island's Bristol County gets grant</title><link>https://e/5</link></item>
    <item><title>Bristol County DA: crash in Easton kills driver</title><link>https://e/3</link></item>
    <item><title>Bristol County sheriff signs election pledge</title><link>https://e/4</link></item>
  </channel></rss>`;
  const items = normalize(parseFeed(xml), { id: 'r', name: 'R', category: 'news' });
  assert.deepEqual(items.map((i) => i.link), ['https://e/3', 'https://e/4']);
  // A named town wins; the county tag is only for items with no town.
  assert.deepEqual(items[0].towns, ['easton']);
  assert.equal(items[0].countywide, undefined);
  assert.deepEqual(items[1].towns, []);
  assert.equal(items[1].countywide, true);
});

test('Google News titles lose the publisher suffix and summary', () => {
  const xml = `<rss><channel><item><title>Taunton gets new police chief - Taunton Daily Gazette</title><link>https://news.google.com/x</link><description>&lt;a href="x"&gt;junk&lt;/a&gt;</description></item></channel></rss>`;
  const [item] = normalize(parseFeed(xml), { id: 'g', name: 'G', category: 'news', via: 'google-news' });
  assert.equal(item.title, 'Taunton gets new police chief');
  assert.equal(item.summary, '');
});

test('future dates are clamped to now', () => {
  const now = new Date('2026-09-26T00:00:00Z');
  const xml = `<rss><channel><item><title>Seekonk event</title><link>https://e/1</link><pubDate>Tue, 01 Dec 2026 00:00:00 GMT</pubDate></item></channel></rss>`;
  const [item] = normalize(parseFeed(xml), { id: 'z', name: 'Z', category: 'news' }, now);
  assert.equal(item.date, now.toISOString());
});

test('merge dedupes, keeps first-seen date and prunes old items', () => {
  const now = new Date('2026-09-26T12:00:00Z');
  const old = { id: 'a', title: 'Same story', date: '2026-09-25T00:00:00.000Z' };
  const stale = { id: 'b', title: 'Ancient', date: '2026-06-01T00:00:00.000Z' };
  const merged = mergeItems([old, stale], [
    { id: 'a', title: 'Same story', date: '2026-09-26T00:00:00.000Z' },
    { id: 'c', title: 'Same  Story!', date: '2026-09-26T01:00:00.000Z' },
    { id: 'd', title: 'New story', date: '2026-09-26T02:00:00.000Z' },
  ], { now });
  assert.deepEqual(merged.map((i) => i.id), ['d', 'a']);
  assert.equal(merged[1].date, '2026-09-25T00:00:00.000Z');
});

test('excerpt trims long text on a word boundary', () => {
  const out = excerpt('word '.repeat(100), 40);
  assert.ok(out.length <= 41);
  assert.ok(out.endsWith('…'));
});

test('section guesses prefer specific beats', () => {
  assert.equal(guessSection('Police arrest man after crash'), 'public-safety');
  assert.equal(guessSection('School committee approves budget'), 'schools');
  assert.equal(guessSection('Nice weather ahead', 'news'), 'news');
});

test('normalizes NWS alerts', () => {
  const [a] = normalizeNws({ features: [{ properties: { id: 'urn:1', event: 'Flood Watch', severity: 'Moderate', areaDesc: 'Southern Bristol', description: 'Heavy rain.' } }] });
  assert.equal(a.event, 'Flood Watch');
  assert.equal(a.description, 'Heavy rain.');
});

test('institutional feeds keep their own town', () => {
  const xml = `<rss><channel><item><title>Somerset Berkley Regional School Committee</title><link>https://s/1</link></item></channel></rss>`;
  const [agenda] = normalize(parseFeed(xml), { id: 'a', name: 'A', category: 'meetings', defaultTowns: ['somerset'] });
  assert.deepEqual(agenda.towns, ['somerset']);
  const [story] = normalize(parseFeed(xml), { id: 'n', name: 'N', category: 'news' });
  assert.deepEqual(story.towns, ['somerset', 'berkley']);
  // News outlets don't get a default town: an item with no county town is dropped.
  const offTopic = `<rss><channel><item><title>Sunken boat found at Bourne marina</title><link>https://s/2</link></item></channel></rss>`;
  assert.equal(normalize(parseFeed(offTopic), { id: 'n', name: 'N', category: 'news' }).length, 0);
});
