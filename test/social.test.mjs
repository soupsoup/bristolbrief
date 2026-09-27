import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSocialUrl, parseOembed } from '../scripts/lib/social.mjs';

test('recognizes X, Twitter and Bluesky links', () => {
  assert.deepEqual(parseSocialUrl('https://mobile.twitter.com/CityofNB/status/1839?s=20&t=abc'), { platform: 'x', url: 'https://x.com/CityofNB/status/1839', key: 'x-1839', handle: 'CityofNB' });
  assert.equal(parseSocialUrl('https://x.com/a/statuses/99').url, 'https://x.com/a/status/99');
  assert.equal(parseSocialUrl('https://bsky.app/profile/wpri.com/post/3kabc').platform, 'bluesky');
  assert.equal(parseSocialUrl('https://www.instagram.com/p/Cxyz/').platform, 'link');
  assert.throws(() => parseSocialUrl('not a url'));
  assert.throws(() => parseSocialUrl('ftp://example.com/x'));
});

test('parses X oEmbed', () => {
  const r = parseOembed('x', {
    author_name: 'jack',
    author_url: 'https://x.com/jack',
    html: '<blockquote class="twitter-tweet" data-dnt="true"><p lang="en" dir="ltr">just setting up my <a href="#">twttr</a> &amp; more</p>&mdash; jack (@jack) <a href="https://x.com/jack/status/20?ref_src=twsrc%5Etfw">March 21, 2006</a></blockquote>',
  });
  assert.deepEqual(r, { text: 'just setting up my twttr & more', authorName: 'jack', handle: 'jack', postedLabel: 'March 21, 2006' });
});

test('parses Bluesky oEmbed', () => {
  const r = parseOembed('bluesky', {
    author_name: 'Bluesky (@bsky.app)',
    html: '<blockquote class="bluesky-embed" data-bluesky-uri="at://did:plc:z72/app.bsky.feed.post/3l6" data-bluesky-cid="bafyabc"><p lang="en">Hello<br>world</p></blockquote>',
  });
  assert.equal(r.text, 'Hello\nworld');
  assert.equal(r.authorName, 'Bluesky');
  assert.equal(r.handle, 'bsky.app');
  assert.equal(r.uri, 'at://did:plc:z72/app.bsky.feed.post/3l6');
  assert.equal(r.cid, 'bafyabc');
});

import { normalizeBlueskyPost, normalizeMastodonStatus, socialTowns, mastodonText } from '../scripts/lib/social.mjs';

test('recognizes Mastodon post links', () => {
  const p = parseSocialUrl('https://partyon.xyz/@nullagent/117316653610917666?ref=x');
  assert.equal(p.platform, 'mastodon');
  assert.equal(p.url, 'https://partyon.xyz/@nullagent/117316653610917666');
  assert.equal(p.handle, 'nullagent@partyon.xyz');
  assert.equal(p.key, 'mastodon-partyon-xyz-117316653610917666');
});

test('normalizes Bluesky search results', () => {
  const post = normalizeBlueskyPost({
    uri: 'at://did:plc:abc/app.bsky.feed.post/3mw123',
    cid: 'bafyabc',
    author: { handle: 'nws.bsky.social', displayName: 'NWS Boston' },
    record: { text: 'Fall River [Bristol Co, MA] reports flooding', createdAt: '2026-09-26T21:06:40Z' },
    embed: { images: [{ thumb: 'https://cdn.bsky.app/img/x.jpg', alt: 'Flooded street' }] },
  });
  assert.equal(post.url, 'https://bsky.app/profile/nws.bsky.social/post/3mw123');
  assert.equal(post.key, 'bsky-3mw123');
  assert.equal(post.image, 'https://cdn.bsky.app/img/x.jpg');
  assert.equal(post.isReply, false);
  assert.equal(normalizeBlueskyPost({ uri: 'at://x/app.bsky.feed.post/1', author: {}, record: {} }), null);
});

test('normalizes Mastodon statuses, including boosts', () => {
  const status = {
    url: 'https://mastodon.social/@nb/111222333',
    content: '<p>Rain in <a href="#">#NewBedford</a> &amp; more</p><p>Stay dry</p>',
    created_at: '2026-09-26T20:00:00Z',
    in_reply_to_id: null,
    account: { acct: 'nb', display_name: 'NB Resident', username: 'nb' },
    media_attachments: [{ type: 'image', preview_url: 'https://files.example/a.png', description: 'rain' }],
  };
  const post = normalizeMastodonStatus({ reblog: status });
  assert.equal(post.platform, 'mastodon');
  assert.equal(post.text, 'Rain in #NewBedford & more\n\nStay dry');
  assert.equal(post.handle, 'nb@mastodon.social');
  assert.equal(post.image, 'https://files.example/a.png');
  assert.equal(mastodonText('<p>a</p><p>b</p>'), 'a\n\nb');
});

test('scan keeps clear Bristol County posts and drops look-alikes', () => {
  assert.deepEqual(socialTowns('Flooding on Route 18 in New Bedford'), ['new-bedford']);
  assert.deepEqual(socialTowns('Somerset v Surrey at Taunton today'), []);
  assert.deepEqual(socialTowns('Acushnet (GOLF) stock could trade at a discount'), []);
  assert.deepEqual(socialTowns('Acushnet [Bristol Co, MA] reports flooding'), ['acushnet']);
  assert.deepEqual(socialTowns('Beautiful day in Westport, CT'), []);
  assert.deepEqual(socialTowns('Swansea MA town meeting tonight'), ['swansea']);
});
