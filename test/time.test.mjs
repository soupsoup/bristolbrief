import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPublishedAt,
  newYorkDateTimeLocalToIso,
  timeAgo,
  toNewYorkDateTimeLocal,
} from '../src/lib/time.mjs';

test('Eastern input converts to UTC across daylight and standard time', () => {
  assert.equal(newYorkDateTimeLocalToIso('2026-09-27T10:29'), '2026-09-27T14:29:00.000Z');
  assert.equal(newYorkDateTimeLocalToIso('2026-12-27T10:29'), '2026-12-27T15:29:00.000Z');
  assert.equal(toNewYorkDateTimeLocal('2026-09-27T14:29:10.795Z'), '2026-09-27T10:29');
});

test('ambiguous fall-back times choose the earlier Eastern instant', () => {
  assert.equal(newYorkDateTimeLocalToIso('2026-11-01T01:30'), '2026-11-01T05:30:00.000Z');
});

test('nonexistent spring-forward times are rejected', () => {
  assert.throws(() => newYorkDateTimeLocalToIso('2026-03-08T02:30'), /daylight-saving/);
});

test('future timestamps are not labeled as recently published', () => {
  const now = new Date('2026-09-27T15:07:50.000Z');
  const future = '2026-09-27T22:26:00.000Z';
  assert.equal(isPublishedAt(future, now), false);
  assert.equal(timeAgo(future, now), 'Scheduled');
  assert.equal(timeAgo('2026-09-27T14:29:10.795Z', now), '39m ago');
});
