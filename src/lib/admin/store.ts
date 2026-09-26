// Where admin changes are saved. With ADMIN_GITHUB_TOKEN set (production), every
// save is a commit to the repository through the GitHub contents API, and
// Vercel redeploys the site. Without it (local development), files are
// written straight to disk.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { applyOp, normalizeEditorial, EditorialError } from '../../../scripts/lib/editorial.mjs';

const env = (k: string) => process.env[k] ?? (import.meta.env[k] as string | undefined);
const EDITORIAL_PATH = 'src/data/editorial.json';

export const storeInfo = () => {
  // Deliberately not GITHUB_TOKEN: CI systems set that name automatically.
  const token = env('ADMIN_GITHUB_TOKEN');
  return {
    mode: token ? ('github' as const) : ('local' as const),
    repo: env('GITHUB_REPO') || 'soupsoup/bristolbrief',
    branch: env('GITHUB_BRANCH') || 'main',
    token,
  };
};

async function gh(path: string, init: RequestInit = {}) {
  const { token, repo } = storeInfo();
  const res = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'bristolbrief-admin',
      ...(init.headers ?? {}),
    },
  });
  return res;
}

async function ghError(res: Response, what: string) {
  let detail = '';
  try {
    detail = (await res.json()).message ?? '';
  } catch {}
  if (res.status === 401) return new Error(`GitHub rejected the token (${what}). Check ADMIN_GITHUB_TOKEN in Vercel.`);
  if (res.status === 403 || res.status === 404)
    return new Error(`GitHub token can't ${what} (${res.status}). It needs Contents: read and write on ${storeInfo().repo}.`);
  return new Error(`GitHub ${what} failed: ${res.status} ${detail}`);
}

/** Read the current editorial document (fresh, not the copy baked into this deploy). */
export async function readEditorial(): Promise<{ doc: any; sha: string | null }> {
  const info = storeInfo();
  if (info.mode === 'local') {
    try {
      return { doc: normalizeEditorial(JSON.parse(await readFile(EDITORIAL_PATH, 'utf8'))), sha: null };
    } catch {
      return { doc: normalizeEditorial({}), sha: null };
    }
  }
  const res = await gh(`contents/${EDITORIAL_PATH}?ref=${encodeURIComponent(info.branch)}`, { cache: 'no-store' });
  if (res.status === 404) return { doc: normalizeEditorial({}), sha: null };
  if (!res.ok) throw await ghError(res, 'read editorial.json');
  const body = await res.json();
  return { doc: normalizeEditorial(JSON.parse(Buffer.from(body.content, 'base64').toString('utf8'))), sha: body.sha };
}

async function writeFileToRepo(path: string, content: Buffer, message: string, sha: string | null) {
  const info = storeInfo();
  const res = await gh(`contents/${path}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message,
      content: content.toString('base64'),
      branch: info.branch,
      ...(sha && { sha }),
      committer: { name: 'Bristol Brief admin', email: 'bristol-brief-admin@users.noreply.github.com' },
    }),
  });
  if (res.status === 409 || res.status === 422) return { conflict: true as const };
  if (!res.ok) throw await ghError(res, `write ${path}`);
  const body = await res.json();
  return { conflict: false as const, commitUrl: body.commit?.html_url as string | undefined };
}

/**
 * Apply one editorial operation and save it. Re-reads and retries when the
 * file changed underneath (another editor saved at the same time).
 */
export async function commitOp(op: any, knownIds: Set<string>, summary: string) {
  const info = storeInfo();
  for (let attempt = 0; attempt < 3; attempt++) {
    const { doc, sha } = await readEditorial();
    const next = applyOp(doc, op, { knownIds });
    const json = Buffer.from(JSON.stringify(next, null, 2) + '\n');
    if (info.mode === 'local') {
      await writeFile(EDITORIAL_PATH, json);
      return { doc: next, commitUrl: undefined };
    }
    const result = await writeFileToRepo(EDITORIAL_PATH, json, `Admin: ${summary}`, sha);
    if (!result.conflict) return { doc: next, commitUrl: result.commitUrl };
  }
  throw new EditorialError('Someone else saved at the same moment. Reload and try again.');
}

/** Save an uploaded photo under public/uploads/. Returns its public path. */
export async function saveUpload(data: Buffer, ext: string, nameHint: string) {
  const now = new Date();
  const month = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const base = (nameHint || 'photo').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'photo';
  const file = `${base}-${now.valueOf().toString(36)}.${ext}`;
  const publicPath = `/uploads/${month}/${file}`;
  const repoPath = `public${publicPath}`;
  const info = storeInfo();
  if (info.mode === 'local') {
    await mkdir(dirname(repoPath), { recursive: true });
    await writeFile(repoPath, data);
    return publicPath;
  }
  const result = await writeFileToRepo(repoPath, data, `Admin: upload photo ${file}`, null);
  if (result.conflict) throw new Error('A photo with that name already exists. Try again.');
  return publicPath;
}

