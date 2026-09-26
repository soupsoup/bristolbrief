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

test('featured order: top, bottom, move, unfeature, expiry', () => {
  let ed = op({}, { type: 'feature', id: 'a' });
  ed = op(ed, { type: 'feature', id: 'b' }); // top by default
  assert.deepEqual(ed.featured.map((f) => f.id), ['b', 'a']);
  ed = op(ed, { type: 'move', id: 'a', direction: 'up' });
  assert.deepEqual(ed.featured.map((f) => f.id), ['a', 'b']);
  ed = op(ed, { type: 'feature', id: 'a', position: 'bottom' });
  assert.deepEqual(ed.featured.map((f) => f.id), ['b', 'a']);
  assert.deepEqual(featuredItems(applyEditorial(wire, ed, { now })).map((i) => i.id), ['b', 'a']);
  ed = op(ed, { type: 'unfeature', id: 'b' });
  assert.deepEqual(ed.featured.map((f) => f.id), ['a']);

  const timed = op({}, { type: 'feature', id: 'a', until: '2026-09-26T13:00:00Z' });
  assert.equal(featuredItems(applyEditorial(wire, timed, { now })).length, 1);
  assert.equal(featuredItems(applyEditorial(wire, timed, { now: new Date('2026-09-26T14:00:00Z') })).length, 0);
  // Expired entries are cleaned up on the next write.
  const later = applyOp(timed, { type: 'unfeature', id: 'zzz' }, { now: new Date('2026-09-26T14:00:00Z') });
  assert.deepEqual(later.featured, []);
  assert.throws(() => op({}, { type: 'feature', id: 'a', until: '2026-09-26T11:00:00Z' }), EditorialError);
});

test('manual stories: add, sections, own page or external link, edit, delete', () => {
  let ed = op({}, { type: 'addManual', story: { title: 'Storm cleanup: what to know', summary: 'Crews are out.', body: 'Para one.\n\nPara two.', sections: ['news', 'public-safety'], towns: ['attleboro'] }, feature: true });
  const [m] = ed.manual;
  assert.equal(m.id, 'm-storm-cleanup-what-to-know');
  assert.equal(ed.featured[0].id, m.id);
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
