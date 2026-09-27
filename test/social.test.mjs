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
