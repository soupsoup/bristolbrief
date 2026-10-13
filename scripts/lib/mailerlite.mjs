// MailerLite sign-up request, kept free of site code so it can be tested.
// API: https://developers.mailerlite.com/docs/subscribers.html (POST /api/subscribers creates
// the subscriber, or updates one that exists). Double opt-in is an account setting in MailerLite
// (Account settings > Subscribe settings), not a field sent here.

export const MAILERLITE_BASE = 'https://connect.mailerlite.com';

/** The fetch arguments for adding `email` to a MailerLite group. */
export function signupRequest({ apiKey, groupId, email, referrer = '', base = MAILERLITE_BASE }) {
  return {
    url: `${base}/api/subscribers`,
    init: {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        email,
        groups: [String(groupId)],
        fields: { source: (referrer || 'https://bristolbrief.com/').slice(0, 300) },
      }),
    },
  };
}

/** Map a MailerLite status code to our result. 422 means MailerLite rejected the address. */
export function resultFor(status) {
  if (status >= 200 && status < 300) return { ok: true };
  if (status === 422 || status === 400) return { ok: false, status: 400, error: 'invalid' };
  return { ok: false, status: 502, error: 'upstream' };
}
