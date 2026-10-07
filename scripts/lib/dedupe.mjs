// Spot the same story told twice: headlines from different outlets share distinctive words.

export const titleKey = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const STOP = new Set('about after again against announces being between could county from have into over report reports says state their there these this those under what when where which while with would their local police city town'.split(' '));
export const sig = (t) => new Set(titleKey(t).split(' ').filter((w) => w.length >= 5 && !STOP.has(w)));
export const overlap = (a, b) => [...a].filter((w) => b.has(w)).length;
/** Same story from another outlet: two or more distinctive headline words in common. */
export const sameStory = (a, b) => overlap(a, b) >= 2;

/** Headlines can differ while the story is the same: same town and four or more distinctive words across headline and summary. */
export const bodySig = (i) => sig(`${i.title} ${(i.summary ?? '').slice(0, 240)}`);
export const sameIncident = (a, b) => a.towns.some((t) => b.towns.includes(t)) && overlap(a.body, b.body) >= 4;

/** What to compare for an item: headline words, headline plus summary words, and towns. */
export const storyKey = (i) => ({ sig: sig(i.title), body: bodySig(i), towns: i.towns ?? [] });
export const sameEvent = (a, b) => sameStory(a.sig, b.sig) || sameIncident(a, b);

/** Remembers the stories already placed so a page can skip another outlet's version of any of them. */
export function storyTracker(items = []) {
  const keys = items.map(storyKey);
  return {
    has: (item) => {
      const k = storyKey(item);
      return keys.some((x) => sameEvent(x, k));
    },
    add: (item) => void keys.push(storyKey(item)),
  };
}
