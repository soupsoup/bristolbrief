// Newsletter sign-ups go straight to beehiiv; nothing is stored on this site
// (the repository is public). Needs two environment variables on Vercel:
//   BEEHIIV_API_KEY         beehiiv → Settings → API → create a key
//   BEEHIIV_PUBLICATION_ID  the pub_… ID shown on the same page

const env = (k: string) => process.env[k] ?? (import.meta.env[k] as string | undefined);

export const newsletterConfigured = () => Boolean(env('BEEHIIV_API_KEY') && env('BEEHIIV_PUBLICATION_ID'));

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[A-Za-z]{2,}$/;
export const validEmail = (email: string) => email.length <= 254 && EMAIL_RE.test(email);

export type SubscribeResult =
  | { ok: true }
  | { ok: false; status: number; error: 'invalid' | 'not-configured' | 'upstream' };

/** Add an address to the beehiiv publication; beehiiv sends a confirmation email first. */
export async function subscribe(email: string, { referrer = '' } = {}): Promise<SubscribeResult> {
  if (!validEmail(email)) return { ok: false, status: 400, error: 'invalid' };
  if (!newsletterConfigured()) return { ok: false, status: 503, error: 'not-configured' };
  const pub = env('BEEHIIV_PUBLICATION_ID')!;
  try {
    const base = env('BEEHIIV_API_BASE') || 'https://api.beehiiv.com'; // overridable for local testing
    const res = await fetch(`${base}/v2/publications/${encodeURIComponent(pub)}/subscriptions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env('BEEHIIV_API_KEY')}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        reactivate_existing: false,
        // Double opt-in: beehiiv emails a confirmation link and only counts the
        // subscriber once they click it. The welcome email follows confirmation.
        double_opt_override: 'on',
        send_welcome_email: true,
        utm_source: 'bristolbrief.com',
        utm_medium: 'website',
        referring_site: referrer.slice(0, 300) || 'https://bristolbrief.com/',
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return { ok: true };
    // beehiiv answers 400 for addresses it rejects.
    if (res.status === 400 || res.status === 422) return { ok: false, status: 400, error: 'invalid' };
    console.error(`beehiiv subscribe failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
    return { ok: false, status: 502, error: 'upstream' };
  } catch (err: any) {
    console.error(`beehiiv subscribe failed: ${err.message}`);
    return { ok: false, status: 502, error: 'upstream' };
  }
}
