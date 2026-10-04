import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, normalize, matchTowns, isDartmouthCollege, mergeItems, excerpt, guessSection, normalizeNws, isPropertyListing, normalizeTeam, dropUnknownSources } from '../scripts/lib/parse.mjs';

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

test('Bristol County, R.I. and South Coast stories about places outside the county do not qualify', () => {
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

test('future feed dates are excluded instead of published as now', () => {
  const now = new Date('2026-09-26T00:00:00Z');
  const xml = `<rss><channel><item><title>Seekonk event</title><link>https://e/1</link><pubDate>Tue, 01 Dec 2026 00:00:00 GMT</pubDate></item></channel></rss>`;
  assert.deepEqual(normalize(parseFeed(xml), { id: 'z', name: 'Z', category: 'news' }, now), []);
});

test('timezone-less feed dates are interpreted as Eastern and stored as UTC', () => {
  const xml = `<rss><channel>
    <item><title>New Bedford morning report</title><link>https://e/1</link><pubDate>2026-09-27T10:09:00</pubDate></item>
    <item><title>Fall River winter update</title><link>https://e/2</link><pubDate>2026-12-27T10:09:00</pubDate></item>
  </channel></rss>`;
  const [summer, winter] = parseFeed(xml);
  assert.equal(summer.date.toISOString(), '2026-09-27T14:09:00.000Z');
  assert.equal(winter.date.toISOString(), '2026-12-27T15:09:00.000Z');
});

test('merge dedupes, keeps first-seen date and prunes old items', () => {
  const now = new Date('2026-09-26T12:00:00Z');
  const old = { id: 'a', title: 'Same story', date: '2026-09-25T00:00:00.000Z' };
  const stale = { id: 'b', title: 'Ancient', date: '2026-03-01T00:00:00.000Z' };
  const future = { id: 'future', title: 'Scheduled story', date: '2026-09-27T00:00:00.000Z' };
  const merged = mergeItems([old, stale, future], [
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

test('storm outage stories are news, not business', () => {
  assert.equal(guessSection("Hundreds lose power in Attleboro area from nor'easter"), 'news');
});

test('injury stories are public safety even when they mention a store', () => {
  assert.equal(guessSection('Man hospitalized after ladder fall at grocery store in Fall River'), 'public-safety');
});

test('items without a feed date are flagged undated', () => {
  const xml = `<rss><channel><item><title>Westport transfer station closed</title><link>https://w/1</link></item></channel></rss>`;
  const [item] = normalize(parseFeed(xml), { id: 'w', name: 'W', category: 'government', defaultTowns: ['westport'] });
  assert.equal(item.undated, true);
});

test('direct feeds go back 45 days and stay six months; Google News stays 14 days', () => {
  const now = new Date('2026-09-27T00:00:00Z');
  const agg = new Set(['gn']);
  const merged = mergeItems(
    [
      { id: 'kept', title: 'Archived feed story', source: 'feed', date: '2026-05-01T00:00:00.000Z' },
      { id: 'expired', title: 'Too old', source: 'feed', date: '2026-03-01T00:00:00.000Z' },
      { id: 'gn-old', title: 'Old Google News', source: 'gn', date: '2026-09-01T00:00:00.000Z' },
    ],
    [
      { id: 'new40', title: 'Found 40 days back', source: 'feed', date: '2026-08-18T00:00:00.000Z' },
      { id: 'new60', title: 'Found 60 days back', source: 'feed', date: '2026-07-29T00:00:00.000Z' },
      { id: 'gn10', title: 'Google News 10 days', source: 'gn', date: '2026-09-17T00:00:00.000Z' },
      { id: 'gn20', title: 'Google News 20 days', source: 'gn', date: '2026-09-07T00:00:00.000Z' },
    ],
    { now, aggregatedSources: agg },
  );
  assert.deepEqual(merged.map((i) => i.id), ['gn10', 'new40', 'kept']);
});

test('regional stories with no county town are tagged Region', () => {
  const xml = `<rss><channel>
    <item><title>Nor'easter slams the South Coast overnight</title><link>https://r/1</link><description>Thousands lost power.</description></item>
    <item><title>Flood watch for southeastern Massachusetts</title><link>https://r/2</link></item>
    <item><title>SouthCoast storm damage: New Bedford hit hardest</title><link>https://r/3</link></item>
    <item><title>Wareham road closed as South Coast floods</title><link>https://r/4</link></item>
    <item><title>Nor'easter impacting southern New England</title><link>https://r/5</link></item>
  </channel></rss>`;
  const items = normalize(parseFeed(xml), { id: 'r', name: 'R', category: 'news' });
  assert.deepEqual(items.map((i) => i.link), ['https://r/1', 'https://r/2', 'https://r/3']);
  assert.equal(items[0].countywide, true);
  assert.deepEqual(items[0].towns, []);
  assert.deepEqual(items[2].towns, ['new-bedford']);
  assert.equal(items[2].countywide, undefined);
});

test('single-town outlets file unnamed local stories under their town', () => {
  const xml = `<rss><channel>
    <item><title>Southworth Library book sale this weekend</title><link>https://d/1</link></item>
    <item><title>Fall River council approves budget</title><link>https://d/2</link></item>
    <item><title>Tiverton opens new town beach lot</title><link>https://d/3</link></item>
    <item><title>Red Sox clinch Wild Card spot in Boston</title><link>https://d/4</link></item>
    <item><title>NEED JUNK GONE? 774-361-5520 — Mack</title><link>https://d/5</link></item>
    <item><title>Vol 12 No 20</title><link>https://d/6</link></item>
    <item><title>Obituaries</title><link>https://d/7</link></item>
  </channel></rss>`;
  const items = normalize(parseFeed(xml), { id: 'dw', name: 'Dartmouth Week', category: 'news', homeTown: 'dartmouth' });
  assert.deepEqual(items.map((i) => [i.link, i.towns.join()]), [['https://d/1', 'dartmouth'], ['https://d/2', 'fall-river']]);
  // Without homeTown the unnamed story is dropped as before.
  assert.equal(normalize(parseFeed(xml), { id: 'x', name: 'X', category: 'news' }).length, 1);
});

test('property listings are recognized and filed under Listings', () => {
  for (const t of [
    '49 Edgewater Way, Wareham - GEM ON THE RIVER',
    'Open House 2 Rosemary Lane, Unit A, Wareham',
    'House for rent in Mattapoisett',
    '3 bed, 2 bath colonial on Smith Neck Road',
    '45 Elm St., Dartmouth — 3 bed cape',
  ]) assert.equal(isPropertyListing(t), true, t);
  for (const t of [
    '123 Main St. fire displaces family',
    '12 Hathaway Road home sells for $1.2M',
    'Council on Aging to hold open house Tuesday',
    'Fire Department Open House',
    'Town closes deal on Bliss Corner',
  ]) assert.equal(isPropertyListing(t), false, t);
  const xml = `<rss><channel><item><title>45 Elm St., Dartmouth - 3 bed cape</title><link>https://l/1</link></item></channel></rss>`;
  const [item] = normalize(parseFeed(xml), { id: 'dw', name: 'Dartmouth Week', category: 'news', homeTown: 'dartmouth' });
  assert.equal(item.section, 'listings');
  assert.deepEqual(item.towns, ['dartmouth']);
});

test('high school sports: school names map to towns and games go to Sports', () => {
  assert.deepEqual(matchTowns('Walpole ekes out win over Feehan'), ['attleboro']);
  assert.deepEqual(matchTowns('Bishop Stang edges Bishop Connolly'), ['dartmouth', 'fall-river']);
  assert.equal(guessSection('Fairhaven boys soccer captures rare win over Old Rochester'), 'sports');
  assert.equal(guessSection('UMass Dartmouth football player charged in murder'), 'public-safety');
});

test('pro team coverage keeps the publisher and a short window', () => {
  const now = new Date('2026-09-28T12:00:00Z');
  const xml = `<rss><channel>
    <item><title>Mike Vrabel voices concern after Patriots loss - Pats Pulpit</title><link>https://g/1</link><pubDate>Mon, 28 Sep 2026 10:00:00 GMT</pubDate></item>
  </channel></rss>`;
  const [item] = normalizeTeam(parseFeed(xml), { id: 'patriots', name: 'Patriots coverage', team: 'patriots' }, now);
  assert.equal(item.title, 'Mike Vrabel voices concern after Patriots loss');
  assert.equal(item.sourceName, 'Pats Pulpit');
  assert.equal(item.team, 'patriots');
  assert.equal(item.section, 'sports');
  const merged = mergeItems([{ ...item, id: 'old', title: 'Old team story', date: '2026-09-20T00:00:00.000Z' }], [item], { now });
  assert.deepEqual(merged.map((i) => i.id), [item.id]);
});

test('Dartmouth College stories are not filed under Dartmouth, MA', () => {
  assert.equal(isDartmouthCollege('A campus A.I. controversy is raising questions far beyond Dartmouth A Dartmouth investigation into alleged A.I. use by a top academic leader'), true);
  assert.equal(isDartmouthCollege('UMass Dartmouth wins the conference title'), false);
  const feed = { id: 'ml', name: 'MassLive', category: 'news', via: 'rss', section: 'news' };
  const entry = { title: 'A campus A.I. controversy is raising questions far beyond Dartmouth', summary: 'A Dartmouth investigation into alleged A.I. use by a top academic leader is fueling debate nationwide.', link: 'https://example.com/a', date: new Date('2026-09-30T08:30:00Z'), categories: [] };
  assert.equal(normalize([entry], feed, new Date('2026-09-30T13:00:00Z')).length, 0);
  const old = { id: 'x', title: entry.title, summary: entry.summary, date: '2026-09-30T08:30:00.000Z', source: 'ml', towns: ['dartmouth'], category: 'news', section: 'news' };
  assert.equal(mergeItems([old], [], { now: new Date('2026-09-30T13:00:00Z') }).length, 0);
});

test('dropUnknownSources removes stories from sources that are no longer configured', () => {
  const items = [
    { id: '1', source: 'sun-chronicle' },
    { id: '2', source: 'portuguese-times' },
    { id: '3', source: 'disabled-but-listed' },
  ];
  const known = new Set(['sun-chronicle', 'disabled-but-listed']);
  assert.deepEqual(dropUnknownSources(items, known).map((i) => i.id), ['1', '3']);
  assert.deepEqual(dropUnknownSources([], known), []);
});
