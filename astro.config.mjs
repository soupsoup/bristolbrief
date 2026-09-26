// @ts-check
import { defineConfig } from 'astro/config';

// Canonical URLs, Open Graph tags and the RSS feed use this address.
// Set SITE_URL once you have a custom domain; until then Vercel's
// production URL is used when building there.
const site =
  process.env.SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'https://bristolbrief.com');

export default defineConfig({ site });
