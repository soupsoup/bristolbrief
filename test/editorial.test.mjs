import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp, applyEditorial, featuredItems, slugify, EditorialError } from '../scripts/lib/editorial.mjs';

const now = new Date('2026-09-26T12:00:00Z');
const wire = [
  { id: 'a', title: 'Fall River council votes', summary: 'Feed summary', link: 'https://x/a', date: '2026-09-26T10:00:00Z', source: 's1', sourceName: 'S1', category: 'news', section: 'government', towns: ['fall-river'] },
  { id: 'b', title: 'Taunton road closed', summary: '', link: 'https://x/b', date: '2026-09-26T09:00:00Z', source: 's2', sourceName: 'S2', category: 'news', section: 'news', towns: ['taunton'] },
];
const known = new Set(wire.map((i) => i.id));
const op = (doc, o) => applyOp(doc, o, { now, knownIds: known });

test('edits override feed fields; null restores the feed value', () => {
  let ed = op({}, { type: 'update', id: 'a', fields: { title: 'Council approves budget', sections: ['government', 'news'], towns: ['fall-river', 'somerset'] } });
  let [a] = applyEditorial(wire, ed, { now });
  assert.equal(a.title, 'Council approves budget');
  assert.equal(a.originalTitle, 'Fall River council votes');
  assert.deepEqual(a.sections, ['government', 'news']);
  assert.deepEqual(a.towns, ['fall-river', 'somerset']);
  assert.equal(a.edited, true);

  ed = op(ed, { type: 'update', id: 'a', fields: { title: null, sections: null, towns: null } });
  assert.deepEqual(ed.overrides, {});
  [a] = applyEditorial(wire, ed, { now });
  assert.equal(a.title, 'Fall River council votes');
  assert.deepEqual(a.sections, ['government']);
  assert.equal(a.edited, undefined);
});

test('hidden items drop off the site but stay in the admin view', () => {
  const ed = op({}, { type: 'update', id: 'b', fields: { hidden: true } });
  assert.deepEqual(applyEditorial(wire, ed, { now }).map((i) => i.id), ['a']);
  const all = applyEditorial(wire, ed, { now, includeHidden: true });
  assert.equal(all.find((i) => i.id === 'b').hidden, true);
});

test('featured slots: lead, second, third and rail', () => {
  let ed = op({}, { type: 'feature', id: 'b', slot: 'second' });
  ed = op(ed, { type: 'feature', id: 'a', slot: 'rail' });
  let items = applyEditorial(wire, ed, { now });
  assert.equal(items.find((i) => i.id === 'b').featuredSlot, 'second');
  assert.equal(items.find((i) => i.id === 'b').featuredRank, 1);
  assert.equal(items.find((i) => i.id === 'a').featuredSlot, 'rail');
  // Putting another story in a taken slot bumps the old one back to automatic.
  ed = op(ed, { type: 'feature', id: 'a', slot: 'second' });
  assert.deepEqual(ed.featured.map((f) => `${f.id}:${f.slot}`), ['a:second']);
  // Moving up from second fills the empty lead slot.
  ed = op(ed, { type: 'move', id: 'a', direction: 'up' });
  assert.deepEqual(ed.featured.map((f) => `${f.id}:${f.slot}`), ['a:lead']);
  ed = op(ed, { type: 'feature', id: 'b', slot: 'lead' });
  assert.deepEqual(ed.featured.map((f) => `${f.id}:${f.slot}`), ['b:lead']);
  ed = op(ed, { type: 'unfeature', id: 'b' });
  assert.deepEqual(ed.featured, []);
  assert.throws(() => op({}, { type: 'feature', id: 'a', slot: 'sidebar' }), EditorialError);
});

test('picks give way to fresh news after an hour unless kept longer', () => {
  const ed = op({}, { type: 'feature', id: 'a', slot: 'lead' });
  const at = (iso) => featuredItems(applyEditorial(wire, ed, { now: new Date(iso) })).length;
  assert.equal(at('2026-09-26T12:59:00Z'), 1);
  assert.equal(at('2026-09-26T13:01:00Z'), 0);

  const kept = op({}, { type: 'feature', id: 'a', slot: 'lead', until: '2026-09-26T18:00:00Z' });
  assert.equal(featuredItems(applyEditorial(wire, kept, { now: new Date('2026-09-26T17:00:00Z') })).length, 1);
  assert.throws(() => op({}, { type: 'feature', id: 'a', until: '2026-09-26T11:00:00Z' }), EditorialError);

  // Expired entries are cleaned up on the next write.
  const later = applyOp(ed, { type: 'unfeature', id: 'zzz' }, { now: new Date('2026-09-26T14:00:00Z') });
  assert.deepEqual(later.featured, []);
});

test('older files without slots keep their order', () => {
  const legacy = { featured: [{ id: 'b', until: '2026-09-27T00:00:00Z' }, { id: 'a' }] };
  const items = featuredItems(applyEditorial(wire, legacy, { now }));
  assert.deepEqual(items.map((i) => `${i.id}:${i.featuredSlot}`), ['b:lead', 'a:second']);
});

test('manual stories: add, sections, own page or external link, edit, delete', () => {
  let ed = op({}, { type: 'addManual', story: { title: 'Storm cleanup: what to know', summary: 'Crews are out.', body: 'Para one.\n\nPara two.', sections: ['news', 'public-safety'], towns: ['attleboro'] }, feature: true });
  const [m] = ed.manual;
  assert.equal(m.id, 'm-storm-cleanup-what-to-know');
  assert.deepEqual([ed.featured[0].id, ed.featured[0].slot], [m.id, 'lead']);
  let item = applyEditorial(wire, ed, { now }).find((i) => i.id === m.id);
  assert.equal(item.link, '/stories/storm-cleanup-what-to-know/');
  assert.deepEqual(item.sections, ['news', 'public-safety']);
  assert.equal(item.manual, true);
  assert.equal(item.external, false);

  // Same headline gets a unique slug.
  ed = op(ed, { type: 'addManual', story: { title: 'Storm cleanup: what to know', link: 'https://example.com/s', sections: ['news'] } });
  assert.equal(ed.manual[0].slug, 'storm-cleanup-what-to-know-2');
  item = applyEditorial(wire, ed, { now }).find((i) => i.id === ed.manual[0].id);
  assert.equal(item.link, 'https://example.com/s');
  assert.equal(item.external, true);

  // Editing keeps the date even if the form sends none.
  const before = ed.manual[1].date;
  ed = op(ed, { type: 'update', id: m.id, fields: { title: 'Storm cleanup update', date: null } });
  assert.equal(ed.manual[1].title, 'Storm cleanup update');
  assert.equal(ed.manual[1].date, before);

  ed = op(ed, { type: 'deleteManual', id: m.id });
  assert.equal(ed.manual.length, 1);
  assert.equal(ed.featured.length, 0);
});

test('validation rejects bad input', () => {
  const bad = [
    { type: 'update', id: 'a', fields: { title: '' } },
    { type: 'update', id: 'a', fields: { sections: ['sports'] } },
    { type: 'update', id: 'a', fields: { towns: ['boston'] } },
    { type: 'update', id: 'a', fields: { image: 'https://evil.example/x.jpg' } },
    { type: 'update', id: 'a', fields: { image: '/uploads/../../etc/passwd' } },
    { type: 'update', id: 'a', fields: { link: 'https://x' } }, // feed items can't change links
    { type: 'update', id: 'a', fields: { nope: 1 } },
    { type: 'update', id: 'gone', fields: { title: 'x' } },
    { type: 'addManual', story: { title: 'No sections', sections: [] } },
    { type: 'addManual', story: { title: 'Bad link', sections: ['news'], link: 'javascript:alert(1)' } },
    { type: 'explode' },
  ];
  for (const o of bad) assert.throws(() => op({}, o), EditorialError, JSON.stringify(o));
});

test('photos attach to feed items', () => {
  const ed = op({}, { type: 'update', id: 'b', fields: { image: '/uploads/2026/09/road-abc.jpg', imageAlt: 'Closed road' } });
  const b = applyEditorial(wire, ed, { now }).find((i) => i.id === 'b');
  assert.equal(b.image, '/uploads/2026/09/road-abc.jpg');
  assert.equal(b.imageAlt, 'Closed road');
});

test('slugify', () => {
  assert.equal(slugify("Nor'easter hits Fall River — what's next?"), 'nor-easter-hits-fall-river-what-s-next');
  assert.equal(slugify('Café São João'), 'cafe-sao-joao');
});

test('social posts: add, dedupe, edit, reorder, remove', () => {
  let ed = op({}, { type: 'addSocial', post: { url: 'https://twitter.com/NWSBoston/status/123456789?s=20', text: 'High wind warning', authorName: 'NWS Boston', handle: 'NWSBoston', postedLabel: 'September 26, 2026', towns: ['fall-river'] } });
  assert.deepEqual(ed.social[0], {
    id: 's-x-123456789', platform: 'x', url: 'https://x.com/NWSBoston/status/123456789', text: 'High wind warning',
    authorName: 'NWS Boston', towns: ['fall-river'], handle: 'NWSBoston', postedLabel: 'September 26, 2026', addedAt: now.toISOString(),
  });
  assert.throws(() => op(ed, { type: 'addSocial', post: { url: 'https://x.com/NWSBoston/status/123456789', text: 'again' } }), /already on the site/);
  ed = op(ed, { type: 'addSocial', post: { url: 'https://bsky.app/profile/example.com/post/abc123', text: 'Hello', uri: 'at://did:plc:xyz/app.bsky.feed.post/abc123', cid: 'bafyreicnt42y6vo6pfpv' } });
  assert.equal(ed.social[0].platform, 'bluesky');
  assert.equal(ed.social[0].uri, 'at://did:plc:xyz/app.bsky.feed.post/abc123');
  ed = op(ed, { type: 'moveSocial', id: 's-x-123456789', direction: 'up' });
  assert.equal(ed.social[0].id, 's-x-123456789');
  ed = op(ed, { type: 'updateSocial', id: 's-x-123456789', fields: { text: 'Edited', towns: [] } });
  assert.equal(ed.social[0].text, 'Edited');
  assert.equal(ed.social[0].towns, undefined);
  ed = op(ed, { type: 'removeSocial', id: 's-x-123456789' });
  assert.equal(ed.social.length, 1);
});

test('social posts: validation', () => {
  assert.throws(() => op({}, { type: 'addSocial', post: { url: 'javascript:alert(1)', text: 'x' } }), EditorialError);
  assert.throws(() => op({}, { type: 'addSocial', post: { url: 'https://x.com/a/status/1' } }), /Couldn't load that post/);
  assert.throws(() => op({}, { type: 'addSocial', post: { url: 'https://facebook.com/p/1' } }), /Add the post text/);
  // Untrusted embed fields are dropped rather than stored.
  const ed = op({}, { type: 'addSocial', post: { url: 'https://bsky.app/profile/a.b/post/xyz', text: 'Hi', uri: 'javascript:alert(1)', cid: '"><script>', handle: '<b>' } });
  assert.equal(ed.social[0].uri, undefined);
  assert.equal(ed.social[0].cid, undefined);
  assert.equal(ed.social[0].handle, 'a.b');
});

test('social review queue: dismiss, mute, approve with image', () => {
  let ed = op({}, { type: 'dismissSocial', id: 's-bsky-3mw123' });
  assert.deepEqual(ed.dismissedSocial, ['s-bsky-3mw123']);
  ed = op(ed, { type: 'muteSocial', handle: 'NWS.bsky.social' });
  assert.deepEqual(ed.mutedSocial, ['nws.bsky.social']);
  ed = op(ed, { type: 'unmuteSocial', handle: 'nws.bsky.social' });
  assert.deepEqual(ed.mutedSocial, []);
  // Approving a dismissed post takes it off the dismissed list.
  ed = op(ed, {
    type: 'addSocial',
    post: {
      url: 'https://bsky.app/profile/a.bsky.social/post/3mw123', text: 'Flooding', uri: 'at://did:plc:a/app.bsky.feed.post/3mw123',
      cid: 'bafyabcdefghij', image: 'https://cdn.bsky.app/img/x.jpg', imageAlt: 'street', postedAt: '2026-09-26T21:00:00Z',
    },
  });
  assert.equal(ed.social[0].image, 'https://cdn.bsky.app/img/x.jpg');
  assert.equal(ed.social[0].postedAt, '2026-09-26T21:00:00.000Z');
  assert.deepEqual(ed.dismissedSocial, []);
  assert.throws(() => op({}, { type: 'dismissSocial', id: '../../etc' }), EditorialError);
  assert.throws(() => op({}, { type: 'addSocial', post: { url: 'https://x.com/a/status/1', text: 'x', image: 'javascript:alert(1)' } }), EditorialError);
  // Mastodon links need no oEmbed; text comes from the scan or the editor.
  ed = op({}, { type: 'addSocial', post: { url: 'https://mastodon.social/@nb/111222333', text: 'Rain', handle: 'nb@mastodon.social' } });
  assert.equal(ed.social[0].platform, 'mastodon');
  assert.equal(ed.social[0].handle, 'nb@mastodon.social');
});
