import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  norm,
  rowKey,
  questionNumber,
  pickElections,
  normalizeElection,
  parseCsv,
  countyTotals,
  buildResults,
  inWindow,
  findElections,
  checkResults,
} from '../scripts/lib/election.mjs';

const doc = JSON.parse(await readFile(new URL('../src/data/election.json', import.meta.url), 'utf8'));
const cfg = await readFile(new URL('../src/site.config.ts', import.meta.url), 'utf8');
const townSlugs = [...cfg.matchAll(/\{ slug: '([a-z-]+)', name: '[^']+' \}/g)].map((m) => m[1]);

// Rows shaped like the state's search results (electionstats.state.ma.us).
const row = (id, office, district, cands, { name = '', date = '2026-11-03', primary = null, total } = {}) => ({
  Election: { id: String(id), name, date, party_primary: primary, n_total_votes: String(total ?? cands.reduce((s, c) => s + c[1], 0)), n_blank_votes: '10' },
  Office: { id: String(office[0]), display_name: office[1] },
  District: { display_name: district },
  Candidate: cands.map(([n, v, party, win]) => ({ display_name: n, CandidateToElection: { n_votes: String(v), party: party ?? null, is_winner: win ? '1' : '0', pct_candidate_votes: '0.5' } })),
});

const rows = [
  row(1, [6, 'U.S. Senator'], null, [['Edward J. Markey', 1200, 'Democratic'], ['John Deaton', 800, 'Republican']]),
  row(2, [8, 'State Representative'], '9th Bristol', [['Edward M. Pacheco', 2500], ['Chester M. Tam', 2000]]),
  row(3, [9, 'State Senator'], 'Third Bristol & Plymouth', [['Kelly A. Dooner', 900]]),
  row(4, [530, 'District Attorney'], 'Bristol', [['Christopher Matthew Markey', 5000], ['Seth Thomas Aitken', 4000]]),
  row(5, [999, 'Ballot Question'], null, [['Yes', 700], ['No', 300]], { name: 'Question 4' }),
  row(6, [321, 'County Commissioner'], 'Bristol', [['John Thomas Saunders', 3000]]),
  row(7, [5, 'U.S. Representative'], '4th Congressional', [['Jake Auchincloss', 100], ['Thomas Stalcup', 50]]),
  row(8, [6, 'U.S. Senator'], null, [['Edward J. Markey', 5]], { date: '2026-09-01', primary: 'Democratic' }),
  row(9, [8, 'State Representative'], '2nd Middlesex', [['Someone Else', 1]]),
];

test('names normalise so ordinals and ampersands compare equal', () => {
  assert.equal(norm('Third Bristol & Plymouth'), '3rd bristol and plymouth');
  assert.equal(norm('1st Bristol and Plymouth'), '1st bristol and plymouth');
  assert.equal(norm('  Bristol  '), 'bristol');
  assert.equal(norm(null), '');
});

test('a row key is the office id and the normalised district', () => {
  assert.equal(rowKey(rows[2]), '9|3rd bristol and plymouth');
  assert.equal(rowKey(rows[0]), '6|');
});

test('ballot questions are recognised by number', () => {
  assert.equal(questionNumber(rows[4]), 4);
  assert.equal(questionNumber(rows[0]), null);
  assert.equal(questionNumber(row(10, [1, 'Ballot Question 7'], null, [['Yes', 1]])), 7);
});

test('only general elections on the date are picked unless a primary is asked for', () => {
  assert.equal(pickElections(rows).length, 8);
  assert.equal(pickElections(rows, { date: '2026-09-01', primary: 'Democratic' }).length, 1);
  assert.equal(pickElections(rows, { date: '2026-09-01' }).length, 0);
});

test('candidates are sorted by votes with percentages from the totals', () => {
  const r = normalizeElection(rows[1]);
  assert.equal(r.candidates[0].name, 'Edward M. Pacheco');
  assert.equal(r.candidates[0].pct, 55.6);
  assert.equal(r.candidates[1].pct, 44.4);
  assert.equal(r.total_votes, 4500);
});

test('CSV parsing handles quoted thousands separators', () => {
  const t = parseCsv('City/Town,,,"A B","All Others"\r\n"Fall River",,,"4,358",30\n');
  assert.deepEqual(t[1], ['Fall River', '', '', '4,358', '30']);
});

const csv = [
  'City/Town,,,"Maura Healey","Mike Minogue","All Others",Blanks,"Total Votes Cast"',
  'Attleboro,,,"3,000","2,000",10,5,"5,015"',
  '"Fall River",,,"4,000","1,000",10,5,"5,015"',
  'N. Attleborough,,,500,600,0,0,"1,100"',
  'Boston,,,"90,000","1,000",0,0,"91,000"',
].join('\n');

test('county totals sum only Bristol County towns and know the state spells North Attleborough "N. Attleborough"', () => {
  const t = countyTotals(csv, townSlugs);
  assert.equal(t.towns, 3);
  assert.equal(t.candidates[0].name, 'Maura Healey');
  assert.equal(t.candidates[0].votes, 7500);
  assert.equal(t.candidates[1].votes, 3600);
  assert.equal(t.candidates[0].pct, 67.6);
});

test('county totals are null when no Bristol towns appear', () => {
  assert.equal(countyTotals('City/Town,,,"A"\nBoston,,,5', townSlugs), null);
});

test('results match races, questions and the county commissioner race', () => {
  const { races, unmatched } = buildResults({ doc, rows: pickElections(rows), csvById: { 1: csv }, townSlugs });
  assert.ok(races.senate);
  assert.equal(races.senate.bristol.candidates[0].votes, 7500);
  assert.equal(races.senate.candidates[0].party, 'Democratic');
  assert.ok(races['house-9']);
  assert.ok(races['senate-3rd-bristol-and-plymouth']);
  assert.ok(races['district-attorney']);
  assert.ok(races['county-commissioner']);
  assert.ok(races['us-house-4']);
  assert.ok(races.q4);
  assert.equal(races.q4.candidates[0].name, 'Yes');
  assert.equal(unmatched, 1); // the Middlesex district is not a Bristol County race
});

test('a missing party is filled from the ballot list', () => {
  const { races } = buildResults({ doc, rows: [rows[1]], townSlugs });
  assert.equal(races['house-9'].candidates[0].party, 'Democratic');
  assert.equal(races['house-9'].candidates[1].party, 'Republican');
});

test('the election window opens at 8 p.m. on Nov. 3 and closes Nov. 10', () => {
  assert.equal(inWindow(new Date('2026-11-04T00:59:00Z')), false); // 7:59 p.m. EST
  assert.equal(inWindow(new Date('2026-11-04T01:00:00Z')), true);
  assert.equal(inWindow(new Date('2026-11-09T12:00:00Z')), true);
  assert.equal(inWindow(new Date('2026-11-11T00:00:00Z')), false);
  assert.equal(inWindow(new Date('2026-10-01T00:00:00Z'), { force: true }), true);
});

const fakeGet = (body, { csv: c = csv } = {}) => async (url) => {
  if (url.includes('/elections/download/')) return { status: 200, body: c };
  if (url.includes('/elections/search/')) return { status: 200, body: JSON.stringify({ output: body }) };
  return { status: 404, body: '' };
};

test('discovery de-duplicates elections found by several searches', async () => {
  const found = await findElections(fakeGet(rows));
  assert.equal(found.length, 8);
});

test('discovery survives a search that fails', async () => {
  let n = 0;
  const get = async (url) => {
    n++;
    if (n === 1) throw new Error('boom');
    return { status: 200, body: JSON.stringify({ output: rows }) };
  };
  assert.equal((await findElections(get)).length, 8);
});

test('a check outside the window changes nothing', async () => {
  const out = await checkResults({ getText: fakeGet(rows), doc, townSlugs, previous: null, now: new Date('2026-11-02T12:00:00Z') });
  assert.equal(out, null);
});

test('a check before the state publishes anything changes nothing', async () => {
  const out = await checkResults({ getText: fakeGet([]), doc, townSlugs, previous: null, now: new Date('2026-11-04T02:00:00Z') });
  assert.equal(out, null);
});

test('a check after the polls close returns live results and keeps earlier races', async () => {
  const previous = { races: { 'house-1': { election_id: '0', total_votes: 1, candidates: [] } } };
  const out = await checkResults({ getText: fakeGet(rows), doc, townSlugs, previous, now: new Date('2026-11-04T02:05:00Z') });
  assert.equal(out.status, 'live');
  assert.equal(out.updated, '2026-11-04T02:05:00.000Z');
  assert.ok(out.races['house-1']);
  assert.ok(out.races.senate.bristol);
});

// The static ballot data the page is built from.
test('every race has a unique key, candidates and a match key', () => {
  const keys = new Set();
  for (const r of doc.races) {
    assert.ok(!keys.has(r.key), `duplicate ${r.key}`);
    keys.add(r.key);
    assert.ok(r.candidates.length > 0, r.key);
    assert.ok(r.keys.length > 0, r.key);
  }
});

test('all nine statewide questions are present with yes and no text', () => {
  assert.deepEqual(doc.questions.map((q) => q.n), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  for (const q of doc.questions) {
    assert.ok(q.title && q.summary && q.yes && q.no, `question ${q.n}`);
  }
});

test('the Bristol County seats on the ballot are all listed', () => {
  const have = new Set(doc.races.map((r) => r.key));
  for (let i = 1; i <= 14; i++) assert.ok(have.has(`house-${i}`), `house-${i}`);
  for (const k of ['district-attorney', 'register-of-probate', 'county-treasurer', 'county-commissioner', 'senate', 'governor']) assert.ok(have.has(k), k);
});

test('every race box has an office description and at least one nonpartisan or official link', () => {
  for (const r of doc.races) {
    assert.ok(r.about?.role, `${r.key} role`);
    assert.ok(r.about.links.length > 0, `${r.key} links`);
    for (const l of r.about.links) assert.match(l.url, /^https:\/\//, `${r.key} ${l.label}`);
  }
});

test('every ballot question links to the official arguments', () => {
  for (const q of doc.questions) assert.ok(q.links.some((l) => l.url.includes('information-for-voters')), `question ${q.n}`);
});

import { trackChanges } from '../scripts/lib/election.mjs';

const cands = (a, b) => ({ candidates: [{ name: 'A', votes: a, pct: Math.round((a / (a + b)) * 1000) / 10 }, { name: 'B', votes: b, pct: Math.round((b / (a + b)) * 1000) / 10 }] });

test('race tracking records the leader and margin on the first check', () => {
  const t = trackChanges({}, { r: cands(60, 40) }, 'T1').r;
  assert.equal(t.leader, 'A');
  assert.equal(t.margin, 20);
  assert.equal(t.prev_margin, null);
  assert.equal(t.lead_changed_at, null);
});

test('race tracking keeps the last margin and marks a lead change', () => {
  const first = trackChanges({}, { r: cands(60, 40) }, 'T1');
  const second = trackChanges(first, { r: cands(52, 48) }, 'T2').r;
  assert.equal(second.prev_margin, 20);
  assert.equal(second.margin, 4);
  assert.equal(second.lead_changed_at, null);
  const third = trackChanges({ r: second }, { r: { candidates: [{ name: 'B', votes: 55, pct: 52.4 }, { name: 'A', votes: 50, pct: 47.6 }] } }, 'T3').r;
  assert.equal(third.leader, 'B');
  assert.equal(third.lead_changed_at, 'T3');
  const fourth = trackChanges({ r: third }, { r: cands(30, 70) }, 'T4').r;
  assert.equal(fourth.lead_changed_at, 'T3'); // carried forward until the lead changes again
});

test('a tie has no leader', () => {
  assert.equal(trackChanges({}, { r: cands(50, 50) }, 'T').r.leader, null);
});

test('the tracker config lists the three Bristol County federal races', () => {
  assert.deepEqual(doc.tracker.races.map((r) => r.id), ['ma-sen', 'ma-04', 'ma-09']);
  assert.match(doc.tracker.url, /^https:\/\//);
});
