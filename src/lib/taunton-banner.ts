type BannerData = {
  latestObserved: { stage: number } | null;
  tauntonWarning: { ends: string | null; expires: string | null } | null;
};

const banner = document.querySelector<HTMLElement>('[data-taunton-banner]');
const summary = banner?.querySelector<HTMLElement>('[data-banner-summary]');

async function updateTauntonBanner() {
  if (!banner || !summary) return;
  try {
    const response = await fetch('/api/flood-data.json');
    if (!response.ok) return;
    const data = await response.json() as BannerData;
    const warning = data.tauntonWarning;
    const endsAt = Date.parse(warning?.ends ?? warning?.expires ?? '');
    if (!warning || (Number.isFinite(endsAt) && endsAt < Date.now())) return;

    const stage = data.latestObserved?.stage;
    summary.textContent = typeof stage === 'number' && Number.isFinite(stage)
      ? `River at ${stage.toFixed(2)} ft · Flood stage 8.0 ft`
      : 'NWS Flood Warning remains in effect';
    banner.hidden = false;
  } catch {
    banner.hidden = true;
  }
}

updateTauntonBanner();
window.setInterval(updateTauntonBanner, 5 * 60 * 1000);
