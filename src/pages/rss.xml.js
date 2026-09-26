import rss from '@astrojs/rss';
import { storyItems } from '../lib/wire';
import { SITE } from '../site.config';

// Headlines from local sources; each item links to the original story.
export async function GET(context) {
  return rss({
    title: `${SITE.name}: Bristol County headlines`,
    description: SITE.description,
    site: context.site,
    items: storyItems()
      .slice(0, 100)
      .map((i) => ({
        title: i.title,
        description: i.summary ? `${i.summary} (${i.sourceName})` : i.sourceName,
        pubDate: new Date(i.date),
        link: new URL(i.link, context.site).toString(),
      })),
  });
}
