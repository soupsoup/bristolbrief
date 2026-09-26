import wireData from '../data/wire.json';
import alertsData from '../data/alerts.json';
import sourcesData from '../data/sources.json';
import statusData from '../data/feed-status.json';

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
export const wireItems = (wireData.items ?? []) as WireItem[];
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
