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
- **`/election/`:** the Nov. 3, 2026 Election Day page: polling places, who is running, the statewide ballot questions and unofficial results.
- **`/rss.xml`:** the headline feed, linking to the original stories.

## How the headlines work

- Sources live in `src/data/sources.json`. To add a feed, add an entry with `id`, `name`, `url` and `category` (`news`, `public-safety`, `government` or `meetings`).
- Only items that name one of the county's 20 cities and towns (or a village in one, like Assonet or North Dartmouth) make it onto the site. "South Coast" alone doesn't count. Stories that mention Bristol County but no town are kept with a "Countywide" label: they show in the headline list (and the Countywide filter on `/news/`) but on no town page. The exception is a town hall, police department or agenda feed: give it `"defaultTowns": ["slug"]` and all of its items are kept and filed under that town.
- `.github/workflows/ingest.yml` runs the ingest and publishes the result to the `data` branch (a single commit that is replaced each run). Vercel does not build that branch, so the hourly data never costs a deploy. Scheduled workflows only run on the default branch.
- **How the site gets fresh data:** every public page renders on demand (`output: 'server'` with ISR, one-hour cache). A middleware calls `loadData()` in `src/lib/data-source.ts`, which reads the live JSON files from `raw.githubusercontent.com/.../data/src/data` (at most once a minute per server instance) and falls back to the copies bundled with the last deploy if GitHub cannot be reached. Set `DATA_BASE_URL` to read from somewhere else. Only code, `editorial.json`, `sources.json`, `election.json` and other hand-edited files trigger Vercel builds; the files under `src/data` on `main` are just the starting copy and fallback.
- Headlines appear on the home page, `/news/` (filter by town, type and source), each town page, `/meetings/`, `/weather/` and `/sources/`.
- The same run pulls MBTA commuter rail alerts for Bristol County stations (`/transit/`, refreshed live in the browser), NOAA tide predictions for four harbors (`/weather/#tides`) and Taunton's CivicClerk meeting calendar (`/meetings/`). To add another CivicClerk town, add its tenant to `CIVICCLERK` in `scripts/ingest.mjs`.
- **`/tools/`:** the AI tools with the most votes on Product Hunt over the past two weeks. The ingest asks Product Hunt's public MCP server (`https://mcp.producthunt.com/mcp`, `get_leaderboard` tool, no sign-in) for yesterday's, this week's and last week's leaderboards, keeps the AI products (an AI category, or AI words in the name, tagline or description) with the most votes, and saves them to `src/data/producthunt.json` (see `scripts/lib/producthunt.mjs`). If Product Hunt can't be reached the previous list stays.
- `docs/sources.md` has the research notes: which feeds work, which need scrapers, and data APIs to add next.

## Election Day page

`src/data/election.json` holds the ballot as the Secretary of the Commonwealth published it (candidates for races that include Bristol County, the nine statewide questions, polling place changes), with the source pages listed in the file. Edit it by hand if the state corrects a listing.

`src/data/election-results.json` is written by `scripts/ingest.mjs` (via `scripts/lib/election.mjs`). From 8 p.m. ET on Nov. 3 until Nov. 10 every ingest asks the state's results site (electionstats.state.ma.us) for the general election and saves statewide, Bristol County and district results. The scheduler runs the ingest at :05 and :35, so results refresh every 30 minutes on the `data` branch; pages pick them up within an hour. Before the state publishes anything, or outside that window, the file is left alone. To try it against a past election: `ELECTION_FORCE=1 ELECTION_DATE=2026-09-01 ELECTION_PRIMARY=Democratic npm run ingest`.

## Admin

`/admin/` is a password-protected back end for editors:

- **Stories:** everything the feeds pulled in plus stories added by hand, searchable and filterable by source, type, status, town and time (last 1, 3, 6 or 12 hours).
- **Edit** a headline or summary, add sections and towns, attach a photo with a caption, or hide an item from the site. A field left at the feed's value keeps updating from the feed.
- **Feature** stories on the home page: pick the **lead**, the **second** and **third** stories under it, or add stories to the **top of the rail** ("Around the county"). Each pick lasts one hour, then the freshest news takes over; set "Keep featured until" on a story's edit page to hold it longer. Empty slots always get the freshest story automatically.
- **Add a story** to one or more sections and towns. Give it a link to another site, or write the text and it gets its own page at `/stories/<slug>/`.
- Story date/time inputs use `America/New_York` and are stored as UTC instants, so EDT/EST changes are automatic.
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

Pages are re-rendered at least hourly, so expired picks give way to fresh news within the hour after they expire.

## Deploying on the VPS

The site runs on the VPS behind nginx, rebuilt automatically whenever `main` changes (code and admin saves; the hourly data goes to the `data` branch and is read at runtime, so it never triggers a build). `deploy/vps/SETUP.md` has the install, cutover and rollback steps. Build for it with `DEPLOY_TARGET=node npm run build`; without that variable the build targets Vercel, as below.

## Deploying on Vercel

1. Go to [vercel.com/new](https://vercel.com/new), import `soupsoup/bristolbrief`, and deploy. `vercel.json` sets the build; no settings need changing.
2. In the project's **Settings → Git**, set the production branch to the branch you want live (the default branch, once this work is merged). Other branches get preview URLs.
3. Every push to `main` deploys automatically. The hourly data from `.github/workflows/ingest.yml` goes to the `data` branch, which `vercel.json` excludes from deployments.
4. When you add a custom domain, set a `SITE_URL` environment variable (for example `https://bristolbrief.com`) so canonical links and the RSS feed use it. Until then they use the Vercel production URL.

## Before launch

1. **Connect the newsletter.** Add `MAILERLITE_API_KEY` and `MAILERLITE_GROUP_ID` as Vercel environment variables (see `src/lib/newsletter.ts`). Until then the form shows a "sign-ups open soon" message.
2. **Set the domain** with the `SITE_URL` environment variable, and the contact email and social links in `src/site.config.ts`.
3. **Merge to the default branch** so the hourly GitHub Actions job can run.

## Weekly newsletter

`node scripts/newsletter.mjs --weekly --ref origin/data` builds the weekly edition as `newsletter-draft/weekly-<date>.html` and `.txt`: a story of the week, the next eight biggest stories (ranked by how many outlets ran them), the week's high school scores, and the public meetings for the coming seven days. Run it on the day you send. The window is always the last seven days, so the weekday only affects the "week ahead" list. Use `--ref origin/main` until the `data` branch exists.

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
