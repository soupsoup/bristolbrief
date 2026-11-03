// Election night results from the Massachusetts Secretary of the Commonwealth's
// results site (electionstats.state.ma.us). Candidates, districts and ballot
// questions come from src/data/election.json; this file turns the state's
// unofficial results into src/data/election-results.json.

export const STATS_BASE = 'https://electionstats.state.ma.us';
export const ELECTION_DATE = '2026-11-03';
// Polls close at 8 p.m. EST (daylight time ended Nov. 1). Results are checked from then until the
// window closes; later runs leave the last saved results alone.
export const POLLS_CLOSE = '2026-11-03T20:00:00-05:00';
export const WINDOW_END = '2026-11-10T00:00:00-05:00';

// Office ids the state uses, for narrower searches when the broad one comes back empty.
const OFFICE_IDS = [3, 4, 5, 6, 8, 9, 12, 45, 53, 90, 386, 389, 529, 530, 537];

const ORDINALS = {
  first: '1st', second: '2nd', third: '3rd', fourth: '4th', fifth: '5th', sixth: '6th', seventh: '7th', eighth: '8th',
  ninth: '9th', tenth: '10th', eleventh: '11th', twelfth: '12th', thirteenth: '13th', fourteenth: '14th',
};

/** Lowercase, "&" to "and", ordinal words to numerals, so "Third Bristol & Plymouth" equals "3rd Bristol and Plymouth". */
export function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth)\b/g, (m) => ORDINALS[m])
    .replace(/\s+/g, ' ')
    .trim();
}

/** The lookup key for one state election row: "officeId|district". */
export function rowKey(row) {
  return `${row?.Office?.id ?? ''}|${norm(row?.District?.display_name)}`;
}

/** Ballot question number from a row, or null when the row is not a ballot question. */
export function questionNumber(row) {
  const text = [row?.Office?.display_name, row?.Election?.name, row?.District?.display_name].filter(Boolean).join(' ');
  if (!/question/i.test(text)) return null;
  const m = text.match(/question\s*#?\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}

const num = (v) => {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** The general election rows for one date (or one party's primary, for testing against a past primary). */
export function pickElections(rows, { date = ELECTION_DATE, primary = null } = {}) {
  return (rows ?? []).filter((r) => {
    if (r?.Election?.date !== date) return false;
    const p = r.Election.party_primary ?? null;
    return primary ? p === primary : p === null;
  });
}

/** One election row reduced to what the page shows. */
export function normalizeElection(row) {
  const e = row.Election;
  const cands = (row.Candidate ?? []).map((c) => {
    const x = c.CandidateToElection ?? {};
    return {
      name: c.display_name ?? x.display_name,
      party: x.party ?? null,
      votes: num(x.n_votes),
      pct: null,
      state_winner: x.is_winner === '1' || x.is_winner === 1 || x.is_winner === true,
    };
  });
  cands.sort((a, b) => b.votes - a.votes);
  const total = cands.reduce((s, c) => s + c.votes, 0);
  for (const c of cands) c.pct = total ? Math.round((c.votes / total) * 1000) / 10 : null;
  return {
    election_id: String(e.id),
    total_votes: num(e.n_total_votes) || total,
    blank_votes: num(e.n_blank_votes),
    candidates: cands,
  };
}

/** Minimal CSV parser: quoted fields, commas inside quotes, CRLF. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// The state spells some towns differently from this site.
const TOWN_ALIASES = { 'north attleboro': 'north-attleborough', 'n. attleborough': 'north-attleborough', 'n. attleboro': 'north-attleborough' };
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Bristol County totals from a state download CSV: one column per candidate, summed over the county's 20 towns. */
export function countyTotals(csv, townSlugs) {
  const table = parseCsv(csv).filter((r) => r.some((c) => c.trim() !== ''));
  const head = table[0];
  if (!head) return null;
  const stop = head.findIndex((h, i) => i > 2 && /^(all others|blanks|total votes cast)$/i.test(h.trim()));
  const candCols = [];
  for (let i = 3; i < (stop === -1 ? head.length : stop); i++) if (head[i].trim()) candCols.push(i);
  const slugs = new Set(townSlugs);
  const sums = candCols.map(() => 0);
  let towns = 0;
  for (const r of table.slice(1)) {
    const label = r[0].trim();
    const slug = TOWN_ALIASES[label.toLowerCase()] ?? slugify(label);
    if (!slugs.has(slug)) continue;
    towns++;
    candCols.forEach((c, i) => { sums[i] += num(r[c]); });
  }
  if (!towns) return null;
  const total = sums.reduce((a, b) => a + b, 0);
  return {
    towns,
    candidates: candCols
      .map((c, i) => ({ name: head[c].trim(), votes: sums[i], pct: total ? Math.round((sums[i] / total) * 1000) / 10 : null }))
      .sort((a, b) => b.votes - a.votes),
  };
}

/**
 * Match state election rows to the races in election.json. Returns { races: { key: result }, unmatched: n }.
 * Statewide races and ballot questions also get a Bristol County subtotal from `csvById`.
 */
export function buildResults({ doc, rows, csvById = {}, townSlugs = [] }) {
  const byKey = new Map();
  for (const r of doc.races ?? []) for (const k of r.keys ?? []) byKey.set(k, r);
  const out = {};
  let unmatched = 0;
  for (const row of rows) {
    let key = null;
    const q = questionNumber(row);
    if (q != null) {
      if ((doc.questions ?? []).some((x) => x.n === q)) key = `q${q}`;
    } else {
      const direct = byKey.get(rowKey(row));
      if (direct) key = direct.key;
      else if (/county commissioner/i.test(row?.Office?.display_name ?? '') && norm(row?.District?.display_name) === 'bristol') key = 'county-commissioner';
    }
    if (!key) { unmatched++; continue; }
    const res = normalizeElection(row);
    const race = (doc.races ?? []).find((r) => r.key === key);
    // General-election rows carry the party; when one is blank, use the party printed on the ballot list.
    for (const c of res.candidates) {
      if (c.party) continue;
      const last = norm(c.name).split(' ').pop();
      const hit = (race?.candidates ?? []).find((x) => norm(x.name).split(' ').includes(last));
      if (hit?.party) c.party = hit.party;
    }
    if (key.startsWith('q') || race?.group === 'statewide') {
      const county = csvById[res.election_id] ? countyTotals(csvById[res.election_id], townSlugs) : null;
      if (county) res.bristol = county;
    }
    out[key] = res;
  }
  return { races: out, unmatched };
}

/**
 * Race tracking: compare this check with the last one. Each race gets its current leader and margin
 * (points between the top two), the margin at the previous check, and when the lead last changed.
 */
export function trackChanges(prevRaces = {}, nextRaces = {}, at = new Date().toISOString()) {
  const out = {};
  for (const [key, res] of Object.entries(nextRaces)) {
    const c = res.candidates ?? [];
    const leader = c.length === 1 ? c[0].name : c.length > 1 && c[0].votes > c[1].votes ? c[0].name : null;
    const margin = c.length > 1 && c[0].pct != null && c[1].pct != null ? Math.round((c[0].pct - c[1].pct) * 10) / 10 : null;
    const p = prevRaces[key];
    out[key] = {
      ...res,
      leader,
      margin,
      checked_at: at,
      prev_margin: p?.margin ?? null,
      prev_checked_at: p?.checked_at ?? null,
      lead_changed_at: p && p.leader && leader && p.leader !== leader ? at : p?.lead_changed_at ?? null,
    };
  }
  return out;
}

/** True while election-night checks should run. */
export function inWindow(now = new Date(), { force = false } = {}) {
  if (force) return true;
  const t = now.getTime();
  return t >= new Date(POLLS_CLOSE).getTime() && t < new Date(WINDOW_END).getTime();
}

const HEADERS = { 'x-requested-with': 'XMLHttpRequest', accept: 'application/json' };

/** Search the state's results database for one date. `getText(url, headers)` returns { status, body }. */
export async function findElections(getText, { date = ELECTION_DATE, primary = null } = {}) {
  const year = date.slice(0, 4);
  const base = `${STATS_BASE}/elections/search/year_from:${year}/year_to:${year}`;
  const parse = (body) => { try { return JSON.parse(body)?.output ?? []; } catch { return []; } };
  const seen = new Map();
  const add = (rows) => { for (const r of pickElections(rows, { date, primary })) seen.set(String(r.Election.id), r); };
  const stage = primary ?? 'General';
  // The broad search returns nothing when it matches too many elections, so ask office by office as well.
  const tries = [base, ...OFFICE_IDS.map((id) => `${base}/office_id:${id}/stage:${encodeURIComponent(stage)}`)];
  for (const url of tries) {
    try {
      const { status, body } = await getText(url, HEADERS);
      if (status === 200) add(parse(body));
    } catch { /* try the next one */ }
  }
  return [...seen.values()];
}

/** Download the town-by-town CSV for one election. */
export async function fetchCsv(getText, id) {
  const { status, body } = await getText(`${STATS_BASE}/elections/download/${id}/precincts_include:0/`, { 'x-requested-with': 'XMLHttpRequest' });
  if (status !== 200) throw new Error(`HTTP ${status}`);
  return body;
}

/**
 * One election-night check. Returns the next results document, or null when nothing should change
 * (outside the window, or the state has not published anything yet).
 */
export async function checkResults({ getText, doc, townSlugs, previous, now = new Date(), force = false, date = ELECTION_DATE, primary = null }) {
  if (!inWindow(now, { force })) return null;
  const rows = await findElections(getText, { date, primary });
  if (!rows.length) return null;
  const csvById = {};
  const wanted = new Set(
    rows
      .filter((r) => questionNumber(r) != null || (doc.races ?? []).some((x) => x.group === 'statewide' && x.keys?.includes(rowKey(r))))
      .map((r) => String(r.Election.id)),
  );
  await Promise.all([...wanted].map(async (id) => { try { csvById[id] = await fetchCsv(getText, id); } catch { /* county subtotal is optional */ } }));
  const { races, unmatched } = buildResults({ doc, rows, csvById, townSlugs });
  if (!Object.keys(races).length) return null;
  return {
    updated: now.toISOString(),
    status: 'live',
    source: 'Massachusetts Secretary of the Commonwealth, unofficial results',
    source_url: 'https://electionstats.state.ma.us/',
    elections_found: rows.length,
    unmatched,
    races: { ...(previous?.races ?? {}), ...trackChanges(previous?.races, races, now.toISOString()) },
  };
}
