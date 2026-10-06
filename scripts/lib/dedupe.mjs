// Spot the same story told twice: headlines from different outlets share distinctive words.

export const titleKey = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const STOP = new Set('about after again against announces being between could county from have into over report reports says state their there these this those under what when where which while with would their local police city town'.split(' '));
export const sig = (t) => new Set(titleKey(t).split(' ').filter((w) => w.length >= 5 && !STOP.has(w)));
export const overlap = (a, b) => [...a].filter((w) => b.has(w)).length;
/** Same story from another outlet: two or more distinctive headline words in common. */
export const sameStory = (a, b) => overlap(a, b) >= 2;
