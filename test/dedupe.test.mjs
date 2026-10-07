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

test('tracker catches the same incident reported with different headlines', async () => {
  const { storyTracker } = await import('../scripts/lib/dedupe.mjs');
  const a = { title: 'Authorities ID Brockton teen fatally struck by car while crossing Route 44 in Raynham', summary: 'Prosecutors have identified a Brockton man who was struck and killed by a car while crossing the street in Raynham Tuesday morning.', towns: ['raynham'] };
  const b = { title: 'Officials ID 18-year-old hit, killed by SUV in Raynham', summary: 'Police said the man was crossing Route 44 around 6:15 a.m. Tuesday when he was struck by a passing SUV.', towns: ['raynham'] };
  const c = { title: 'Shots Fired in New Bedford', summary: 'New Bedford Police are investigating a Tuesday night shots fired incident near Penniman and Mt. Pleasant Streets after ShotSpotter detected gunfire.', towns: ['new-bedford'] };
  const t = storyTracker([a]);
  assert.ok(t.has(b));
  assert.ok(!t.has(c));
});
