// Build the morning newsletter from the day's data: a lead story, a handful
// more, today's public meetings, and any active alerts. Output is email-safe
// HTML (tables and inline styles, no external CSS) plus a plain-text copy, to
// paste into a beehiiv post. beehiiv adds its own header, unsubscribe link
// and footer, so none of those are included here.

export const SITE_URL = 'https://bristolbrief.com';
const ET = 'America/New_York';

const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Section weight: what a Bristol County reader most needs first.
const SECTION_WEIGHT = { 'public-safety': 3, government: 3, schools: 2, news: 2, business: 1, 'food-drink': 0.5, 'things-to-do': 0.5 };
const SKIP_SECTIONS = new Set(['listings', 'sports', 'real-estate']);

const titleKey = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const STOP = new Set('about after again against announces being between could county from have into over report reports says state their there these this those under what when where which while with would their local police city town'.split(' '));
const sig = (t) => new Set(titleKey(t).split(' ').filter((w) => w.length >= 5 && !STOP.has(w)));
const overlap = (a, b) => [...a].filter((w) => b.has(w)).length;
/** Same story from another outlet: two or more distinctive headline words in common. */
const sameStory = (a, b) => overlap(a, b) >= 2;

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
    .trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  if (stop > max * 0.5) return cut.slice(0, stop + 1);
  return cut.replace(/\s+\S*$/, '') + '…';
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
    .filter((i) => !i.team && !i.hidden)
    .filter((i) => (i.category === 'news' || i.category === 'public-safety') && !SKIP_SECTIONS.has(i.section))
    .filter((i) => new Date(i.date) <= now && hoursOld(i, now) <= hours)
    .filter((i) => trimSummary(i.summary).length >= 60)
    .map((i) => ({
      item: i,
      score: (SECTION_WEIGHT[i.section] ?? 1) + Math.min(coverage(i), 4) * 1.5 + (i.featuredRank != null ? 4 - Math.min(i.featuredRank, 3) : 0) - hoursOld(i, now) / 12,
      sig: sig(i.title),
    }))
    .sort((a, b) => b.score - a.score);
  const picked = [];
  const pickedSigs = [];
  for (const { item, sig: itemSig } of pool) {
    const key = titleKey(item.title);
    if (seenTitles.has(key)) continue;
    if (pickedSigs.some((p) => sameStory(p, itemSig))) continue;
    if ((perSource.get(item.source) ?? 0) >= 2) continue;
    seenTitles.add(key);
    pickedSigs.push(itemSig);
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

/** Scores worth a line: high school results from the last day. */
export function pickScores(items, { now = new Date(), hours = 24, count = 4 } = {}) {
  const seen = new Set();
  const out = [];
  for (const i of items) {
    if (i.team || i.hidden || i.section !== 'sports' || i.category === 'meetings') continue;
    if (new Date(i.date) > now || hoursOld(i, now) > hours) continue;
    const key = titleKey(i.title);
    if (seen.has(key)) continue;
    seen.add(key);
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

export const subjectFor = (stories, now = new Date()) => {
  const day = now.toLocaleDateString('en-US', { timeZone: ET, weekday: 'long', month: 'long', day: 'numeric' });
  const lead = stories[0];
  if (!lead) return `The Bristol Brief: ${day}`;
  return lead.title.length > 70 ? lead.title.slice(0, 67).replace(/\s+\S*$/, '') + '…' : lead.title;
};

const NAVY = '#14325a';
const RED = '#b3372b';
const INK = '#16202b';
const MUTED = '#5b6672';
const RULE = '#d9d4c6';
const FONT = "Georgia, 'Times New Roman', serif";
const SANS = "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";

const link = (href, text, extra = '') => `<a href="${esc(href)}" style="color:${NAVY};text-decoration:underline;${extra}">${text}</a>`;

export function buildNewsletter({ items, meetings = [], alerts = [], now = new Date(), townName = (s) => s } = {}) {
  const stories = pickStories(items, { now, townName });
  const scores = pickScores(items, { now });
  const todays = pickMeetings(meetings, { now, townName });
  const date = now.toLocaleDateString('en-US', { timeZone: ET, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const [lead, ...rest] = stories;
  const subject = subjectFor(stories, now);
  const preheader = stories.length > 1 ? stories.slice(1, 4).map((s) => s.title).join(' · ') : 'Local news for Bristol County, Massachusetts';

  const h = [];
  const label = (text) => `<p style="margin:28px 0 10px;font:700 12px ${SANS};letter-spacing:.08em;text-transform:uppercase;color:${RED};">${esc(text)}</p>`;

  h.push(`<div style="display:none;max-height:0;overflow:hidden;color:transparent;">${esc(preheader)}</div>`);
  h.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fbfaf6;"><tr><td align="center" style="padding:0 12px;">`);
  h.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;font-family:${FONT};color:${INK};">`);
  h.push(`<tr><td style="padding:24px 0 8px;border-bottom:3px solid ${NAVY};">`);
  h.push(`<p style="margin:0;font:700 26px ${FONT};color:${NAVY};">The Bristol Brief</p>`);
  h.push(`<p style="margin:4px 0 0;font:14px ${SANS};color:${MUTED};">${esc(date)}</p>`);
  h.push(`</td></tr><tr><td style="padding:8px 0 0;">`);

  if (alerts.length) {
    h.push(label('Alerts'));
    for (const a of alerts) {
      h.push(`<p style="margin:0 0 8px;font:15px/1.45 ${SANS};padding:10px 12px;background:#fdf1ef;border-left:4px solid ${RED};"><strong>${esc(a.event)}</strong>${a.areas ? ` for ${esc(trimSummary(a.areas, 120))}` : ''}.${a.link ? ` ${link(a.link, 'Details')}` : ''}</p>`);
    }
  }

  if (lead) {
    h.push(label(`Top story · ${lead.place}`));
    h.push(`<p style="margin:0 0 8px;font:700 24px/1.25 ${FONT};">${link(lead.link, esc(lead.title), 'color:' + INK + ';text-decoration:none;')}</p>`);
    h.push(`<p style="margin:0 0 6px;font:17px/1.55 ${FONT};">${esc(lead.summary)}</p>`);
    h.push(`<p style="margin:0;font:13px ${SANS};color:${MUTED};">${link(lead.link, 'Read at ' + esc(lead.source))}</p>`);
  }

  if (rest.length) {
    h.push(label('Also this morning'));
    for (const s of rest) {
      h.push(`<p style="margin:0 0 4px;font:700 18px/1.3 ${FONT};">${link(s.link, esc(s.title), 'color:' + INK + ';text-decoration:none;')}</p>`);
      h.push(`<p style="margin:0 0 4px;font:16px/1.5 ${FONT};">${esc(s.summary)}</p>`);
      h.push(`<p style="margin:0 0 16px;font:13px ${SANS};color:${MUTED};">${esc(s.place)} · ${esc(s.source)}</p>`);
    }
  }

  if (todays.length) {
    h.push(label('Public meetings today'));
    h.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font:15px/1.4 ${SANS};">`);
    for (const m of todays) {
      h.push(`<tr><td style="padding:6px 12px 6px 0;white-space:nowrap;color:${MUTED};vertical-align:top;border-top:1px solid ${RULE};">${esc(m.time)}</td><td style="padding:6px 0;vertical-align:top;border-top:1px solid ${RULE};"><strong>${esc(m.town)}</strong>: ${link(m.link, esc(m.title))}${m.hasAgenda ? ' <span style="color:' + MUTED + ';">(agenda posted)</span>' : ''}</td></tr>`);
    }
    h.push(`</table>`);
  }

  if (scores.length) {
    h.push(label('High school scores'));
    for (const s of scores) h.push(`<p style="margin:0 0 6px;font:15px/1.4 ${SANS};">${link(s.link, esc(s.title))}</p>`);
  }

  h.push(`<p style="margin:32px 0 0;padding:14px 0;border-top:1px solid ${RULE};font:15px/1.5 ${SANS};">More from all 20 cities and towns at ${link(SITE_URL, 'bristolbrief.com')}. Got a tip? Reply to this email or write <a href="mailto:tips@bristolbrief.com" style="color:${NAVY};">tips@bristolbrief.com</a>.</p>`);
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
