// Build the morning newsletter from the day's data: a lead story, a handful
// more, today's public meetings, and any active alerts. Output is email-safe
// HTML (tables and inline styles, no external CSS) plus a plain-text copy, to
// paste into a beehiiv post. beehiiv adds its own header, unsubscribe link
// and footer, so none of those are included here.

import { titleKey, sig, sameStory, bodySig, sameIncident } from './dedupe.mjs';

export const SITE_URL = 'https://bristolbrief.com';
const ET = 'America/New_York';

const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Section weight: what a Bristol County reader most needs first.
const SECTION_WEIGHT = { 'public-safety': 3, government: 3, schools: 2, news: 2, business: 1, 'food-drink': 0.5, 'things-to-do': 0.5 };
const SKIP_SECTIONS = new Set(['listings', 'sports', 'real-estate']);

/** Drop tracking parameters outlets add to their feed links. */
export const cleanLink = (href) => {
  try {
    const u = new URL(href);
    for (const k of [...u.searchParams.keys()]) if (/^utm_/i.test(k)) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return href;
  }
};
const hoursOld = (i, now) => (now.valueOf() - new Date(i.date).valueOf()) / 3600e3;

/** Short, sentence-aligned summary: at most `max` characters. */
export function trimSummary(text = '', max = 220) {
  const clean = text
    .replace(/\u00AD/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^(?:By [A-Z][\w.' -]+,? (?:Editor|Staff Writer|Reporter)\s*)/i, '')
    .replace(/^(?:[A-Z][\w.' -]{0,50}? )?Press Release:?\s*/i, '')
    .replace(/^[A-Z][A-Z .,'-]{2,40}\s*(?:--|\u2014|\u2013|\u2500)\s*/, '')
    .trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  if (stop > max * 0.5) return cut.slice(0, stop + 1);
  return cut.replace(/\s+\S*$/, '') + '…';
}

// Places outside Massachusetts that border Bristol County and get tagged to a
// border town (a crash on the East Providence-Seekonk line). A story whose
// headline names one of these and none of its own towns is not about us.
const OUT_OF_STATE = /(?<!\w)(?:east providence|providence|pawtucket|central falls|cranston|warwick|west warwick|woonsocket|newport|middletown|portsmouth|tiverton|little compton|warren|barrington|cumberland|lincoln|johnston|smithfield|north providence|coventry|narragansett|rhode island|r\.i\.|connecticut|new hampshire|n\.h\.)(?!\w)/i;
const esc2 = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function outOfState(item, townName = (s) => s) {
  if (!OUT_OF_STATE.test(item.title)) return false;
  const named = (item.towns ?? []).some((t) => new RegExp(`\\b${esc2(townName(t))}\\b`, 'i').test(item.title));
  return !named;
}

/**
 * Pick stories: published in the last `hours`, newsroom or public-safety items
 * with a real summary, no listings, sports-wire or agendas, at most two per
 * source, no repeated headlines.
 */
export function pickStories(items, { now = new Date(), hours = 24, count = 6, townName = (s) => s } = {}) {
  const seenTitles = new Set();
  const perSource = new Map();
  const recent = items.filter((i) => !i.team && !i.hidden && new Date(i.date) <= now && hoursOld(i, now) <= hours + 24 && i.category !== 'meetings');
  const sigs = new Map(recent.map((i) => [i.id, sig(i.title)]));
  // How many other outlets ran the same story: the best signal of what matters today.
  const coverage = (i) => new Set(recent.filter((o) => o.source !== i.source && sameStory(sigs.get(i.id), sigs.get(o.id))).map((o) => o.source)).size;
  const pool = items
    .filter((i) => !i.team && !i.hidden && !outOfState(i, townName))
    .filter((i) => (i.category === 'news' || i.category === 'public-safety') && !SKIP_SECTIONS.has(i.section))
    .filter((i) => new Date(i.date) <= now && hoursOld(i, now) <= hours)
    .filter((i) => trimSummary(i.summary).length >= 60)
    .map((i) => ({
      item: i,
      score: (SECTION_WEIGHT[i.section] ?? 1) + Math.min(coverage(i), 4) * 1.5 + (i.featuredRank != null ? 4 - Math.min(i.featuredRank, 3) : 0) - hoursOld(i, now) / 12,
      sig: sig(i.title),
      body: bodySig(i),
      towns: i.towns ?? [],
    }))
    .sort((a, b) => b.score - a.score);
  const picked = [];
  const pickedSigs = [];
  for (const { item, sig: itemSig, body, towns } of pool) {
    const key = titleKey(item.title);
    if (seenTitles.has(key)) continue;
    if (pickedSigs.some((p) => sameStory(p.sig, itemSig) || sameIncident(p, { body, towns }))) continue;
    if ((perSource.get(item.source) ?? 0) >= 2) continue;
    seenTitles.add(key);
    pickedSigs.push({ sig: itemSig, body, towns });
    perSource.set(item.source, (perSource.get(item.source) ?? 0) + 1);
    picked.push({
      id: item.id,
      title: item.title,
      summary: trimSummary(item.summary),
      link: cleanLink(item.link?.startsWith('http') ? item.link : `${SITE_URL}${item.link ?? '/'}`),
      source: item.sourceName,
      place: item.countywide || !item.towns?.length ? 'Bristol County' : item.towns.map(townName).join(', '),
      section: item.section,
    });
    if (picked.length === count) break;
  }
  return picked;
}

// "falls to" is a result; "this fall" is a season, so the bare word is not here.
const SCORE_WORDS = /\b(?:beat|beats|edge|edges|edged|defeat|defeats|win|wins|won|top|tops|downs|blank|blanks|tie|ties|tied|rout|routs|rolls|sweep|sweeps|swept|shut out|falls? to|lose|loses|lost|nicked|tally|tallies)\b/i;
const hostOf = (href = '') => {
  try {
    return new URL(href).hostname;
  } catch {
    return '';
  }
};
const SCORELINE = /\b\d{1,3}\s?[-\u2013]\s?\d{1,3}\b/;
// Features, matchups and ceremonies that mention a sport without reporting a result.
const NOT_A_RESULT = /\b(?:vs\.?|versus|preview|previews|schedule|hall of fame|induction|players?|starring|honored|awards?)\b/i;

/**
 * A game result: an "H.S. ..." headline, a result verb or a score like 28-0, and
 * not a matchup stub ("X vs. Y"), schedule, feature or ceremony without a score.
 */
export function isScoreHeadline(title, summary = '') {
  const scored = SCORELINE.test(`${title} ${summary}`);
  if (NOT_A_RESULT.test(title) && !scored) return false;
  return /^H\.?\s?S\.?\s/i.test(title) || SCORE_WORDS.test(title) || scored;
}

/** Scores worth a line: high school results from the last day, one line per game. */
export function pickScores(items, { now = new Date(), hours = 24, count = 4, townName = (s) => s } = {}) {
  const pickedSigs = [];
  const out = [];
  for (const i of items) {
    if (i.team || i.hidden || i.section !== 'sports' || i.category === 'meetings' || !isScoreHeadline(i.title, i.summary)) continue;
    // Google News links are opaque redirects; a score line should name where it goes.
    if (/(^|\.)news\.google\.com$/.test(hostOf(i.link))) continue;
    if (new Date(i.date) > now || hoursOld(i, now) > hours || outOfState(i, townName)) continue;
    // The same game often comes from two outlets with different headlines.
    const s = { sig: sig(i.title), body: bodySig(i), towns: i.towns ?? [] };
    if (pickedSigs.some((p) => sameStory(p.sig, s.sig) || sameIncident(p, s))) continue;
    pickedSigs.push(s);
    out.push({ title: i.title, link: i.link, source: i.sourceName });
    if (out.length === count) break;
  }
  return out;
}

const etDay = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: ET });
const etTime = (d) => new Date(d).toLocaleTimeString('en-US', { timeZone: ET, hour: 'numeric', minute: '2-digit' });

/** Public meetings on the same Eastern-time date as `now`. */
export function pickMeetings(meetings, { now = new Date(), count = 8, townName = (s) => s } = {}) {
  const today = etDay(now);
  return meetings
    .filter((m) => etDay(m.start) === today)
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, count)
    .map((m) => ({ time: etTime(m.start), town: townName(m.town), title: m.title, link: m.link, hasAgenda: Boolean(m.hasAgenda) }));
}

const FILLER = /\s(?:of|and|the|a|an|at|in|on|for|to|by|with|from|or|as|after|over|amid|while|that|who|is|are|was|were)$/i;
// Where a headline can end and still read as a thought: clause breaks first,
// then prepositions.
const CLAUSE_BREAKS = [': ', ' - ', ' after ', ' as ', ' while ', ' amid ', ' accused '];
const PREP_BREAKS = [' over ', ' with ', ' for ', ' in ', ' at ', ' on ', ' from ', ' by '];

/**
 * Shorten a headline to at most `max` characters without an ellipsis. Returns
 * the whole headline when it fits, else the longest prefix (of at least `min`
 * characters) that ends at a clause break, else at a preposition. Returns ''
 * when no clean cut exists; callers fall back to something else instead of
 * printing half a sentence.
 */
export function shortHeadline(title, max = 70, min = 28) {
  let t = title.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
  t = t.replace(/^["']\w[^"':]{0,24}["']:\s+/, '');
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (t.length <= max) return t;
  for (const breaks of [CLAUSE_BREAKS, PREP_BREAKS]) {
    let best = '';
    for (const b of breaks) {
      for (let from = 0; ; ) {
        const at = t.indexOf(b, from);
        if (at < 0 || at > max) break;
        const prefix = t.slice(0, at).replace(/[,:;\s-]+$/, '');
        if (at >= min && prefix.length > best.length && !FILLER.test(prefix)) best = prefix;
        from = at + 1;
      }
    }
    if (best) return best;
  }
  return '';
}

const dayLabel = (now) => now.toLocaleDateString('en-US', { timeZone: ET, weekday: 'long', month: 'short', day: 'numeric' }).replace('Sept', 'Sep');

/** Subject line: the lead headline, whole when it fits in 70 characters, else cut at a clause; the date when neither works. */
export function subjectFor(stories, now = new Date(), max = 70) {
  const lead = stories[0];
  return (lead && shortHeadline(lead.title, max)) || `The Bristol Brief: ${dayLabel(now)}`;
}

/**
 * Preview text, 100 characters or fewer. Built from facts that always read
 * cleanly (alert, towns covered, meetings, scores) instead of clipped headlines.
 */
export function previewFor(stories, { alerts = [], meetings = [], scores = [] } = {}, max = 100) {
  const towns = [];
  for (const s of stories.slice(1)) for (const t of s.place.split(', ')) if (t !== 'Bristol County' && !towns.includes(t)) towns.push(t);
  const list = (xs) => (xs.length === 1 ? xs[0] : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
  const extras = [];
  if (meetings.length) extras.push(`${meetings.length} public meeting${meetings.length === 1 ? '' : 's'} today`);
  if (scores.length) extras.push('high school scores');
  const lead = alerts.length ? `${alerts[0].event} in effect. ` : '';
  // Try the richest version first and drop pieces until it fits.
  for (let n = Math.min(towns.length, 4); n >= 0; n--) {
    for (const ex of [extras, extras.slice(0, 1), []]) {
      const from = n ? `More from ${list(towns.slice(0, n))}` : '';
      const tail = ex.length ? `${from ? ', plus ' : 'Plus '}${list(ex)}` : '';
      const text = `${lead}${from}${tail}`.trim();
      if (text && text.length + 1 <= max) return `${text}.`;
    }
  }
  return stories.length ? 'Local headlines for the 20 cities and towns of Bristol County.' : 'Local news for Bristol County, Massachusetts.';
}

const NAVY = '#14325a';
const RED = '#b3372b';
const INK = '#16202b';
const MUTED = '#5b6672';
const RULE = '#d9d4c6';
const FONT = "Georgia, 'Times New Roman', serif";
const SANS = "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";

// beehiiv and email clients add their own rules to links and paragraphs (italic
// links in the publication's link color, extra paragraph spacing). Inline
// declarations marked !important win over those even when theirs are
// !important too, so every style here is marked, text sits in plain divs
// instead of paragraphs, and link text is wrapped in a span of its own.
const imp = (css) =>
  css
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => `${d}!important`)
    .join(';');
const type = (family, weight, size, lineHeight) => `font-family:${family};font-weight:${weight};font-size:${size}px;line-height:${lineHeight}px;font-style:normal`;
const box = (css, inner) => `<div style="${imp(css)}">${inner}</div>`;
const link = (href, text, { color = NAVY, underline = true } = {}) => {
  const css = `color:${color};text-decoration:${underline ? 'underline' : 'none'};font-style:normal`;
  return `<a href="${esc(href)}" style="${imp(css)}"><span style="${imp(css)}">${text}</span></a>`;
};

export function buildNewsletter({ items, meetings = [], alerts = [], now = new Date(), townName = (s) => s } = {}) {
  const stories = pickStories(items, { now, townName });
  const scores = pickScores(items, { now, townName });
  const todays = pickMeetings(meetings, { now, townName });
  const date = now.toLocaleDateString('en-US', { timeZone: ET, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const [lead, ...rest] = stories;
  const subject = subjectFor(stories, now);
  const preheader = previewFor(stories, { alerts, meetings: todays, scores });

  const h = [];
  const label = (text) => box(`margin:24px 0 8px;${type(SANS, 700, 12, 16)};letter-spacing:.08em;text-transform:uppercase;color:${RED}`, esc(text));

  h.push(`<div style="display:none;max-height:0;overflow:hidden;color:transparent;">${esc(preheader)}</div>`);
  h.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fbfaf6;"><tr><td align="center" style="padding:0 12px;">`);
  h.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;font-family:${FONT};color:${INK};">`);
  h.push(`<tr><td style="padding:24px 0 8px;border-bottom:3px solid ${NAVY};">`);
  h.push(box(`margin:0;${type(FONT, 700, 26, 32)};color:${NAVY}`, 'The Bristol Brief'));
  h.push(box(`margin:2px 0 0;${type(SANS, 400, 14, 18)};color:${MUTED}`, esc(date)));
  h.push(`</td></tr><tr><td style="padding:4px 0 0;">`);

  if (alerts.length) {
    h.push(label('Alerts'));
    for (const a of alerts) {
      h.push(
        box(
          `margin:0 0 8px;${type(SANS, 400, 15, 21)};padding:10px 12px;background:#fdf1ef;border-left:4px solid ${RED}`,
          `<strong style="${imp('font-weight:700;font-style:normal')}">${esc(a.event)}</strong>${a.areas ? ` for ${esc(trimSummary(a.areas, 120))}` : ''}.${a.link ? ` ${link(a.link, 'Details')}` : ''}`,
        ),
      );
    }
  }

  if (lead) {
    h.push(label(`Top story · ${lead.place}`));
    h.push(box(`margin:0 0 6px;${type(FONT, 700, 24, 30)}`, link(lead.link, esc(lead.title), { color: INK, underline: false })));
    h.push(box(`margin:0 0 4px;${type(FONT, 400, 17, 24)}`, esc(lead.summary)));
    h.push(box(`margin:0;${type(SANS, 400, 13, 18)};color:${MUTED}`, link(lead.link, 'Read at ' + esc(lead.source))));
  }

  if (rest.length) {
    h.push(label('Also this morning'));
    for (const s of rest) {
      h.push(box(`margin:0 0 3px;${type(FONT, 700, 18, 23)}`, link(s.link, esc(s.title), { color: INK, underline: false })));
      h.push(box(`margin:0 0 3px;${type(FONT, 400, 16, 22)}`, esc(s.summary)));
      h.push(box(`margin:0 0 14px;${type(SANS, 400, 13, 18)};color:${MUTED}`, `${esc(s.place)} · ${esc(s.source)}`));
    }
  }

  if (todays.length) {
    h.push(label('Public meetings today'));
    h.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${imp(`${type(SANS, 400, 15, 21)}`)}">`);
    for (const m of todays) {
      h.push(
        `<tr><td style="padding:6px 12px 6px 0;white-space:nowrap;color:${MUTED};vertical-align:top;border-top:1px solid ${RULE};">${esc(m.time)}</td><td style="padding:6px 0;vertical-align:top;border-top:1px solid ${RULE};"><strong style="${imp('font-weight:700;font-style:normal')}">${esc(m.town)}</strong>: ${link(m.link, esc(m.title))}${m.hasAgenda ? ` <span style="${imp(`color:${MUTED};font-style:normal`)}">(agenda posted)</span>` : ''}</td></tr>`,
      );
    }
    h.push(`</table>`);
  }

  if (scores.length) {
    h.push(label('High school scores'));
    for (const s of scores) h.push(box(`margin:0 0 5px;${type(SANS, 400, 15, 21)}`, link(s.link, esc(s.title))));
  }

  h.push(
    box(
      `margin:28px 0 0;padding:14px 0;border-top:1px solid ${RULE};${type(SANS, 400, 15, 22)}`,
      `More from all 20 cities and towns at ${link(SITE_URL, 'bristolbrief.com')}. Got a tip? Reply to this email or write ${link('mailto:tips@bristolbrief.com', 'tips@bristolbrief.com')}.`,
    ),
  );
  h.push(`</td></tr></table></td></tr></table>`);

  const t = [];
  t.push(`THE BRISTOL BRIEF · ${date}`, '');
  for (const a of alerts) t.push(`ALERT: ${a.event}${a.areas ? ' for ' + trimSummary(a.areas, 120) : ''}.${a.link ? ' ' + a.link : ''}`, '');
  if (lead) t.push(`TOP STORY · ${lead.place}`, lead.title, lead.summary, `${lead.source}: ${lead.link}`, '');
  if (rest.length) {
    t.push('ALSO THIS MORNING', '');
    for (const s of rest) t.push(s.title, s.summary, `${s.place} · ${s.source}: ${s.link}`, '');
  }
  if (todays.length) {
    t.push('PUBLIC MEETINGS TODAY');
    for (const m of todays) t.push(`${m.time}  ${m.town}: ${m.title} ${m.link}`);
    t.push('');
  }
  if (scores.length) {
    t.push('HIGH SCHOOL SCORES');
    for (const s of scores) t.push(`${s.title} ${s.link}`);
    t.push('');
  }
  t.push(`More from all 20 cities and towns: ${SITE_URL}`, 'Got a tip? tips@bristolbrief.com');

  return { subject, preheader, html: h.join('\n'), text: t.join('\n'), counts: { stories: stories.length, meetings: todays.length, scores: scores.length, alerts: alerts.length }, stories };
}
