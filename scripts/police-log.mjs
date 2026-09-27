#!/usr/bin/env node
// Build src/data/police-log.json from the New Bedford and Taunton police log
// PDFs. Each run reads the departments' log pages, downloads PDFs it hasn't
// processed yet, and turns them into text: pdftotext for text PDFs, and
// pdftoppm + tesseract for scanned ones (New Bedford has scanned its logs
// since mid-August 2026). Needs poppler-utils and tesseract-ocr.
//
// Usage: node scripts/police-log.mjs [--check] [--limit N]
//   --check  only report whether new PDFs are waiting (for CI: sets
//            needs_tools=true in $GITHUB_OUTPUT), without downloading them.
import { readFile, writeFile, mkdtemp, rm, appendFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POLICE_DEPTS, POLICE_KEEP_DAYS, parseNbArrestLog, parseTauntonLog, parseAttleboroLog, mergePolice } from './lib/police.mjs';

const run = promisify(execFile);
const FILE = new URL('../src/data/police-log.json', import.meta.url);
const UA = 'Mozilla/5.0 (compatible; BristolBriefBot/1.0; +https://bristolbrief.com/sources/)';
const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
// Cap OCR work per run so a backlog can't blow the CI time limit.
const limit = args.includes('--limit') ? +args[args.indexOf('--limit') + 1] : 20;

async function readJson(url, fallback) {
  try {
    return JSON.parse(await readFile(url, 'utf8'));
  } catch {
    return fallback;
  }
}

async function get(url, type = 'text') {
  const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return type === 'text' ? res.text() : Buffer.from(await res.arrayBuffer());
}

// New Bedford file names carry the log date: Arrest-Log-9-20-2026.pdf,
// Arrests-08-01-26.pdf, Arrests-July-30-2026.docx.pdf. Undated names sort
// last and are still processed.
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function nbDate(url) {
  const file = url.split('/').pop();
  const m = file.match(/(\d{1,2}|[a-z]{3,9})-(\d{1,2})-(\d{2,4})\b/i);
  if (!m) return '';
  const mon = /^\d/.test(m[1]) ? +m[1] : MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
  if (!mon) return '';
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${y}-${String(mon).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

async function listPdfs(dept) {
  const pages = dept.pages?.() ?? [dept.index];
  const found = [];
  let ok = 0;
  for (const page of pages) {
    try {
      found.push(...((await get(page)).match(dept.pdfPattern) ?? []));
      ok++;
    } catch (err) {
      if (page === pages[0] && pages.length === 1) throw err;
      console.warn(`${page}: ${err.message}`);
    }
  }
  if (!ok) throw new Error(`no log page reachable for ${dept.name}`);
  return [...new Set(found)];
}

async function pdfText(buf, dir) {
  const pdf = join(dir, 'log.pdf');
  await writeFile(pdf, buf);
  const { stdout } = await run('pdftotext', ['-layout', pdf, '-'], { maxBuffer: 256 * 1024 * 1024 });
  if (stdout.replace(/\s/g, '').length > 80) return { text: stdout, ocr: false };
  // Scanned: render each page and OCR it.
  await run('pdftoppm', ['-r', '300', '-gray', '-png', pdf, join(dir, 'page')]);
  const { stdout: ls } = await run('ls', [dir]);
  const pages = ls.split('\n').filter((f) => /^page-\d+\.png$/.test(f)).sort();
  let text = '';
  for (const p of pages) {
    const { stdout: t } = await run('tesseract', [join(dir, p), '-', '--psm', '6'], { maxBuffer: 64 * 1024 * 1024 });
    text += t + '\n';
    await rm(join(dir, p));
  }
  return { text, ocr: true };
}

const data = await readJson(FILE, { updated: null, departments: {}, entries: [] });
const now = new Date();
const cutoffDay = new Date(now.valueOf() - POLICE_KEEP_DAYS * 864e5).toISOString().slice(0, 10);

// Work out which PDFs are new for each department.
const queues = [];
for (const [id, dept] of Object.entries(POLICE_DEPTS)) {
  const state = (data.departments[id] ??= { processed: [] });
  state.name = dept.name;
  state.town = dept.town;
  state.index = dept.index;
  state.kind = dept.kind;
  try {
    const pdfs = await listPdfs(dept);
    state.error = undefined;
    let fresh = pdfs.filter((u) => !state.processed.includes(u));
    if (id === 'nbpd') {
      // Daily logs: skip ones older than the retention window.
      fresh = fresh.filter((u) => !nbDate(u) || nbDate(u) >= cutoffDay).sort((a, b) => nbDate(b).localeCompare(nbDate(a)));
    }
    // Forget PDFs the department has taken down so the list doesn't grow forever.
    state.processed = state.processed.filter((u) => pdfs.includes(u));
    queues.push(fresh.map((url) => ({ id, url })));
  } catch (err) {
    state.error = err.message;
    console.warn(`${id}: ${err.message}`);
  }
}

// Take turns between departments so one backlog can't starve the other.
const todo = [];
for (let i = 0; queues.some((q) => i < q.length); i++) for (const q of queues) if (i < q.length) todo.push(q[i]);
console.log(`${todo.length} new police log PDF(s)`);
if (checkOnly) {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `needs_tools=${todo.length > 0}\n`);
  process.exit(0);
}

let incoming = [];
const dir = await mkdtemp(join(tmpdir(), 'police-'));
try {
  for (const { id, url } of todo.slice(0, limit)) {
    const state = data.departments[id];
    try {
      const buf = await get(url, 'buffer');
      const { text, ocr } = await pdfText(buf, dir);
      const entries =
        id === 'nbpd' ? parseNbArrestLog(text, { pdf: url }) : id === 'apd' ? parseAttleboroLog(text, { pdf: url }) : parseTauntonLog(text);
      console.log(`${id}: ${entries.length} entries from ${url.split('/').pop()}${ocr ? ' (OCR)' : ''}`);
      incoming = incoming.concat(entries);
      state.processed.push(url);
    } catch (err) {
      // Leave it unprocessed so the next run retries.
      console.warn(`${id}: ${url}: ${err.message}`);
      state.error = err.message;
    }
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}

data.entries = mergePolice(data.entries ?? [], incoming, now);
for (const [id, state] of Object.entries(data.departments)) {
  const mine = data.entries.filter((e) => e.dept === id);
  state.coveredThrough = mine[0]?.date ?? state.coveredThrough ?? null;
  if (state.error === undefined) delete state.error;
}
data.updated = now.toISOString();
await writeFile(FILE, JSON.stringify(data, null, 2) + '\n');
console.log(`police-log.json: ${data.entries.length} entries`);
