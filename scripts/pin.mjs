#!/usr/bin/env node
// Pin a story to the home page lead slot.
//
//   npm run pin -- "waterfront plan"                  pin the headline containing this text
//   npm run pin -- https://example.com/story          pin by URL
//   npm run pin -- "waterfront plan" --hours 48       keep it up for 48 hours (default 24)
//   npm run pin -- "waterfront plan" --summary "..."  replace the summary shown on the home page
//   npm run pin -- https://example.com/story --title "Headline" --source "Outlet" [--summary "..."] [--town new-bedford]
//                                                      pin a story that isn't in the wire
//   npm run pin -- --clear                            remove the pin
//   npm run pin                                       show the current pin
import { readFile, writeFile } from 'node:fs/promises';
import { findItems, resolvePin } from './lib/pin.mjs';
import { TOWNS } from '../src/site.config.ts';

const file = new URL('../src/data/pinned.json', import.meta.url);
const wire = JSON.parse(await readFile(new URL('../src/data/wire.json', import.meta.url), 'utf8')).items ?? [];
const current = JSON.parse(await readFile(file, 'utf8')).lead ?? null;

const args = process.argv.slice(2);
const et = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' });
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};

if (args.includes('--clear')) {
  await writeFile(file, JSON.stringify({ lead: null }, null, 2) + '\n');
  console.log('Pin cleared. The lead story is picked automatically again.');
  process.exit(0);
}

const hours = Number(flag('hours') ?? 24);
const title = flag('title');
const sourceName = flag('source');
const summary = flag('summary');
const town = flag('town');
const query = args.join(' ').trim();

if (!query) {
  if (!current) {
    console.log('Nothing pinned. The lead story is picked automatically.');
  } else {
    const { item, reason } = resolvePin(current, wire);
    console.log(
      item
        ? `Pinned until ${current.until ? et(current.until) : 'cleared'}: ${item.title} (${item.sourceName})`
        : `Pin is inactive (${reason}): ${current.url}`,
    );
  }
  process.exit(0);
}

if (town && !TOWNS.some((t) => t.slug === town)) {
  console.error(`Unknown town "${town}". Use one of: ${TOWNS.map((t) => t.slug).join(', ')}`);
  process.exit(1);
}

if (!Number.isFinite(hours) || hours <= 0) {
  console.error('--hours must be a positive number.');
  process.exit(1);
}

const matches = findItems(wire, query);
if (matches.length > 1) {
  console.error(`"${query}" matches ${matches.length} headlines. Use more of the headline, or the URL:\n`);
  for (const m of matches.slice(0, 10)) console.error(`  ${m.title}\n    ${m.sourceName} · ${m.link}\n`);
  process.exit(1);
}

const now = new Date();
const pin = {
  url: matches[0]?.link ?? query,
  pinnedAt: now.toISOString(),
  until: new Date(now.valueOf() + hours * 3600e3).toISOString(),
  ...(title && { title }),
  ...(sourceName && { sourceName }),
  ...(summary && { summary }),
  ...(town && { towns: [town] }),
};

const { item, reason } = resolvePin(pin, wire, now);
if (!item) {
  console.error(
    /^https?:\/\//i.test(query)
      ? 'That URL is not in the wire. To pin it anyway, add --title "Headline" and --source "Outlet name".'
      : `No headline contains "${query}". Check /news/ for the exact wording, or pin by URL.`,
  );
  process.exit(1);
}

await writeFile(file, JSON.stringify({ lead: pin }, null, 2) + '\n');
console.log(`Pinned${reason === 'manual' ? ' (not in the wire, using your details)' : ''}: ${item.title}`);
console.log(`  ${item.sourceName} · until ${et(pin.until)}`);
console.log('Rebuild or push to update the site.');
