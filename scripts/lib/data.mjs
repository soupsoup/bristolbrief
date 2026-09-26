// Normalizers for JSON data APIs: MBTA alerts, NOAA tides, CivicClerk meetings.
// Pure functions, no network.

export const MBTA_ROUTES = {
  'CR-NewBedford': 'Fall River/New Bedford Line',
  'CR-Providence': 'Providence/Stoughton Line',
};

export const MBTA_LINE_LABELS = {
  'CR-NewBedford': 'Fall River/New Bedford',
  'CR-Providence': 'Providence/Stoughton',
};

const EFFECT_LABELS = {
  DELAY: 'Delay',
  SHUTTLE: 'Shuttle buses',
  CANCELLATION: 'Cancellation',
  SUSPENSION: 'Suspension',
  TRACK_CHANGE: 'Track change',
  STATION_CLOSURE: 'Station closed',
  SCHEDULE_CHANGE: 'Schedule change',
  SERVICE_CHANGE: 'Service change',
  STATION_ISSUE: 'Station notice',
  PARKING_ISSUE: 'Parking',
  NOTICE: 'Notice',
};

export const mbtaEffectLabel = (effect = '') =>
  EFFECT_LABELS[effect] ?? effect.replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());

// Commuter rail stations in Bristol County, keyed by MBTA parent-station id.
export const MBTA_STATIONS = {
  'place-NEC-1919': { name: 'South Attleboro', town: 'attleboro' },
  'place-NEC-1969': { name: 'Attleboro', town: 'attleboro' },
  'place-NEC-2040': { name: 'Mansfield', town: 'mansfield' },
  'place-NBM-0546': { name: 'New Bedford', town: 'new-bedford' },
  'place-NBM-0523': { name: 'Church Street', town: 'new-bedford' },
  'place-FRS-0109': { name: 'Fall River Depot', town: 'fall-river' },
  'place-FRS-0054': { name: 'Freetown', town: 'freetown' },
  'place-NBM-0374': { name: 'East Taunton', town: 'taunton' },
};

/**
 * Keep alerts that touch our two lines, either line-wide or at a Bristol
 * County station. `stopParents` maps child stop/platform ids to parent ids,
 * built from the MBTA /stops response.
 */
export function normalizeMbtaAlerts(json, stopParents = {}, now = new Date()) {
  const out = [];
  for (const a of json.data ?? []) {
    const t = a.attributes ?? {};
    const entities = t.informed_entity ?? [];
    const routes = new Set();
    const stations = new Set();
    let lineWide = false;
    for (const e of entities) {
      if (!MBTA_ROUTES[e.route]) continue;
      routes.add(e.route);
      if (!e.stop) {
        lineWide = true;
        continue;
      }
      const parent = stopParents[e.stop] ?? e.stop;
      if (MBTA_STATIONS[parent]) stations.add(parent);
    }
    if (routes.size === 0 || (!lineWide && stations.size === 0)) continue;

    const periods = t.active_period ?? [];
    const current = periods.find((p) => (!p.end || new Date(p.end) > now)) ?? null;
    if (!current) continue;

    out.push({
      id: a.id,
      header: t.header,
      effect: t.effect,
      severity: t.severity,
      lifecycle: t.lifecycle,
      cause: t.cause,
      start: current.start,
      end: current.end ?? null,
      routes: [...routes],
      stations: [...stations].map((s) => MBTA_STATIONS[s].name),
      towns: [...new Set([...stations].map((s) => MBTA_STATIONS[s].town))],
      url: t.url ?? null,
      updated: t.updated_at,
    });
  }
  return out.sort((a, b) => b.severity - a.severity || String(b.updated).localeCompare(String(a.updated)));
}

/**
 * Map child stop ids (platforms) to parent station ids, from a /stops
 * response requested with include=child_stops.
 */
export function mbtaStopParents(stopsJson) {
  const map = {};
  for (const s of [...(stopsJson.data ?? []), ...(stopsJson.included ?? [])]) {
    const parent = s.relationships?.parent_station?.data?.id;
    if (parent) map[s.id] = parent;
    for (const child of s.relationships?.child_stops?.data ?? []) map[child.id] = s.id;
  }
  return map;
}

export const TIDE_STATIONS = [
  { id: '8447636', name: 'New Bedford Harbor', towns: ['new-bedford', 'fairhaven', 'acushnet'], observed: true },
  { id: '8447386', name: 'Fall River', towns: ['fall-river', 'somerset', 'swansea'], observed: true },
  { id: '8447842', name: 'Round Hill Point (South Dartmouth)', towns: ['dartmouth'], observed: false },
  { id: '8447975', name: 'Westport Harbor', towns: ['westport'], observed: false },
];

// NOAA returns local station time as "YYYY-MM-DD HH:MM" with time_zone=lst_ldt.
// Keep it as a naive local string plus an ISO timestamp for sorting.
export function easternToIso(local) {
  const [d, t] = local.split(' ');
  const guess = new Date(`${d}T${t}:00Z`);
  // Find the Eastern offset for that moment (EDT -4, EST -5).
  const tz = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' })
    .formatToParts(guess)
    .find((p) => p.type === 'timeZoneName').value; // e.g. "GMT-4"
  const offset = Number(tz.replace('GMT', '')) || -5;
  return new Date(guess.valueOf() - offset * 3600e3).toISOString();
}

export function normalizeTidePredictions(json) {
  return (json.predictions ?? []).map((p) => ({
    time: easternToIso(p.t),
    local: p.t,
    height: Number(Number(p.v).toFixed(1)),
    type: p.type === 'H' ? 'high' : 'low',
  }));
}

export function normalizeWaterLevel(json) {
  const d = json.data?.[0];
  if (!d) return null;
  return { time: easternToIso(d.t), local: d.t, height: Number(Number(d.v).toFixed(1)) };
}

/**
 * CivicClerk events. CivicClerk stores wall-clock local time with a "Z"
 * suffix, so strip it and treat the value as Eastern time.
 */
const GENERIC_TITLE = /^(one time event|recurring event|meeting|event)$|\b(19|20)\d{2}\b/i;

export function normalizeCivicClerk(json, { town, portal }) {
  const seen = new Map();
  const events = (json.value ?? [])
    .filter((e) => !e.isDeleted && e.isPublished !== 'Draft')
    .map((e) => {
      const local = String(e.startDateTime).replace(/Z$/, '').slice(0, 16).replace('T', ' ');
      const loc = e.eventLocation ?? {};
      const location = [loc.address1, loc.address2].filter(Boolean).map((s) => s.trim()).join(', ');
      const files = (e.publishedFiles ?? []).map((f) => ({ type: f.type, name: f.name, id: f.fileId }));
      const body = (e.categoryName || e.eventCategoryName || '').trim();
      const name = String(e.eventName ?? '').trim();
      // Clerks often leave placeholder names ("One Time Event", "September 22, 2026 II").
      const title = !name || GENERIC_TITLE.test(name) ? `${body || 'Public'} meeting` : name;
      return {
        id: `${town}-${e.id}`,
        title,
        body,
        start: easternToIso(local),
        location,
        town,
        link: `${portal}/event/${e.id}/overview`,
        hasAgenda: Boolean(e.hasAgenda || files.some((f) => /agenda/i.test(f.type))),
      };
    });
  // The same meeting is sometimes entered twice; keep the entry with a location.
  for (const m of events) {
    const key = `${m.body}|${m.start}`;
    const prev = seen.get(key);
    if (!prev || (!prev.location && m.location)) seen.set(key, m);
  }
  return [...seen.values()];
}
