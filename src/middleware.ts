import { defineMiddleware } from 'astro:middleware';
import { hasSession, adminEnabled } from './lib/admin/auth';

const OPEN = new Set(['/admin/login/', '/admin/login', '/api/admin/login/', '/api/admin/login']);

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  const isAdmin = pathname.startsWith('/admin') || pathname.startsWith('/api/admin');
  if (!isAdmin || context.isPrerendered) return next();

  const isApi = pathname.startsWith('/api/');

  // Browsers always send Origin on cross-site POSTs; reject any that aren't ours.
  if (context.request.method !== 'GET') {
    const origin = context.request.headers.get('origin');
    if (origin && origin !== context.url.origin) {
      return new Response('Cross-site request blocked', { status: 403 });
    }
  }

  if (!adminEnabled()) {
    return new Response('The admin is turned off. Set ADMIN_PASSWORD in the Vercel project to enable it.', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  if (!OPEN.has(pathname) && !hasSession(context.cookies)) {
    if (isApi) return Response.json({ error: 'Signed out. Reload the page and sign in again.' }, { status: 401 });
    return context.redirect(`/admin/login/?next=${encodeURIComponent(pathname + context.url.search)}`);
  }

  const res = await next();
  res.headers.set('cache-control', 'no-store');
  res.headers.set('x-robots-tag', 'noindex, nofollow');
  return res;
});
