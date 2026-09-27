export const SITE = {
  name: 'The Bristol Brief',
  tagline: 'Local news for Bristol County, Massachusetts',
  description:
    'Local headlines, public meetings, weather and transit alerts for the 20 cities and towns of Bristol County, Massachusetts, gathered from local newsrooms and town halls.',
  email: 'tips@bristolbrief.com',
  // Point this at your newsletter provider's subscribe endpoint
  // (beehiiv, Buttondown, Ghost, Mailchimp, etc.). Leave empty to show a
  // "coming soon" message instead of submitting.
  newsletterAction: '',
  social: {
    discord: 'https://discord.gg/VPTjAAmvWB',
    instagram: 'https://instagram.com/',
    facebook: 'https://facebook.com/',
  },
};

export const SECTIONS = [
  { slug: 'news', name: 'News' },
  { slug: 'government', name: 'Government' },
  { slug: 'schools', name: 'Schools' },
  { slug: 'public-safety', name: 'Public Safety' },
  { slug: 'real-estate', name: 'Real Estate' },
  { slug: 'food-drink', name: 'Food & Drink' },
  { slug: 'business', name: 'Business' },
  { slug: 'things-to-do', name: 'Things to Do' },
  // Homes and land for sale or rent. Kept out of the news lists.
  { slug: 'listings', name: 'Listings' },
] as const;

export type SectionSlug = (typeof SECTIONS)[number]['slug'];

// All 20 municipalities in Bristol County, MA.
export const TOWNS = [
  { slug: 'acushnet', name: 'Acushnet' },
  { slug: 'attleboro', name: 'Attleboro' },
  { slug: 'berkley', name: 'Berkley' },
  { slug: 'dartmouth', name: 'Dartmouth' },
  { slug: 'dighton', name: 'Dighton' },
  { slug: 'easton', name: 'Easton' },
  { slug: 'fairhaven', name: 'Fairhaven' },
  { slug: 'fall-river', name: 'Fall River' },
  { slug: 'freetown', name: 'Freetown' },
  { slug: 'mansfield', name: 'Mansfield' },
  { slug: 'new-bedford', name: 'New Bedford' },
  { slug: 'north-attleborough', name: 'North Attleborough' },
  { slug: 'norton', name: 'Norton' },
  { slug: 'raynham', name: 'Raynham' },
  { slug: 'rehoboth', name: 'Rehoboth' },
  { slug: 'seekonk', name: 'Seekonk' },
  { slug: 'somerset', name: 'Somerset' },
  { slug: 'swansea', name: 'Swansea' },
  { slug: 'taunton', name: 'Taunton' },
  { slug: 'westport', name: 'Westport' },
] as const;

export type TownSlug = (typeof TOWNS)[number]['slug'];

export const sectionName = (slug: string) =>
  SECTIONS.find((s) => s.slug === slug)?.name ?? slug;
export const townName = (slug: string) =>
  TOWNS.find((t) => t.slug === slug)?.name ?? slug;
