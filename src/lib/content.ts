import { getCollection, type CollectionEntry } from 'astro:content';

export type Story = CollectionEntry<'stories'>;
export type Event = CollectionEntry<'events'>;

export async function getStories(): Promise<Story[]> {
  const all = await getCollection('stories', ({ data }) => !data.draft);
  return all.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

export async function getUpcomingEvents(from = new Date()): Promise<Event[]> {
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  const all = await getCollection('events', ({ data }) => data.date >= start);
  return all.sort((a, b) => a.data.date.valueOf() - b.data.date.valueOf());
}

const TZ = 'America/New_York';

export const formatDate = (d: Date) =>
  d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' });

export const formatShortDate = (d: Date) =>
  d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });

export const todayLine = () =>
  new Date().toLocaleDateString('en-US', {
    timeZone: TZ,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

export const readingTime = (body = '') =>
  Math.max(1, Math.round(body.trim().split(/\s+/).length / 230));
