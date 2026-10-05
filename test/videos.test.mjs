import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYouTubeFeed, descriptionBody, videoPlaces, normalizeVideos, mergeVideos, recentVideos, featuredVideo, isWeather, feedUrl, VIDEO_KEEP_DAYS } from '../scripts/lib/videos.mjs';

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <title>NBC 10 WJAR</title><published>2007-03-05T20:00:00+00:00</published>
 <entry>
  <id>yt:video:abc123</id><yt:videoId>abc123</yt:videoId><yt:channelId>UCx</yt:channelId>
  <title>Fall River bat maker supplies &amp; ships training tools</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=abc123"/>
  <published>2026-10-03T02:24:00+00:00</published><updated>2026-10-03T03:00:00+00:00</updated>
  <media:group><media:title>x</media:title>
   <media:thumbnail url="https://i1.ytimg.com/vi/abc123/hqdefault.jpg" width="480" height="360"/>
   <media:description>A bat maker in Fall River ships to the majors.

NBC 10 WJAR is Southern New England's leading news station, including Attleboro, Taunton and Cape Cod.</media:description>
  </media:group>
 </entry>
 <entry>
  <id>yt:video:short9</id><yt:videoId>short9</yt:videoId>
  <title>Newport car show</title>
  <link rel="alternate" href="https://www.youtube.com/shorts/short9"/>
  <published>2026-10-05T17:24:00+00:00</published>
  <media:group><media:description>Former President at the show.</media:description></media:group>
 </entry>
</feed>`;
const now = new Date('2026-10-05T20:00:00Z');
const hoursAgo = (h) => new Date(now.valueOf() - h * 3600e3).toISOString();
const vid = (id, h, extra = {}) => ({ id, title: id, link: `https://youtu.be/${id}`, published: hoursAgo(h), channel: 'wpri', channelName: 'WPRI 12', thumbnail: '', towns: [], ...extra });

test('parseYouTubeFeed reads entries, decodes titles, finds shorts links and builds a 16:9 thumbnail', () => {
  const v = parseYouTubeFeed(FEED);
  assert.equal(v.length, 2);
  assert.equal(v[0].id, 'abc123');
  assert.equal(v[0].title, 'Fall River bat maker supplies & ships training tools');
  assert.equal(v[0].link, 'https://www.youtube.com/watch?v=abc123');
  assert.equal(v[0].published, '2026-10-03T02:24:00.000Z');
  assert.equal(v[0].thumbnail, 'https://i.ytimg.com/vi/abc123/mqdefault.jpg');
  assert.match(v[1].link, /\/shorts\/short9$/);
  assert.deepEqual(parseYouTubeFeed('<feed></feed>'), []);
});

test('feedUrl points at the channel feed', () => {
  assert.equal(feedUrl('UCabc'), 'https://www.youtube.com/feeds/videos.xml?channel_id=UCabc');
});

test('descriptionBody stops at the station blurb or a divider', () => {
  const [a] = parseYouTubeFeed(FEED);
  assert.equal(descriptionBody(a.description), 'A bat maker in Fall River ships to the majors.');
  assert.equal(descriptionBody('About the video.\n\n-----\nBoilerplate in Taunton'), 'About the video.');
  assert.equal(descriptionBody('Just one paragraph about Swansea.'), 'Just one paragraph about Swansea.');
  assert.equal(descriptionBody(''), '');
});

test('videoPlaces uses the title, then the description body, and ignores the station blurb', () => {
  const blurb = "\n\nNBC 10 WJAR is Southern New England's leading news station, including Attleboro, Fall River and Taunton.";
  assert.deepEqual(videoPlaces({ title: 'Crash in Swansea', description: 'Details.' }).towns, ['swansea']);
  assert.deepEqual(videoPlaces({ title: 'Car show', description: `Held in Newport.${blurb}` }), { towns: [], countywide: false });
  assert.deepEqual(videoPlaces({ title: 'Car show', description: `A fire in Taunton.${blurb}` }).towns, ['taunton']);
  assert.equal(videoPlaces({ title: 'Weather forecast', description: 'Service for Rhode Island and Southeastern Mass.' }).countywide, true);
  assert.deepEqual(videoPlaces({ title: 'Dartmouth College hockey', description: 'Hanover, N.H.' }).towns, []);
});

test('a region channel keeps every video; a Boston channel keeps only Bristol County ones', () => {
  const entries = [
    { id: 'a', title: 'Fall River fire', link: 'l', published: hoursAgo(2), description: '', thumbnail: '' },
    { id: 'b', title: 'Providence mayor speaks', link: 'l', published: hoursAgo(3), description: '', thumbnail: '' },
    { id: 'c', title: 'Future video in Taunton', link: 'l', published: hoursAgo(-5), description: '', thumbnail: '' },
  ];
  const region = normalizeVideos(entries, { id: 'wpri', name: 'WPRI 12', scope: 'region' }, now);
  assert.deepEqual(region.map((v) => [v.id, Boolean(v.local)]), [['a', true], ['b', false]]);
  const boston = normalizeVideos(entries, { id: 'wcvb', name: 'WCVB', scope: 'boston' }, now);
  assert.deepEqual(boston.map((v) => v.id), ['a']);
  assert.equal(boston[0].channelName, 'WCVB');
});

test('weather and short videos are flagged', () => {
  const [w, s] = normalizeVideos(
    [
      { id: 'w', title: 'WPRI 12 Weather Forecast for 10/5', link: 'https://www.youtube.com/watch?v=w', published: hoursAgo(1), description: '', thumbnail: '' },
      { id: 's', title: 'Quick clip', link: 'https://www.youtube.com/shorts/s', published: hoursAgo(1), description: '', thumbnail: '' },
    ],
    { id: 'wpri', name: 'WPRI 12', scope: 'region' },
    now,
  );
  assert.equal(w.weather, true);
  assert.equal(s.short, true);
  assert.equal(isWeather('Seasonable, breezy and dry today'), false);
});

test('mergeVideos dedupes, drops old, unknown-channel and future videos, and keeps one forecast per channel per day', () => {
  const existing = [vid('old', VIDEO_KEEP_DAYS * 24 + 5), vid('gone', 2, { channel: 'removed' }), vid('keep', 30), vid('wx-old', 5, { weather: true })];
  const incoming = [vid('keep', 30), vid('new', 1), vid('wx-new', 2, { weather: true }), vid('future', -4), vid('wx-other', 2, { weather: true, channel: 'nbc10-wjar' })];
  const got = mergeVideos(existing, incoming, { channelIds: new Set(['wpri', 'nbc10-wjar']), now });
  assert.deepEqual(got.map((v) => v.id), ['new', 'wx-new', 'wx-other', 'keep'].sort((a, b) => got.findIndex((v) => v.id === a) - got.findIndex((v) => v.id === b)));
  assert.deepEqual(got.map((v) => v.id), ['new', 'wx-new', 'wx-other', 'keep']);
  assert.equal(new Set(got.map((v) => v.id)).size, got.length);
});

test('mergeVideos keeps newest first and updates a video seen again', () => {
  const got = mergeVideos([vid('x', 10, { title: 'Old title' })], [vid('x', 10, { title: 'New title' }), vid('y', 4)], { now });
  assert.deepEqual(got.map((v) => v.id), ['y', 'x']);
  assert.equal(got[1].title, 'New title');
});

test('recentVideos returns the last 24 hours only', () => {
  const got = recentVideos([vid('a', 1), vid('b', 23.9), vid('c', 24.1), vid('d', -1)], { now });
  assert.deepEqual(got.map((v) => v.id), ['a', 'b']);
  assert.deepEqual(recentVideos([vid('a', 30)], { now, hours: 48 }).map((v) => v.id), ['a']);
});

test('featuredVideo is the newest Bristol County video from the last 48 hours, never a forecast', () => {
  const videos = [
    vid('wx', 1, { local: true, weather: true, countywide: true }),
    vid('rhode-island', 2),
    vid('newest-local', 5, { local: true, towns: ['swansea'] }),
    vid('older-local', 20, { local: true, towns: ['fall-river'] }),
    vid('stale-local', 60, { local: true }),
  ];
  assert.equal(featuredVideo(videos, { now }).id, 'newest-local');
  assert.equal(featuredVideo(videos.slice(0, 2), { now }), undefined);
  assert.equal(featuredVideo([vid('stale-local', 60, { local: true })], { now }), undefined);
  assert.equal(featuredVideo([vid('stale-local', 60, { local: true })], { now, hours: 72 }).id, 'stale-local');
  assert.equal(featuredVideo([], { now }), undefined);
});
