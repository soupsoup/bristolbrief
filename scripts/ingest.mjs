#!/usr/bin/env node
// Pull every enabled source in src/data/sources.json and write:
//   src/data/wire.json         headlines for the site (merged with prior runs)
//   src/data/alerts.json       active National Weather Service alerts
//   src/data/feed-status.json  per-source health report
//
// Usage: node scripts/ingest.mjs [--only id1,id2] [--dry-run]
import { readFile, writeFile } from 'node:fs/promises';
import { parseFeed, normalize, normalizeNws, mergeItems } from './lib/parse.mjs';

const ROOT = new URL('../', import.meta.url);
const path = (p) => new URL(p, ROOT);
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const dryRun = args.includes('--dry-run');

// Some government sites reject non-browser user agents, so identify as a
// browser-compatible bot with a contact URL.
const UA = 'Mozilla/5.0 (compatible; BristolBriefBot/1.0; +https://bristolbrief.com/sources/)';
// A few servers (justice.gov) refuse anything that doesn't look like a browser.
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const NWS_ZONES = ['MAZ017', 'MAZ020', 'MAC005', 'ANZ234', 'ANZ236'];
const CONCURRENCY = 6;

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(path(file), 'utf8'));
  } catch {
    return fallback;
  }
}

async function fetchText(url, { attempts = 2, accept } = {}) {
  let lastErr;
  let ua = UA;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          'user-agent': ua,
          accept: accept ?? 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(25_000),
      });
      if ((res.status === 401 || res.status === 403) && ua === UA) {
        ua = BROWSER_UA;
        throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
      }
      if (res.status === 429 || res.status >= 500) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
      if (!res.ok) return { status: res.status, body: '' };
      return { status: res.status, body: await res.text() };
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw lastErr;
}

async function pool(items, n, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    }),
  );
  return results;
}

async function ingestSource(source) {
  const started = Date.now();
  const status = { id: source.id, name: source.name, url: source.url, checkedAt: new Date().toISOString() };
  try {
    const { status: http, body } = await fetchText(source.url);
    status.http = http;
    if (http !== 200) return { status: { ...status, ok: false, error: `HTTP ${http}` }, items: [] };
    const entries = parseFeed(body);
    const items = normalize(entries, source);
    const newest = entries.map((e) => e.date).filter(Boolean).sort((a, b) => b - a)[0];
    return {
      status: {
        ...status,
        ok: true,
        entries: entries.length,
        kept: items.length,
        newest: newest?.toISOString() ?? null,
        ms: Date.now() - started,
      },
      items,
    };
  } catch (err) {
    return { status: { ...status, ok: false, error: err.message }, items: [] };
  }
}

async function ingestAlerts() {
  const url = `https://api.weather.gov/alerts/active?zone=${NWS_ZONES.join(',')}`;
  try {
    const { status, body } = await fetchText(url, { accept: 'application/geo+json' });
    if (status !== 200) throw new Error(`HTTP ${status}`);
    const alerts = normalizeNws(JSON.parse(body));
    return { ok: true, alerts };
  } catch (err) {
    return { ok: false, error: err.message, alerts: null };
  }
}

const { sources } = await readJson('src/data/sources.json', { sources: [] });
const selected = sources.filter((s) => s.enabled && (!only || only.includes(s.id)));

const [results, alertResult] = await Promise.all([pool(selected, CONCURRENCY, ingestSource), ingestAlerts()]);

const incoming = results.flatMap((r) => r.items);
const wire = await readJson('src/data/wire.json', { items: [] });
const merged = mergeItems(wire.items ?? [], incoming);

const failed = results.filter((r) => !r.status.ok);
for (const r of results) {
  const s = r.status;
  console.log(
    `${s.ok ? 'ok  ' : 'FAIL'} ${s.id.padEnd(30)} ${s.ok ? `${s.kept}/${s.entries} kept, newest ${s.newest?.slice(0, 10) ?? '-'}` : s.error}`,
  );
}
console.log(
  `\n${results.length - failed.length}/${results.length} sources ok, ${incoming.length} items fetched, ${merged.length} in wire. ` +
    `NWS: ${alertResult.ok ? `${alertResult.alerts.length} active alerts` : `failed (${alertResult.error})`}`,
);

if (!dryRun) {
  const now = new Date().toISOString();
  await writeFile(path('src/data/wire.json'), JSON.stringify({ updated: now, items: merged }, null, 1) + '\n');
  if (alertResult.ok) {
    await writeFile(path('src/data/alerts.json'), JSON.stringify({ updated: now, alerts: alertResult.alerts }, null, 1) + '\n');
  }
  // Only rewrite the status file for a full run so --only doesn't drop entries.
  if (!only) {
    await writeFile(
      path('src/data/feed-status.json'),
      JSON.stringify({ updated: now, sources: results.map((r) => r.status) }, null, 1) + '\n',
    );
  }
}

// Fail the job only when most sources are down (likely a network problem).
if (failed.length > results.length / 2) process.exit(1);
