// Where the site reads its data. The hourly ingest commits fresh JSON to the
// `data` branch, which Vercel does not build. Pages are rendered on demand
// (and cached by Vercel for an hour), and each render calls loadData() to pull
// the current files from that branch. If GitHub is unreachable, the copies
// bundled with the last deploy are used, so the site never goes blank.
//
// Set DATA_BASE_URL to read from somewhere else (for example a local server
// while testing). In `astro dev` the bundled files are used unless it is set.

const bundledFiles = import.meta.glob('../data/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const bundled: Record<string, any> = Object.fromEntries(
  Object.entries(bundledFiles).map(([path, value]) => [path.split('/').pop()!.replace(/\.json$/, ''), value]),
);

/** Files the ingest rewrites every hour. Everything else (sources, editorial, election, ...) ships with the deploy. */
export const LIVE_FILES = [
  'wire',
  'alerts',
  'forecast',
  'election-results',
  'transit',
  'tides',
  'calendar',
  'schedules',
  'social-candidates',
  'videos',
  'feed-status',
  'police-log',
  'producthunt',
] as const;

const DEFAULT_BASE = 'https://raw.githubusercontent.com/soupsoup/bristolbrief/data/src/data';
const env = (k: string) => (typeof process !== 'undefined' ? process.env[k] : undefined) ?? (import.meta.env[k] as string | undefined);

const TTL_MS = 60_000;
const TIMEOUT_MS = 6_000;

const live: Record<string, any> = {};
let loadedAt = 0;
let inflight: Promise<boolean> | null = null;
let remoteEnabled = false;

const baseUrl = () => env('DATA_BASE_URL') || (import.meta.env.PROD ? DEFAULT_BASE : '');

async function fetchOne(base: string, name: string): Promise<any | undefined> {
  try {
    const res = await fetch(`${base}/${name}.json`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return undefined;
    return await res.json();
  } catch {
    return undefined;
  }
}

/** The current copy of a data file: fresh from the data branch when loadData() reached it, else the bundled one. */
export function getData<T = any>(name: string): T {
  return (live[name] ?? bundled[name] ?? {}) as T;
}

/** Refresh the live files if the last refresh is more than a minute old. Resolves true when something new was loaded. */
export function loadData(): Promise<boolean> {
  const base = baseUrl();
  if (!base) return Promise.resolve(false);
  remoteEnabled = true;
  if (Date.now() - loadedAt < TTL_MS) return Promise.resolve(false);
  if (inflight) return inflight;
  inflight = (async () => {
    const results = await Promise.all(LIVE_FILES.map(async (n) => [n, await fetchOne(base, n)] as const));
    let changed = false;
    for (const [name, value] of results) {
      if (value === undefined) continue;
      live[name] = value;
      changed = true;
    }
    // Retry soon after a total failure instead of waiting out the full interval.
    loadedAt = changed ? Date.now() : Date.now() - TTL_MS + 10_000;
    return changed;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

export const usingRemoteData = () => remoteEnabled;
