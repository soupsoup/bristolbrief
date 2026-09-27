import wireData from '../data/wire.json';
import alertsData from '../data/alerts.json';
import sourcesData from '../data/sources.json';
import statusData from '../data/feed-status.json';
import editorialData from '../data/editorial.json';
import { applyEditorial, featuredItems } from '../../scripts/lib/editorial.mjs';

export interface WireItem {
  id: string;
  title: string;
  link: string;
  summary: string;
  date: string;
  source: string;
  sourceName: string;
  category: 'news' | 'government' | 'public-safety' | 'meetings';
  section: string;
  towns: string[];
  /** Names Bristol County but no specific town. Shown in the wire, not on town pages. */
  countywide?: boolean;
  /** All sections the item appears in; `section` is the first. Editors can add more. */
  sections: string[];
  /** Photo added in the admin (path under /uploads/). */
  image?: string;
  imageAlt?: string;
  /** Editor's pick: 0 lead, 1 second, 2 third, 3+ top of the rail. */
  featuredRank?: number;
  featuredSlot?: 'lead' | 'second' | 'third' | 'rail';
  /** Story added by hand in the admin rather than pulled from a feed. */
  manual?: boolean;
  /** Manual stories: URL slug and body, when the story has its own page here. */
  slug?: string;
  body?: string;
  external?: boolean;
  /** Admin views only. */
  hidden?: boolean;
  edited?: boolean;
  originalTitle?: string;
}

export interface Alert {
  id: string;
  event: string;
  headline: string;
  severity: string;
  areas: string;
  effective: string;
  expires: string | null;
  description: string;
  instruction: string;
  link: string;
}

export interface Source {
  id: string;
  name: string;
  url: string;
  homepage?: string;
  category: string;
  via?: string;
  note?: string;
  enabled: boolean;
}

export interface SourceStatus {
  id: string;
  ok: boolean;
  entries?: number;
  kept?: number;
  newest?: string | null;
  error?: string;
  checkedAt: string;
}

export const wireUpdated: string | null = wireData.updated;
/** Raw feed items, before editorial changes (the admin shows these). */
export const rawWireItems = (wireData.items ?? []) as Omit<WireItem, 'sections'>[];
/** Feed items plus manual stories, with editors' changes applied and hidden items removed. */
export const wireItems = applyEditorial(rawWireItems, editorialData) as WireItem[];
export const sources = (sourcesData.sources ?? []) as Source[];
export const sourceStatus = (statusData.sources ?? []) as SourceStatus[];

/** Alerts that haven't expired yet at build time. */
export function activeAlerts(now = new Date()): Alert[] {
  const alerts = (alertsData.alerts ?? []) as Alert[];
  const seen = new Set<string>();
  return alerts
    .filter((a) => !a.expires || new Date(a.expires) > now)
    .filter((a) => (seen.has(a.event) ? false : (seen.add(a.event), true)));
}

export const newsItems = () => wireItems.filter((i) => i.category !== 'meetings');
export const meetingItems = () => wireItems.filter((i) => i.category === 'meetings');
export const itemsForTown = (town: string) => wireItems.filter((i) => i.towns.includes(town));
export const itemsForSection = (section: string) =>
  wireItems.filter((i) => i.category !== 'meetings' && i.sections.includes(section));
/** Stories an editor featured, in priority order (first is the lead). */
export const featuredStories = () => featuredItems(wireItems) as WireItem[];
/** Manual stories that have their own page on this site. */
export const localStories = () => wireItems.filter((i) => i.manual && !i.external);

export function timeAgo(iso: string, now = new Date()) {
  const mins = Math.round((now.valueOf() - new Date(iso).valueOf()) / 60000);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });
}

import transitData from '../data/transit.json';
import tidesData from '../data/tides.json';
import calendarData from '../data/calendar.json';

export interface TransitAlert {
  id: string;
  header: string;
  effect: string;
  severity: number;
  lifecycle: string;
  start: string;
  end: string | null;
  routes: string[];
  stations: string[];
  towns: string[];
  url: string | null;
}

export interface TideStation {
  id: string;
  name: string;
  towns: string[];
  predictions: { time: string; local: string; height: number; type: 'high' | 'low' }[];
  observed: { time: string; height: number } | null;
}

export interface Meeting {
  id: string;
  title: string;
  body: string;
  start: string;
  location: string;
  town: string;
  link: string;
  hasAgenda: boolean;
}

export const transitUpdated: string | null = transitData.updated;
export const transitStopParents = (transitData.stopParents ?? {}) as Record<string, string>;
export const transitAlerts = (now = new Date()) =>
  ((transitData.alerts ?? []) as TransitAlert[]).filter((a) => !a.end || new Date(a.end) > now);

export const tideStations = (tidesData.stations ?? []) as TideStation[];
export const tidesUpdated: string | null = tidesData.updated;

/** Upcoming tides from `now`, for one station. */
export const nextTides = (station: TideStation, count = 4, now = new Date()) =>
  station.predictions.filter((p) => new Date(p.time) > now).slice(0, count);

export const upcomingMeetings = (now = new Date()) => {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return ((calendarData.meetings ?? []) as Meeting[]).filter((m) => new Date(m.start) >= start);
};

const ET = 'America/New_York';
export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { timeZone: ET, hour: 'numeric', minute: '2-digit' });
export const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { timeZone: ET, weekday: 'short', month: 'short', day: 'numeric' });

export const todayLine = () =>
  new Date().toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

/** Stories from newsrooms and police/prosecutors (not town-hall notices or agendas). */
export const storyItems = () => wireItems.filter((i) => i.category === 'news' || i.category === 'public-safety');

/**
 * Pick `n` top stories for the front page: recent items with a real summary,
 * at most one per source so a single outlet can't fill the top of the page.
 */
export function pickTopStories(items: WireItem[], n: number, now = new Date(), exclude: WireItem[] = []) {
  const recent = items.filter((i) => now.valueOf() - new Date(i.date).valueOf() < 3 * 864e5);
  // A real summary, not a fragment like "are in full swing."
  const pool = (recent.length >= n ? recent : items).filter((i) => i.summary.length >= 80);
  const picked: WireItem[] = [];
  const skip = new Set(exclude.map((i) => i.id));
  const sources = new Set<string>(exclude.map((i) => i.source));
  for (const item of pool) {
    if (skip.has(item.id) || sources.has(item.source)) continue;
    picked.push(item);
    sources.add(item.source);
    if (picked.length === n) break;
  }
  return picked;
}


export interface SocialPost {
  id: string;
  platform: 'x' | 'bluesky' | 'link';
  url: string;
  text: string;
  authorName?: string;
  handle?: string;
  postedLabel?: string;
  uri?: string;
  cid?: string;
  towns?: string[];
  addedAt: string;
}

/** Social posts editors added, in their chosen order (newest first by default). */
export const socialPosts = () => ((editorialData as { social?: SocialPost[] }).social ?? []) as SocialPost[];
export const socialForTown = (town: string) => socialPosts().filter((p) => p.towns?.includes(town));
