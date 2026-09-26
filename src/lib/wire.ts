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
