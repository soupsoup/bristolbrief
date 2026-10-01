#!/usr/bin/env node
// Build today's newsletter draft for beehiiv.
//
// Usage: node scripts/newsletter.mjs [--ref origin/main] [--out newsletter-draft] [--now ISO]
//   --ref  read src/data from this git ref instead of the working tree, so a
//          scheduled run sees the latest ingest without touching the checkout.
// Writes <out>/<YYYY-MM-DD>.html, .txt and .json (subject, preheader, counts).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { applyEditorial } from './lib/editorial.mjs';
import { buildNewsletter } from './lib/newsletter.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const ref = opt('--ref');
const outDir = opt('--out', 'newsletter-draft');
const now = opt('--now') ? new Date(opt('--now')) : new Date();

const read = async (name) =>
  JSON.parse(ref ? execFileSync('git', ['show', `${ref}:src/data/${name}`], { maxBuffer: 256 * 1024 * 1024 }).toString() : await readFile(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));

const [wire, editorial, calendar, alerts] = await Promise.all(['wire.json', 'editorial.json', 'calendar.json', 'alerts.json'].map(read));

// Town names for display, from the site config.
const cfg = await readFile(new URL('../src/site.config.ts', import.meta.url), 'utf8');
const towns = Object.fromEntries([...cfg.matchAll(/\{ slug: '([a-z-]+)', name: '([^']+)' \}/g)].map((m) => [m[1], m[2]]));
const townName = (slug) => towns[slug] ?? slug;

const items = applyEditorial(wire.items ?? [], editorial, { now });
const live = (alerts.alerts ?? []).filter((a) => !a.expires || new Date(a.expires) > now);
const seen = new Set();
const activeAlerts = live.filter((a) => (seen.has(a.event) ? false : (seen.add(a.event), true)));

const out = buildNewsletter({ items, meetings: calendar.meetings ?? [], alerts: activeAlerts, now, townName });
const day = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
await mkdir(outDir, { recursive: true });
await writeFile(`${outDir}/${day}.html`, out.html);
await writeFile(`${outDir}/${day}.txt`, out.text);
await writeFile(`${outDir}/${day}.json`, JSON.stringify({ subject: out.subject, preheader: out.preheader, counts: out.counts, stories: out.stories.map((s) => s.id) }, null, 2));
console.log(JSON.stringify({ day, subject: out.subject, preheader: out.preheader, ...out.counts, files: [`${outDir}/${day}.html`, `${outDir}/${day}.txt`] }, null, 2));
