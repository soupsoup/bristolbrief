#!/usr/bin/env node
// Pull every enabled source in src/data/sources.json and write:
//   src/data/wire.json         headlines for the site (merged with prior runs)
//   src/data/alerts.json       active National Weather Service alerts
//   src/data/transit.json      MBTA commuter rail alerts for Bristol County stations
//   src/data/tides.json        NOAA tide predictions and latest water levels
//   src/data/calendar.json     upcoming public meetings with real dates (CivicClerk)
//   src/data/schedules.json    Red Sox and Bruins results and upcoming games
//   src/data/social-candidates.json  Bluesky/Mastodon posts for editors to review
//   src/data/feed-status.json  per-source health report
//
// Usage: node scripts/ingest.mjs [--only id1,id2] [--dry-run]
import { readFile, writeFile } from 'node:fs/promises';
import { parseFeed, normalize, normalizeNws, mergeItems } from './lib/parse.mjs';
import {
  MBTA_ROUTES,
  MBTA_STATIONS,
  TIDE_STATIONS,
  normalizeMbtaAlerts,
  mbtaStopParents,
  normalizeTidePredictions,
  normalizeWaterLevel,
  normalizeCivicClerk,
} from './lib/data.mjs';
import { scanSocial } from './lib/social.mjs';
import { SCHEDULE_TEAMS, trimSchedule } from './lib/schedules.mjs';

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
// Towns whose meeting calendars run on CivicClerk (public OData API, no key).
const CIVICCLERK = [{ town: 'taunton', tenant: 'tauntonma' }];
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

async function fetchJson(url) {
  const { status, body } = await fetchText(url, { accept: 'application/json, application/vnd.api+json' });
  if (status !== 200) throw new Error(`HTTP ${status}`);
  return JSON.parse(body);
}

async function ingestTransit() {
  try {
    const routes = Object.keys(MBTA_ROUTES).join(',');
    const [alerts, stops] = await Promise.all([
      fetchJson(`https://api-v3.mbta.com/alerts?filter[route]=${routes}`),
      fetchJson(`https://api-v3.mbta.com/stops?filter[id]=${Object.keys(MBTA_STATIONS).join(',')}&include=child_stops`),
    ]);
    // Platform -> station map, saved so the browser can re-filter live alerts.
    const stopParents = mbtaStopParents(stops);
    return { ok: true, alerts: normalizeMbtaAlerts(alerts, stopParents), stopParents };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

const ymd = (d) => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replaceAll('-', '');

async function ingestTides() {
  const base = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?datum=MLLW&units=english&time_zone=lst_ldt&format=json&application=bristolbrief';
  try {
    const stations = await Promise.all(
      TIDE_STATIONS.map(async (st) => {
        const predictions = normalizeTidePredictions(
          await fetchJson(`${base}&station=${st.id}&product=predictions&interval=hilo&begin_date=${ymd(new Date())}&range=96`),
        );
        let observed = null;
        if (st.observed) {
          try {
            observed = normalizeWaterLevel(await fetchJson(`${base}&station=${st.id}&product=water_level&date=latest`));
          } catch {
            // Sensors go offline; predictions still stand on their own.
          }
        }
        return { id: st.id, name: st.name, towns: st.towns, predictions, observed };
      }),
    );
    return { ok: true, stations };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function ingestCalendar() {
  const now = new Date();
  // A week back (so recent agendas and minutes stay linked) through 60 days out.
  const from = new Date(now.valueOf() - 7 * 864e5).toISOString().slice(0, 19) + 'Z';
  const to = new Date(now.valueOf() + 60 * 864e5).toISOString().slice(0, 19) + 'Z';
  const meetings = [];
  const errors = [];
  for (const { town, tenant } of CIVICCLERK) {
    const filter = encodeURIComponent(`startDateTime ge ${from} and startDateTime le ${to}`);
    try {
      const json = await fetchJson(`https://${tenant}.api.civicclerk.com/v1/Events?$filter=${filter}&$orderby=startDateTime`);
      meetings.push(...normalizeCivicClerk(json, { town, portal: `https://${tenant}.portal.civicclerk.com` }));
    } catch (err) {
      errors.push(`${town}: ${err.message}`);
    }
  }
  meetings.sort((a, b) => a.start.localeCompare(b.start));
  return { ok: errors.length < CIVICCLERK.length, meetings, error: errors.join('; ') || undefined };
}

/** Merge this run's social finds with earlier ones: newest first, a week back, 300 max. */
async function ingestSocial() {
  try {
    const { posts, errors } = await scanSocial();
    const prev = (await readJson('src/data/social-candidates.json', { posts: [] })).posts ?? [];
    const cutoff = Date.now() - 7 * 864e5;
    const byId = new Map(prev.map((p) => [p.id, p]));
    for (const p of posts) byId.set(p.id, p);
    const merged = [...byId.values()]
      .filter((p) => new Date(p.postedAt).valueOf() >= cutoff)
      .sort((a, b) => String(b.postedAt).localeCompare(String(a.postedAt)))
      .slice(0, 300);
    return { ok: posts.length > 0 || errors.length === 0, posts: merged, found: posts.length, errors };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

const { sources } = await readJson('src/data/sources.json', { sources: [] });
const selected = sources.filter((s) => s.enabled && (!only || only.includes(s.id)));

async function ingestSchedules() {
  const now = new Date();
  const teams = {};
  const errors = [];
  await Promise.all(
    SCHEDULE_TEAMS.map(async (t) => {
      try {
        const { status, body } = await fetchText(t.url(now), { accept: 'application/json' });
        if (status !== 200) throw new Error(`HTTP ${status}`);
        teams[t.team] = { league: t.league, ...trimSchedule(t.normalize(JSON.parse(body)), now) };
      } catch (err) {
        errors.push(`${t.team}: ${err.message}`);
      }
    }),
  );
  return { ok: Object.keys(teams).length > 0, teams, errors };
}

const [results, alertResult, transit, tides, calendar, social, schedules] = await Promise.all([
  pool(selected, CONCURRENCY, ingestSource),
  ingestAlerts(),
  ingestTransit(),
  ingestTides(),
  ingestCalendar(),
  ingestSocial(),
  ingestSchedules(),
]);

const incoming = results.flatMap((r) => r.items);
const wire = await readJson('src/data/wire.json', { items: [] });
const aggregatedSources = new Set(sources.filter((s) => s.via === 'google-news').map((s) => s.id));
const merged = mergeItems(wire.items ?? [], incoming, { aggregatedSources });

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
console.log(
  `MBTA: ${transit.ok ? `${transit.alerts.length} alerts` : `failed (${transit.error})`}. ` +
    `Tides: ${tides.ok ? `${tides.stations.length} stations` : `failed (${tides.error})`}. ` +
    `Meetings: ${calendar.ok ? `${calendar.meetings.length} scheduled` : `failed (${calendar.error})`}. ` +
    `Social: ${social.ok ? `${social.found} found, ${social.posts.length} to review` : `failed (${social.error ?? social.errors?.join('; ')})`}. ` +
    `Schedules: ${Object.keys(schedules.teams).join(', ') || 'none'}${schedules.errors.length ? ` (failed: ${schedules.errors.join('; ')})` : ''}.`,
);

if (!dryRun) {
  const now = new Date().toISOString();
  await writeFile(path('src/data/wire.json'), JSON.stringify({ updated: now, items: merged }, null, 1) + '\n');
  if (alertResult.ok) {
    await writeFile(path('src/data/alerts.json'), JSON.stringify({ updated: now, alerts: alertResult.alerts }, null, 1) + '\n');
  }
  // Keep the last good copy when an API is down.
  if (transit.ok) {
    await writeFile(path('src/data/transit.json'), JSON.stringify({ updated: now, alerts: transit.alerts, stopParents: transit.stopParents }, null, 1) + '\n');
  }
  if (tides.ok) {
    await writeFile(path('src/data/tides.json'), JSON.stringify({ updated: now, stations: tides.stations }, null, 1) + '\n');
  }
  if (social.ok) {
    await writeFile(path('src/data/social-candidates.json'), JSON.stringify({ updated: now, posts: social.posts }, null, 1) + '\n');
  }
  if (schedules.ok) {
    // Merge so one league's API being down keeps that team's last good copy.
    const prev = await readJson('src/data/schedules.json', { teams: {} });
    await writeFile(path('src/data/schedules.json'), JSON.stringify({ updated: now, teams: { ...prev.teams, ...schedules.teams } }, null, 1) + '\n');
  }
  if (calendar.ok) {
    await writeFile(path('src/data/calendar.json'), JSON.stringify({ updated: now, meetings: calendar.meetings }, null, 1) + '\n');
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
