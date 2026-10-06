import test from 'node:test';
import assert from 'node:assert/strict';
import { sig, sameStory } from '../scripts/lib/dedupe.mjs';

test('the Raynham crash headlines from two outlets and the video are one story', () => {
  const a = sig('18-year-old pedestrian killed in Raynham crash while crossing street');
  const b = sig('18-year-old pedestrian crossing street in Raynham, Massachusetts, hit and killed by driver');
  assert.ok(sameStory(a, b));
});

test('unrelated headlines are different stories', () => {
  assert.ok(!sameStory(sig('Old Colony Habitat for Humanity breaks ground on new Norton home'), sig('Attleboro Seeks Input On Future Of Balfour Park')));
});
