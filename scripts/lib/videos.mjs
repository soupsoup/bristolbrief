// Videos from TV newsrooms' YouTube channels. Every channel publishes a public
// feed of its latest 15 uploads (https://www.youtube.com/feeds/videos.xml?channel_id=...),
// so the hourly ingest collects what it sees and keeps a week. These channels cover
// all of New England, so what is kept depends on the channel's scope:
//   region  stations built around Rhode Island and Southeastern Massachusetts
//           (WPRI, NBC 10 WJAR): every video is kept;
//   boston  Boston stations: a video is kept only when it is about Bristol County.
// Either way a video about Bristol County is marked local, from the same town
// matching as the headlines.
import { XMLParser } from 'fast-xml-parser';
import { matchTowns, mentionsBristolCountyMA, mentionsRegion, isDartmouthCollege } from './parse.mjs';

export const VIDEO_KEEP_DAYS = 7;
const ET = 'America/New_York';
const xml = new XMLParser({ ignoreAttributes: false, processEntities: true });

export const feedUrl = (channelId) => `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;

/** A YouTube channel feed's entries: id, title, link, published, description, thumbnail. */
export function parseYouTubeFeed(text) {
  const feed = xml.parse(text)?.feed;
  return [].concat(feed?.entry ?? []).map((e) => {
    const media = e['media:group'] ?? {};
    const id = String(e['yt:videoId'] ?? '');
    const href = [].concat(e.link ?? []).find((l) => l?.['@_rel'] === 'alternate')?.['@_href'] ?? `https://www.youtube.com/watch?v=${id}`;
    return {
      id,
      title: String(e.title ?? '').trim(),
      link: href,
      published: e.published ? new Date(e.published).toISOString() : '',
      description: String(media['media:description'] ?? ''),
      // 16:9 thumbnail; the feed's own is the 4:3 hqdefault with black bars.
      thumbnail: id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : '',
    };
  });
}

// Channels end every description with a paragraph about the station that names
// the towns it covers, which would tag every video with those towns.
const BOILERPLATE = /^-{3,}|follow us|like us|subscribe|our homepage|download our app|submit a tip|is (?:southern new england|boston|new england|rhode island)['’]?s?\b/i;

/** The part of a description that is about the video: up to the divider or the station blurb. */
export function descriptionBody(description = '') {
  const paras = description.replace(/\r/g, '').split(/\n\s*\n/);
  const cut = paras.findIndex((p) => BOILERPLATE.test(p.trim()));
  return (cut < 0 ? paras : paras.slice(0, cut)).join('\n').trim();
}

export const isWeather = (title = '') => /\bweather\b|\bforecast\b/i.test(title);

/** Bristol County towns (and region) a video is about, from its title, else the body of its description. */
export function videoPlaces({ title, description }) {
  const body = descriptionBody(description).slice(0, 800);
  const text = `${title} ${body}`;
  const found = matchTowns(title).length ? matchTowns(title) : matchTowns(body);
  const towns = found.filter((t) => !(t === 'dartmouth' && isDartmouthCollege(text)));
  const countywide = !towns.length && (mentionsBristolCountyMA(text) || mentionsRegion(text));
  return { towns, countywide };
}

/**
 * Shape a channel's videos for the site: all of them for a region channel, only the
 * Bristol County ones for a Boston channel. Future-dated entries are dropped.
 */
export function normalizeVideos(entries, channel, now = new Date()) {
  const out = [];
  for (const e of entries) {
    if (!e.id || !e.title || !e.published || new Date(e.published) > now) continue;
    const { towns, countywide } = videoPlaces(e);
    const local = towns.length > 0 || countywide;
    if (!local && channel.scope !== 'region') continue;
    out.push({
      id: e.id,
      title: e.title,
      link: e.link,
      published: e.published,
      channel: channel.id,
      channelName: channel.name,
      thumbnail: e.thumbnail,
      towns,
      ...(local && { local: true }),
      ...(countywide && { countywide: true }),
      ...(isWeather(e.title) && { weather: true }),
      ...(/\/shorts\//.test(e.link) && { short: true }),
    });
  }
  return out;
}

const etDay = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: ET });

/**
 * Merge new videos into the stored list: dedupe by id, drop channels no longer
 * configured and anything older than a week, newest first. Stations post several
 * forecasts a day, so only the newest weather video per channel per day stays.
 */
export function mergeVideos(existing, incoming, { channelIds, now = new Date() } = {}) {
  const cutoff = now.valueOf() - VIDEO_KEEP_DAYS * 864e5;
  const byId = new Map();
  for (const v of [...existing, ...incoming]) {
    if (channelIds && !channelIds.has(v.channel)) continue;
    if (Date.parse(v.published) < cutoff || Date.parse(v.published) > now.valueOf()) continue;
    byId.set(v.id, { ...byId.get(v.id), ...v });
  }
  const sorted = [...byId.values()].sort((a, b) => b.published.localeCompare(a.published));
  const seenWeather = new Set();
  return sorted.filter((v) => {
    if (!v.weather) return true;
    const key = `${v.channel}|${etDay(v.published)}`;
    if (seenWeather.has(key)) return false;
    seenWeather.add(key);
    return true;
  });
}

/** Videos published in the last `hours` hours, newest first. */
export const recentVideos = (videos, { now = new Date(), hours = 24 } = {}) =>
  videos.filter((v) => now.valueOf() - Date.parse(v.published) <= hours * 3600e3 && Date.parse(v.published) <= now.valueOf());

// Does the headline itself name a Bristol County town or the county? Videos that only
// mention one in the description ("a UMass Dartmouth player") are about Bristol County
// less clearly.
const titleNamesCounty = (v) => {
  const towns = matchTowns(v.title).filter((t) => !(t === 'dartmouth' && isDartmouthCollege(v.title)));
  return towns.length > 0 || mentionsBristolCountyMA(v.title) || mentionsRegion(v.title);
};

/**
 * The video to feature on the home page. A Bristol County video always wins when one
 * exists: the newest whose headline names a town or the county, else the newest that
 * is about the county in its description. With none, the newest video of any kind.
 * All come from the stored week, and weather forecasts are never picked (they match
 * on "Southeastern Mass" but are not a story). Returns undefined when nothing qualifies.
 */
export function featuredVideo(videos, { now = new Date() } = {}) {
  const candidates = videos
    .filter((v) => !v.weather && Date.parse(v.published) <= now.valueOf())
    .sort((a, b) => b.published.localeCompare(a.published));
  const local = candidates.filter((v) => v.local);
  return local.find(titleNamesCounty) ?? local[0] ?? candidates[0];
}
