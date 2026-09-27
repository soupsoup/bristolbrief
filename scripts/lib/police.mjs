// Parsers for police department logs published as PDFs. scripts/police-log.mjs
// turns each PDF into text (pdftotext, or tesseract OCR for scanned pages) and
// hands the text to these functions.
//
// Privacy rules, applied here so every caller gets them:
// - No names or home addresses of people arrested, and no officer names.
// - Locations are reduced to the street name (no house number).
// - Juvenile arrests are left out entirely.
// - Medical and mental-health calls are left out of call logs.

export const POLICE_DEPTS = {
  nbpd: {
    name: 'New Bedford Police',
    town: 'new-bedford',
    index: 'https://www.newbedfordpd.com/resources/police-logs/',
    kind: 'arrests',
    pdfPattern: /https:\/\/www\.newbedfordpd\.com\/wp-content\/uploads\/[^"'\s<>]*Arrest[^"'\s<>]*\.pdf/gi,
  },
  tpd: {
    name: 'Taunton Police',
    town: 'taunton',
    index: 'https://tauntonpd.com/tpd-police-logs/',
    kind: 'calls',
    schedule: 'which Taunton posts every few months',
    pdfPattern: /https:\/\/tauntonpd\.com\/wp-content\/uploads\/[^"'\s<>]*Public-Log[^"'\s<>]*\.pdf/gi,
  },
  apd: {
    name: 'Attleboro Police',
    town: 'attleboro',
    index: `https://www.attleboropolice.org/logs-${new Date().getFullYear()}/`,
    // One page per year; read last year's too so December's logs aren't
    // missed in January.
    pages: (now = new Date()) => [0, 1].map((n) => `https://www.attleboropolice.org/logs-${now.getFullYear() - n}/`),
    kind: 'calls',
    schedule: 'which Attleboro posts weekly, usually a few weeks behind',
    pdfPattern: /https:\/\/www\.attleboropolice\.org\/wp-content\/uploads\/[^"'\s<>]*plog[^"'\s<>]*\.pdf/gi,
  },
};

// Entries stay in the data file for six months, like direct feed headlines.
export const POLICE_KEEP_DAYS = 183;

const SMALL = new Set(['and', 'of', 'or', 'to', 'in', 'on', 'at', 'by', 'for', 'the', 'a', 'w/', 'w/o']);
const KEEP_UPPER = /^(MVA|MV|M\/V|OUI|OUI-LIQUOR|OUI-DRUGS|MV|A&B|ABDW|B&E|DOKT|II|III|IV|US|RMV|ID|ATV)$/;

export function titleCase(s) {
  return s
    .toLowerCase()
    .split(/(\s+|-|\/)/)
    .map((w, i) => {
      const up = w.toUpperCase();
      if (KEEP_UPPER.test(up.replace(/[()]/g, ''))) return up;
      if (i > 0 && SMALL.has(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join('');
}

// "640 PLEASANT ST" -> "Pleasant St"; "RT 140 / COUNTY ST" -> "Rt 140 / County St".
export function streetOnly(address) {
  const s = address
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\d+[A-Z]?(?:-\d*[A-Z]?)?\s+(?=\S)/i, '')
    .replace(/[#,].*$/, '')
    .trim();
  return titleCase(s);
}

// Offense text from the New Bedford arrest log, minus docket numbers and
// statute codes: "WARRANT ARREST DOKT#2633CR002832" -> "Warrant arrest".
export function cleanOffense(s) {
  const t = s
    .replace(/\bD(?:O)?KT\.?\s*#?\s*\S+/gi, '')
    .replace(/\bWR\s*#?\s*\d\w*/gi, '')
    .replace(/#\s*\d\w*/g, '')
    .replace(/\bc\.?\s*\d+\w*\s*(?:s\.?|§)\s*\d+\S*/gi, '')
    .replace(/§\s*\S+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[\s,;:-]+$/, '')
    .trim();
  if (!t) return '';
  // Sentence case, keeping acronyms such as OUI and A&B.
  const words = titleCase(t).split(' ');
  return words.map((w, i) => (i === 0 || KEEP_UPPER.test(w.toUpperCase()) ? w : w.toLowerCase())).join(' ');
}

/**
 * New Bedford "Arrest Status Report". Works on pdftotext -layout output and on
 * tesseract OCR output, which drops the layout and adds stray characters.
 * @param {string} text
 * @param {{ pdf?: string }} [opts]
 */
export function parseNbArrestLog(text, { pdf } = {}) {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/[|]/g, ' ').replace(/\s+$/, ''));
  const entries = [];
  let cur = null;
  let field = null;
  const flush = () => {
    if (cur && cur.date && !cur.juvenile) {
      const offenses = cur.offenses.map(cleanOffense).filter(Boolean);
      if (offenses.length) {
        entries.push({
          id: `nbpd-${cur.caseNo}`,
          dept: 'nbpd',
          town: 'new-bedford',
          date: cur.date,
          street: cur.location ? streetOnly(cur.location) : '',
          offenses,
          ...(cur.domestic ? { domestic: true } : {}),
          ...(pdf ? { pdf } : {}),
        });
      }
    }
    cur = null;
    field = null;
  };
  for (const raw of lines) {
    const line = raw.trim();
    // Case line: "26-1590-AR 29611 4065 2026-09-20 Open Y N N"
    const c = line.match(/^(\d{2}-\d{3,5}-AR)\b.*?(\d{4}-\d{2}-\d{2})\s+\w+\s+([YN])\s*([YN])\s*([YN])\s*$/i);
    if (c) {
      flush();
      cur = { caseNo: c[1].toUpperCase(), juvenile: c[4].toUpperCase() === 'Y', domestic: c[5].toUpperCase() === 'Y', offenses: [] };
      continue;
    }
    const c2 = line.match(/^(\d{2}-\d{3,5}-AR)\b/i);
    if (c2) {
      // Flags unreadable (OCR): keep the case but treat it as juvenile so it is
      // dropped; better to miss an arrest than publish a juvenile's.
      flush();
      cur = { caseNo: c2[1].toUpperCase(), juvenile: true, domestic: false, offenses: [] };
      continue;
    }
    if (!cur) continue;
    const d = line.match(/^Arrest\s*Date\s*>?\s*(\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2})/i);
    if (d) {
      cur.date = `${d[1]}T${d[2].padStart(2, '0')}:${d[3]}`;
      field = null;
      continue;
    }
    if (/^Location\s*>?/i.test(line)) {
      field = 'location';
      continue;
    }
    const o = line.match(/^Offenses\s*>?\s*(.*)$/i);
    if (o) {
      field = 'offenses';
      const m = o[1].match(/^\(\d+\)\s*(.+)$/);
      if (m) cur.offenses.push(m[1]);
      continue;
    }
    if (/^Suspects?\s*>?/i.test(line) || /^Report generated/i.test(line) || /^Case[_ ]Number/i.test(line)) {
      field = null;
      continue;
    }
    if (field === 'location' && !cur.location && line && !/^Zone/i.test(line)) {
      cur.location = line;
      continue;
    }
    if (field === 'offenses') {
      if (/^IBR\s*:/i.test(line) || !line) continue;
      const m = line.match(/^\(\d+\)\s*(.+)$/);
      if (m) cur.offenses.push(m[1]);
    }
  }
  flush();
  return entries;
}

// Taunton's and Attleboro's logs list every call. Keep crimes, crashes with
// injuries, disturbances and anything that ended in an arrest or summons; drop
// routine patrols, alarms, parking, fender-benders, and medical or
// mental-health calls.
const TPD_SKIP = /property damage only|prevention orders?$|mva (over|under|property)|security check|m\/v stop|traffic enforcement|abandoned 911|^restraining order$|civil matter|notification|\bmisc\b|follow up|road hazard|(returned|recovered|lost) property|illegal dumping|assist fire|erratic|directed patrol|building check|check building|motor vehicle stop|parking|alarm|assist citizen|assist other agency|disabled motor|hang up|repossession|property (found|lost)|general information|prisoner watch|medical|mental|suicid|section c\.? ?123|overdose|well being|check person|disturbed person|wires down|tree down|bolo|transport|lockout|animal|serve|service of|funeral|escort|detail/i;
const TPD_KEEP = /crash|hit-n-run|pedestrian|break and enter|identity theft|extortion|scam|property crime|b ?& ?e|breaking|assault|a ?& ?b|disturbance|fight|fraud|larceny|theft|stolen|shoplift|robbery|gunshot|shots|weapon|firearm|stabbing|vandal|malicious|graffiti|fireworks|suspicious|trespass|harass|threat|drug|narcotic|oui|hit and run|road rage|missing|protective order|restraining|warrant|kidnap|arson|fire\b|noise|complaint/i;
const TPD_ACTION_KEEP = /arrest|summons/i;
const TPD_ACTION_SKIP = /unfounded|duplicate|cancelled|false alarm/i;

export function callNotable({ type, action }) {
  if (TPD_ACTION_KEEP.test(action)) return !/medical|mental|suicid|section c\.? ?123|overdose/i.test(type);
  if (TPD_ACTION_SKIP.test(action)) return false;
  if (TPD_SKIP.test(type)) return false;
  if (/^complaint$/i.test(type) || /noise|traffic complaint/i.test(type)) return false;
  return TPD_KEEP.test(type);
}

/**
 * Taunton "Police - Public Log" (ProPhoenix), pdftotext -layout output.
 * Times are printed on a 12-hour clock with no AM/PM; incident numbers are
 * sequential, so each time is taken as the reading closest after the previous
 * incident's.
 * @param {string} text
 * @param {{ pdf?: string, all?: boolean }} [opts]
 */
export function parseTauntonLog(text, { pdf, all = false } = {}) {
  const lines = text.split(/\r?\n/);
  const rows = [];
  let cur = null;
  for (const line of lines) {
    const m = line.match(/^(\d{2}-\d{6})\s+(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})\s{2,}(.*)$/);
    if (m) {
      const rest = m[7];
      const cols = [];
      const re = /\S+(?: \S+)*/g;
      let x;
      while ((x = re.exec(rest))) cols.push({ text: x[0], at: line.length - rest.length + x.index });
      cur = {
        no: m[1],
        day: `${m[4]}-${m[2]}-${m[3]}`,
        h: +m[5],
        min: +m[6],
        cols,
      };
      rows.push(cur);
      continue;
    }
    if (!cur) continue;
    if (/^Responding Officers/i.test(line) || /^ProPhoenix|^Police - Public Log|^RMS Incident/i.test(line.trim())) {
      cur = /^Responding/i.test(line) ? null : cur;
      continue;
    }
    // A wrapped incident type or action continues on the next line, indented
    // to its column.
    const w = line.match(/^(\s{10,})(\S.*)$/);
    if (w && cur.cols.length) {
      const at = w[1].length;
      let best = cur.cols[0];
      for (const c of cur.cols) if (Math.abs(c.at - at) < Math.abs(best.at - at)) best = c;
      if (Math.abs(best.at - at) <= 3) best.text += ' ' + w[2].trim().split(/\s{2,}/)[0];
    }
  }

  const out = [];
  let prevDay = '';
  let prev = 0;
  for (const r of rows) {
    if (r.cols.length < 3) continue;
    // Location, type and action, left to right. A missing location shifts
    // columns, so read from the right.
    const action = r.cols[r.cols.length - 1].text;
    const type = r.cols[r.cols.length - 2].text;
    const location = r.cols.length >= 3 ? r.cols[r.cols.length - 3].text : '';
    if (r.day !== prevDay) {
      prevDay = r.day;
      prev = 0;
    }
    const am = (r.h % 12) * 60 + r.min;
    const t = am + 20 >= prev ? am : am + 720;
    prev = Math.max(prev, t);
    const hh = String(Math.floor(t / 60)).padStart(2, '0');
    const mm = String(t % 60).padStart(2, '0');
    const entry = {
      id: `tpd-${r.no}`,
      dept: 'tpd',
      town: 'taunton',
      date: `${r.day}T${hh}:${mm}`,
      street: streetOnly(location),
      type: type.replace(/\s+/g, ' ').replace(/,$/, ''),
      action: action.replace(/\s+/g, ' '),
      ...(pdf ? { pdf } : {}),
    };
    if (all || callNotable(entry)) out.push(entry);
  }
  return out;
}

const cleanCharge = (s) =>
  cleanOffense(
    s
      .trim()
      .replace(/^\S*\d\S*\s+/, '') // leading code: 94C/34/I, 3601
      .replace(/\s*\*\s*/g, ' '),
  );

const cleanAction = (s) => {
  if (/arrest/i.test(s)) return 'Arrest';
  if (/summons/i.test(s)) return 'Summons';
  return titleCase(s);
};

/**
 * Attleboro "Public Police Log" (Microsoft Reporting Services), pdftotext
 * -layout output. A weekly list of calls, then an "Arrests:" table with names,
 * home addresses and charges. Only the charges are used, attached to the
 * matching call by incident number.
 * @param {string} text
 * @param {{ pdf?: string, all?: boolean }} [opts]
 */
export function parseAttleboroLog(text, { pdf, all = false } = {}) {
  const lines = text.split(/\r?\n/);
  // In two-digit months the year's last digit wraps to the next line
  // ("12/21/202" then "5"). Put it back.
  for (let i = 0; i < lines.length - 1; i++) {
    const m = lines[i].match(/^(\s*\d{10}\s+\d{1,2}\/\d{1,2}\/\d{3})(?!\d)/);
    const n = lines[i + 1].match(/^(\s+)(\d)(?=\s|$)/);
    if (m && n) {
      lines[i] = m[1] + n[2] + lines[i].slice(m[1].length);
      lines[i + 1] = n[1] + ' ' + lines[i + 1].slice(n[0].length);
    }
  }
  const rows = [];
  const arrests = new Map();
  let cur = null;
  let arrest = null;
  let inArrests = false;
  let inCharges = false;
  for (const line of lines) {
    if (/^\s*Arrests:\s*$/.test(line)) {
      inArrests = true;
      cur = null;
      continue;
    }
    if (/^\s*Page \d+ of \d+/.test(line) || /Attleboro Police Department|Public Police Log|Incidents and Arrests|^\s*From :/.test(line)) continue;
    if (inArrests) {
      const a = line.match(/^\s*(\d{10})\s+\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}\s*[AP]M\b(.*)$/);
      if (a) {
        const age = a[2].match(/\s(\d{1,3})\s+[A-Z]\s+[MFUX]\s*$/);
        arrest = arrests.get(a[1]) ?? { minAge: Infinity, charges: [] };
        // No readable age: treat as a juvenile, so the call is dropped.
        arrest.minAge = Math.min(arrest.minAge, age ? +age[1] : 0);
        arrests.set(a[1], arrest);
        inCharges = false;
        continue;
      }
      if (/^\s*Charges\s*$/.test(line)) {
        inCharges = true;
        continue;
      }
      if (inCharges && arrest && line.trim()) {
        const c = cleanCharge(line);
        if (c && !arrest.charges.includes(c)) arrest.charges.push(c);
      }
      continue;
    }
    const m = line.match(/^\s*(\d{10})\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*([AP]M)\s+(.*)$/);
    if (m) {
      const rest = m[8];
      const cols = [];
      const re = /\S+(?: \S+)*/g;
      let x;
      while ((x = re.exec(rest))) cols.push({ text: x[0], at: line.length - rest.length + x.index });
      let h = +m[5] % 12;
      if (m[7] === 'PM') h += 12;
      cur = { no: m[1], date: `${m[4]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}T${String(h).padStart(2, '0')}:${m[6]}`, cols };
      rows.push(cur);
      continue;
    }
    // Wrapped address, type or action: attach to the nearest column.
    const w = line.match(/^(\s{10,})(\S.*)$/);
    if (cur && w) {
      let at = w[1].length;
      for (const part of w[2].split(/\s{2,}/)) {
        let best = cur.cols[0];
        for (const c of cur.cols) if (Math.abs(c.at - at) < Math.abs(best.at - at)) best = c;
        if (best && Math.abs(best.at - at) <= 12) best.text += ' ' + part.trim();
        at += part.length + 2;
      }
    } else if (!line.trim()) {
      cur = null;
    }
  }

  const out = [];
  for (const r of rows) {
    if (r.cols.length < 2) continue;
    const [location, type, ...act] = r.cols.map((c) => c.text.replace(/\s+/g, ' '));
    const rawAction = act.join(' ');
    if (/juvenile/i.test(rawAction)) continue;
    const arr = arrests.get(r.no);
    if (arr && arr.minAge < 18) continue;
    const entry = {
      id: `apd-${r.no}`,
      dept: 'apd',
      town: 'attleboro',
      date: r.date,
      street: streetOnly(location),
      type: titleCase(type),
      action: cleanAction(rawAction),
      ...(arr?.charges.length ? { charges: arr.charges } : {}),
      ...(pdf ? { pdf } : {}),
    };
    if (all || callNotable(entry)) out.push(entry);
  }
  return out;
}

/** Merge new entries into old by id and drop anything older than six months. */
export function mergePolice(existing, incoming, now = new Date()) {
  const byId = new Map(existing.map((e) => [e.id, e]));
  for (const e of incoming) byId.set(e.id, e);
  const cutoff = new Date(now.valueOf() - POLICE_KEEP_DAYS * 864e5).toISOString().slice(0, 16);
  return [...byId.values()].filter((e) => e.date >= cutoff).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}
