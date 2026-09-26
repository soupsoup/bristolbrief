import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeMbtaAlerts,
  mbtaStopParents,
  mbtaEffectLabel,
  normalizeTidePredictions,
  normalizeWaterLevel,
  normalizeCivicClerk,
  easternToIso,
} from '../scripts/lib/data.mjs';

const now = new Date('2026-09-26T22:00:00Z');
const alert = (id, attrs) => ({ id, attributes: { severity: 4, active_period: [{ start: '2026-09-26T17:00:00-04:00', end: null }], ...attrs } });

test('maps child platforms to parent stations', () => {
  const map = mbtaStopParents({
    data: [{ id: 'place-FRS-0109', relationships: { child_stops: { data: [{ id: 'FRS-0109-01' }] } } }],
    included: [{ id: 'FRS-0109-02', relationships: { parent_station: { data: { id: 'place-FRS-0109' } } } }],
  });
  assert.deepEqual(map, { 'FRS-0109-01': 'place-FRS-0109', 'FRS-0109-02': 'place-FRS-0109' });
});

test('keeps line-wide alerts and alerts at Bristol County stations only', () => {
  const json = {
    data: [
      alert('line', { header: 'Train 7029 delayed', effect: 'DELAY', informed_entity: [{ route: 'CR-NewBedford' }] }),
      alert('local', { header: 'Fall River elevator out', effect: 'STATION_ISSUE', informed_entity: [{ route: 'CR-NewBedford', stop: 'FRS-0109-01' }] }),
      alert('boston', { header: 'South Station restrooms', effect: 'STATION_ISSUE', informed_entity: [{ route: 'CR-NewBedford', stop: 'place-sstat' }] }),
      alert('other', { header: 'Fitchburg delay', effect: 'DELAY', informed_entity: [{ route: 'CR-Fitchburg' }] }),
      alert('expired', { header: 'Old', effect: 'DELAY', active_period: [{ start: '2026-09-25T10:00:00Z', end: '2026-09-25T11:00:00Z' }], informed_entity: [{ route: 'CR-Providence' }] }),
    ],
  };
  const out = normalizeMbtaAlerts(json, { 'FRS-0109-01': 'place-FRS-0109' }, now);
  assert.deepEqual(out.map((a) => a.id).sort(), ['line', 'local']);
  const local = out.find((a) => a.id === 'local');
  assert.deepEqual(local.stations, ['Fall River Depot']);
  assert.deepEqual(local.towns, ['fall-river']);
});

test('labels MBTA effects', () => {
  assert.equal(mbtaEffectLabel('SHUTTLE'), 'Shuttle buses');
  assert.equal(mbtaEffectLabel('BIKE_ISSUE'), 'Bike issue');
});

test('converts Eastern wall-clock time across DST', () => {
  assert.equal(easternToIso('2026-09-29 17:30'), '2026-09-29T21:30:00.000Z');
  assert.equal(easternToIso('2026-12-01 17:30'), '2026-12-01T22:30:00.000Z');
});

test('normalizes NOAA tide predictions and water level', () => {
  const [p] = normalizeTidePredictions({ predictions: [{ t: '2026-09-26 20:38', v: '4.941', type: 'H' }] });
  assert.deepEqual(p, { time: '2026-09-27T00:38:00.000Z', local: '2026-09-26 20:38', height: 4.9, type: 'high' });
  assert.equal(normalizeWaterLevel({ data: [{ t: '2026-09-26 18:24', v: '3.648' }] }).height, 3.6);
  assert.equal(normalizeWaterLevel({ error: { message: 'No data' } }), null);
});

test('normalizes CivicClerk events: local times, placeholder titles, duplicates', () => {
  const ev = (id, name, loc) => ({
    id,
    eventName: name,
    startDateTime: '2026-09-22T17:30:00Z',
    categoryName: 'City Council Committees',
    isPublished: 'Published',
    hasAgenda: true,
    eventLocation: loc ? { address1: 'Taunton City Hall', address2: 'Council Chambers ' } : null,
  });
  const out = normalizeCivicClerk(
    { value: [ev(3041, 'September 22, 2026 II', false), ev(1057, 'City Council Committees Meeting', true), { ...ev(9, 'Gone'), isDeleted: true }] },
    { town: 'taunton', portal: 'https://tauntonma.portal.civicclerk.com' },
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'City Council Committees Meeting');
  assert.equal(out[0].start, '2026-09-22T21:30:00.000Z');
  assert.equal(out[0].location, 'Taunton City Hall, Council Chambers');
  assert.equal(out[0].link, 'https://tauntonma.portal.civicclerk.com/event/1057/overview');

  const [placeholder] = normalizeCivicClerk({ value: [ev(1, 'One Time Event', false)] }, { town: 'taunton', portal: 'x' });
  assert.equal(placeholder.title, 'City Council Committees meeting');
});
