// Password login with a signed, expiring session cookie. No user accounts:
// anyone with ADMIN_PASSWORD can edit. Changing the password (or setting
// ADMIN_SESSION_SECRET) signs everyone out.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { AstroCookies } from 'astro';

export const COOKIE = 'bb_admin';
const SESSION_DAYS = 7;

const env = (k: string) => process.env[k] ?? (import.meta.env[k] as string | undefined);

export const adminPassword = () => env('ADMIN_PASSWORD') || '';
export const adminEnabled = () => adminPassword().length > 0;

function secret() {
  return env('ADMIN_SESSION_SECRET') || createHash('sha256').update(`bristolbrief:${adminPassword()}`).digest('hex');
}

const sign = (value: string) => createHmac('sha256', secret()).update(value).digest('base64url');

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function checkPassword(attempt: string) {
  const pw = adminPassword();
  if (!pw) return false;
  // Hash both sides so the comparison is constant-time regardless of length.
  const h = (s: string) => createHash('sha256').update(s).digest('hex');
  return safeEqual(h(attempt), h(pw));
}

export function createSession(cookies: AstroCookies, secure: boolean) {
  const expires = Date.now() + SESSION_DAYS * 864e5;
  cookies.set(COOKIE, `${expires}.${sign(String(expires))}`, {
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    secure,
    expires: new Date(expires),
  });
}

export function hasSession(cookies: AstroCookies) {
  if (!adminEnabled()) return false;
  const raw = cookies.get(COOKIE)?.value ?? '';
  const [expires, mac] = raw.split('.');
  if (!expires || !mac || Number(expires) < Date.now()) return false;
  return safeEqual(mac, sign(expires));
}

export const endSession = (cookies: AstroCookies) => cookies.delete(COOKIE, { path: '/' });
