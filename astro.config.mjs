// @ts-check
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import node from '@astrojs/node';

// DEPLOY_TARGET=node builds a standalone Node server for the VPS
// (deploy/vps/). Anything else, including Vercel's own builds, keeps the
// Vercel adapter, so both hosts work during the move.
const onVps = process.env.DEPLOY_TARGET === 'node';

// Canonical URLs, Open Graph tags and the RSS feed use this address.
// Set SITE_URL once you have a custom domain; until then Vercel's
// production URL is used when building there.
const site =
  process.env.SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'https://bristolbrief.com');

// Every page renders on demand from the data branch (see src/lib/data-source.ts),
// so the hourly data never needs a build: builds happen only for code and
// admin changes. On the VPS, nginx caches the rendered public pages for a few
// minutes (deploy/vps/nginx-bristolbrief.conf). On Vercel, ISR caches each public
// page for an hour. The admin area and API routes are never cached. The
// sitemap is built in src/pages/sitemap.xml.ts.
export default defineConfig({
  site,
  output: 'server',
  adapter: onVps ? node({ mode: 'standalone' }) : vercel({ isr: { expiration: 3600, exclude: [/^\/admin/, /^\/api/] } }),
  // Behind nginx, Astro trusts X-Forwarded-For (the visitor's real IP, which
  // the newsletter rate limit needs) only for requests to these hosts.
  ...(onVps && {
    security: { allowedDomains: [{ hostname: 'bristolbrief.com' }, { hostname: 'www.bristolbrief.com' }] },
  }),
});
