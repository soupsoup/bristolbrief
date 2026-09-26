import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, findItems, resolvePin } from '../scripts/lib/pin.mjs';

const items = [
  { id: 'a', title: 'City council approves waterfront plan', link: 'https://www.example.com/news/waterfront/?utm_source=rss', summary: 'Long summary', source: 's1', sourceName: 'S1', towns: ['new-bedford'] },
  { id: 'b', title: 'Waterfront festival returns', link: 'https://example.com/festival', summary: '', source: 's2', sourceName: 'S2', towns: [] },
];
const now = new Date('2026-09-26T12:00:00Z');

test('URLs match across www, trailing slash and tracking params', () => {
  assert.equal(normalizeUrl('http://www.example.com/news/waterfront/?utm_source=rss#top'), 'example.com/news/waterfront');
  assert.deepEqual(findItems(items, 'https://example.com/news/waterfront').map((i) => i.id), ['a']);
});

test('headline search is case-insensitive and can be ambiguous', () => {
  assert.deepEqual(findItems(items, 'COUNCIL APPROVES').map((i) => i.id), ['a']);
  assert.equal(findItems(items, 'waterfront').length, 2);
});

test('an active pin resolves to the wire item, with overrides', () => {
  const { item, reason } = resolvePin({ url: items[0].link, until: '2026-09-27T00:00:00Z', summary: 'Editor summary' }, items, now);
  assert.equal(reason, 'matched');
  assert.equal(item.id, 'a');
  assert.equal(item.summary, 'Editor summary');
  assert.equal(item.pinned, true);
});

test('expired, empty and unmatched pins resolve to nothing', () => {
  assert.equal(resolvePin(null, items, now).reason, 'none');
  assert.equal(resolvePin({ url: items[0].link, until: '2026-09-26T11:00:00Z' }, items, now).reason, 'expired');
  assert.equal(resolvePin({ url: 'https://other.com/x' }, items, now).reason, 'unmatched');
});

test('a pin with its own details works for stories outside the wire', () => {
  const { item, reason } = resolvePin(
    { url: 'https://other.com/x', title: 'Big story', sourceName: 'Other', towns: ['taunton'] },
    items,
    now,
  );
  assert.equal(reason, 'manual');
  assert.equal(item.title, 'Big story');
  assert.deepEqual(item.towns, ['taunton']);
  assert.equal(item.link, 'https://other.com/x');
});
