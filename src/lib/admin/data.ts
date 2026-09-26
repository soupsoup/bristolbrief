// Data for admin pages: the feed items baked into this deploy, with the
// latest editorial changes read fresh from storage.
import { readEditorial } from './store';
import { rawWireItems, type WireItem } from '../wire';
import { applyEditorial, featuredItems } from '../../../scripts/lib/editorial.mjs';

export async function loadAdminData() {
  const { doc } = await readEditorial();
  const items = applyEditorial(rawWireItems, doc, { includeHidden: true }) as WireItem[];
  const featured = featuredItems(items) as WireItem[];
  const until = new Map<string, string | undefined>(doc.featured.map((f: any) => [f.id, f.until]));
  return { doc, items, featured, until };
}

export const fmtAdminDate = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
