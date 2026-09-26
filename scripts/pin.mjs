#!/usr/bin/env node
// Feature a story at the top of the home page (the first featured story is
// the lead). Command-line shortcut for the admin's "Feature" button.
//
//   npm run pin -- "waterfront plan"             feature the headline containing this text
//   npm run pin -- https://example.com/story     or match by URL
//   npm run pin -- "waterfront plan" --hours 48  stop featuring after 48 hours (default 24)
//   npm run pin -- --clear                       remove every featured story
//   npm run pin                                  list featured stories
import { readFile, writeFile } from 'node:fs/promises';
import { applyEditorial, applyOp, featuredItems, normalizeEditorial } from './lib/editorial.mjs';

const edFile = new URL('../src/data/editorial.json', import.meta.url);
const wire = JSON.parse(await readFile(new URL('../src/data/wire.json', import.meta.url), 'utf8')).items ?? [];
let ed;
try {
  ed = normalizeEditorial(JSON.parse(await readFile(edFile, 'utf8')));
} catch {
  ed = normalizeEditorial({});
}
const et = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' });
const save = (doc) => writeFile(edFile, JSON.stringify(doc, null, 2) + '\n');

const args = process.argv.slice(2);
const hi = args.indexOf('--hours');
const hours = hi === -1 ? 24 : Number(args.splice(hi, 2)[1]);

if (args.includes('--clear')) {
  await save({ ...ed, featured: [] });
  console.log('Cleared. Top stories are picked automatically again.');
  process.exit(0);
}

const items = applyEditorial(wire, ed);
const query = args.join(' ').trim();

if (!query) {
  const list = featuredItems(items);
  if (!list.length) console.log('Nothing featured. Top stories are picked automatically.');
  list.forEach((i, n) => {
    const until = ed.featured.find((f) => f.id === i.id)?.until;
    console.log(`${n + 1}. ${i.title} (${i.sourceName})${until ? ` until ${et(until)}` : ''}`);
  });
  process.exit(0);
}

if (!Number.isFinite(hours) || hours <= 0) {
  console.error('--hours must be a positive number.');
  process.exit(1);
}

const q = query.toLowerCase();
const matches = /^https?:\/\//i.test(query)
  ? items.filter((i) => i.link.replace(/\/+$/, '') === query.replace(/\/+$/, ''))
  : items.filter((i) => i.title.toLowerCase().includes(q));
if (matches.length !== 1) {
  console.error(matches.length ? `"${query}" matches ${matches.length} headlines:\n` : `No headline matches "${query}". To feature a story that isn't in the feeds, add it in the admin.`);
  for (const m of matches.slice(0, 10)) console.error(`  ${m.title}\n    ${m.sourceName} · ${m.link}\n`);
  process.exit(1);
}

const until = new Date(Date.now() + hours * 3600e3).toISOString();
await save(applyOp(ed, { type: 'feature', id: matches[0].id, until }));
console.log(`Featured as the lead: ${matches[0].title}\n  ${matches[0].sourceName} · until ${et(until)}`);
