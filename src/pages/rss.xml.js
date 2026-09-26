import rss from '@astrojs/rss';
import { getStories } from '../lib/content';
import { SITE } from '../site.config';

export async function GET(context) {
  const stories = await getStories();
  return rss({
    title: SITE.name,
    description: SITE.description,
    site: context.site,
    items: stories.map((s) => ({
      title: s.data.title,
      description: s.data.dek,
      pubDate: s.data.date,
      author: s.data.author,
      link: `/stories/${s.id}/`,
    })),
  });
}
