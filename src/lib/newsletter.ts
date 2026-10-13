// Newsletter sign-ups go straight to MailerLite; nothing is stored on this site
// (the repository is public). Needs two environment variables on Vercel:
//   MAILERLITE_API_KEY   MailerLite > Integrations > API > generate a new token
//   MAILERLITE_GROUP_ID  the numeric ID of the group sign-ups join (shown in the group's URL)
import { signupRequest, resultFor } from '../../scripts/lib/mailerlite.mjs';

const env = (k: string) => process.env[k] ?? (import.meta.env[k] as string | undefined);

export const newsletterConfigured = () => Boolean(env('MAILERLITE_API_KEY') && env('MAILERLITE_GROUP_ID'));

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[A-Za-z]{2,}$/;
export const validEmail = (email: string) => email.length <= 254 && EMAIL_RE.test(email);

export type SubscribeResult =
  | { ok: true }
  | { ok: false; status: number; error: 'invalid' | 'not-configured' | 'upstream' };

/** Add an address to the MailerLite group; MailerLite sends the confirmation email if double opt-in is on. */
export async function subscribe(email: string, { referrer = '' } = {}): Promise<SubscribeResult> {
  if (!validEmail(email)) return { ok: false, status: 400, error: 'invalid' };
  if (!newsletterConfigured()) return { ok: false, status: 503, error: 'not-configured' };
  try {
    const { url, init } = signupRequest({
      apiKey: env('MAILERLITE_API_KEY')!,
      groupId: env('MAILERLITE_GROUP_ID')!,
      email,
      referrer,
      base: env('MAILERLITE_API_BASE') || undefined, // overridable for local testing
    });
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
    const result = resultFor(res.status);
    if (!result.ok && result.error === 'upstream') console.error(`MailerLite subscribe failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
    return result;
  } catch (err: any) {
    console.error(`MailerLite subscribe failed: ${err.message}`);
    return { ok: false, status: 502, error: 'upstream' };
  }
}
