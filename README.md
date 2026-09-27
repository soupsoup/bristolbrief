# The Bristol Brief

One front page for the 20 cities and towns of Bristol County, Massachusetts. The site gathers headlines from local newsrooms, police departments and town halls, plus meeting agendas, weather alerts, tides and commuter rail alerts. Every headline links to the original story. It's built with [Astro](https://astro.build) as a static site.

## Run it

```sh
npm install
npm run ingest   # fetch feeds and APIs, update src/data/*.json
npm run dev      # http://localhost:4321
npm run build    # outputs to dist/
npm test         # parser, town-matching and data tests
```

## Pages

- **Home:** top stories (featured by editors, or picked automatically), an "Around the county" rail, section rows, commuter rail alerts, tides, town hall notices and public meetings.
- **`/news/`:** every headline, filterable by town (including Countywide), type and source.
- **`/section/<slug>/`** and **`/towns/<slug>/`** for all 8 sections and 20 municipalities.
- **`/meetings/`**, **`/weather/`** (alerts and tides), **`/transit/`**, **`/sources/`**, plus About, Subscribe and Send a tip.
- **`/stories/<slug>/`:** stories written in the admin.
- **`/social/`:** every social post editors have added.
- **`/rss.xml`:** the headline feed, linking to the original stories.

## How the headlines work

- Sources live in `src/data/sources.json`. To add a feed, add an entry with `id`, `name`, `url` and `category` (`news`, `public-safety`, `government` or `meetings`).
- Only items that name one of the county's 20 cities and towns (or a village in one, like Assonet or North Dartmouth) make it onto the site. "South Coast" alone doesn't count. Stories that mention Bristol County but no town are kept with a "Countywide" label: they show in the headline list (and the Countywide filter on `/news/`) but on no town page. The exception is a town hall, police department or agenda feed: give it `"defaultTowns": ["slug"]` and all of its items are kept and filed under that town.
- `.github/workflows/ingest.yml` runs the ingest hourly and commits when headlines change, which triggers a redeploy on most hosts. Scheduled workflows only run on the default branch.
- Headlines appear on the home page, `/news/` (filter by town, type and source), each town page, `/meetings/`, `/weather/` and `/sources/`.
- The same run pulls MBTA commuter rail alerts for Bristol County stations (`/transit/`, refreshed live in the browser), NOAA tide predictions for four harbors (`/weather/#tides`) and Taunton's CivicClerk meeting calendar (`/meetings/`). To add another CivicClerk town, add its tenant to `CIVICCLERK` in `scripts/ingest.mjs`.
- `docs/sources.md` has the research notes: which feeds work, which need scrapers, and data APIs to add next.

## Admin

`/admin/` is a password-protected back end for editors:

- **Stories:** everything the feeds pulled in plus stories added by hand, searchable and filterable by source, type, status, town and time (last 1, 3, 6 or 12 hours).
- **Edit** a headline or summary, add sections and towns, attach a photo with a caption, or hide an item from the site. A field left at the feed's value keeps updating from the feed.
- **Feature** stories on the home page: pick the **lead**, the **second** and **third** stories under it, or add stories to the **top of the rail** ("Around the county"). Each pick lasts one hour, then the freshest news takes over; set "Keep featured until" on a story's edit page to hold it longer. Empty slots always get the freshest story automatically.
- **Add a story** to one or more sections and towns. Give it a link to another site, or write the text and it gets its own page at `/stories/<slug>/`.
- **Photos** are resized in the browser to 1600px, then saved to `public/uploads/`.
- **Social:** the hourly job scans Bluesky (full-text search) and Mastodon (town hashtags on mastodon.social) for posts from the last week that mention a Bristol County town, and lists them for review. Filter by platform, town, text or time (last 1, 3, 6 or 12 hours); **Approve** a post to publish it, **Dismiss** it, or **Mute** an account (such as a busy bot) to hide its posts. You can also paste a link to any X, Bluesky or Mastodon post. The home page's "On social" column shows the most recently approved post; `/social/` shows all of them. Tag towns to also show a post on those town pages.
- **Feeds** shows how each source did on the last headline update.

Every save is a commit to `src/data/editorial.json` (or a photo under `public/uploads/`) on GitHub, so Vercel redeploys and the change is live in about a minute. The git history is the edit log, and any change can be reverted there. The hourly headline job never touches `editorial.json`.

### Setup (once)

1. **Create a GitHub token:** GitHub → Settings → Developer settings → Fine-grained tokens → Generate. Give it access to `soupsoup/bristolbrief` only, with **Contents: Read and write**.
2. **Add environment variables** in the Vercel project (Settings → Environment Variables, Production):
   - `ADMIN_PASSWORD`: the admin password. Use a long one; anyone who has it can edit the site.
   - `ADMIN_GITHUB_TOKEN`: the token from step 1.
   - Optional: `ADMIN_SESSION_SECRET` to sign sessions with a separate secret (otherwise one is derived from the password; changing either signs everyone out).
3. **Redeploy**, then sign in at `/admin/`.

Without `ADMIN_PASSWORD` the admin is switched off. Without `ADMIN_GITHUB_TOKEN` (for example under `npm run dev`) it saves to local files instead of GitHub; set `ADMIN_PASSWORD` in `.env` to try it locally.

`npm run pin -- "headline text" [--slot lead|second|third|rail] [--hours N]` features a story from the command line.

The hourly headline job commits and triggers a rebuild every hour, so expired picks give way to fresh news at the first hourly update after they expire.

## Deploying on Vercel

1. Go to [vercel.com/new](https://vercel.com/new), import `soupsoup/bristolbrief`, and deploy. `vercel.json` sets the build; no settings need changing.
2. In the project's **Settings → Git**, set the production branch to the branch you want live (the default branch, once this work is merged). Other branches get preview URLs.
3. Every push deploys automatically, including the hourly headline commits from `.github/workflows/ingest.yml`.
4. When you add a custom domain, set a `SITE_URL` environment variable (for example `https://bristolbrief.com`) so canonical links and the RSS feed use it. Until then they use the Vercel production URL.

## Before launch

1. **Connect the newsletter.** Set `newsletterAction` in `src/site.config.ts` to your provider's form endpoint (beehiiv, Buttondown, Ghost, Mailchimp). Until then the form shows a "sign-ups open soon" message.
2. **Set the domain** with the `SITE_URL` environment variable, and the contact email and social links in `src/site.config.ts`.
3. **Merge to the default branch** so the hourly GitHub Actions job can run.

## Where things live

| Path | Purpose |
| --- | --- |
| `src/site.config.ts` | Site name, sections, towns, newsletter endpoint, contact info |
| `src/data/sources.json` | Feed registry |
| `src/data/*.json` | Ingested headlines, alerts, transit, tides, meetings, feed status |
| `src/data/editorial.json` | Admin edits, featured order, manual stories |
| `src/pages/admin/`, `src/pages/api/admin/`, `src/lib/admin/` | Admin pages, API and storage |
| `scripts/ingest.mjs`, `scripts/lib/` | Fetching, parsing, town tagging |
| `src/pages/` | Routes |
| `src/components/` | Header, footer, headline cards and lists, alerts, tides, meetings |
| `src/styles/global.css` | Colors, type and shared styles |
| `docs/sources.md` | Source research notes |
