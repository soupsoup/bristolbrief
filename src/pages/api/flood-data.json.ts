import type { APIRoute } from 'astro';
import {
  extractBristolAlerts,
  extractNwpsForecast,
  extractNwpsObservations,
  extractUsgsObservations,
  findTauntonFloodWarning,
  TAUNTON_FLOOD_STAGE_FT,
  TAUNTON_NWPS_GAUGE_ID,
  TAUNTON_USGS_SITE_ID,
} from '../../lib/flood.mjs';

export const prerender = false;

const CACHE_HEADERS = {
  'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=900',
};

async function fetchJson(url: string, headers: Record<string, string> = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', ...headers },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Upstream returned ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

const usgsUrl = new URL('https://waterservices.usgs.gov/nwis/iv/');
usgsUrl.search = new URLSearchParams({
  format: 'json',
  sites: TAUNTON_USGS_SITE_ID,
  parameterCd: '00065',
  period: 'PT48H',
}).toString();

const nwpsUrl = `https://api.water.noaa.gov/nwps/v1/gauges/${TAUNTON_USGS_SITE_ID}/stageflow`;
const alertsUrl = 'https://api.weather.gov/alerts/active?area=MA';

export const GET: APIRoute = async () => {
  const [usgsResult, nwpsResult, alertsResult] = await Promise.allSettled([
    fetchJson(usgsUrl.toString()),
    fetchJson(nwpsUrl),
    fetchJson(alertsUrl, { 'User-Agent': 'Bristol Brief (https://bristolbrief.com)' }),
  ]);

  const errors: string[] = [];
  const usgsPayload = usgsResult.status === 'fulfilled' ? usgsResult.value : null;
  const nwpsPayload = nwpsResult.status === 'fulfilled' ? nwpsResult.value : null;
  const alertsPayload = alertsResult.status === 'fulfilled' ? alertsResult.value : null;
  if (!usgsPayload) errors.push('The USGS gauge feed is temporarily unavailable.');
  if (!nwpsPayload) errors.push('The NOAA forecast hydrograph is temporarily unavailable.');
  if (!alertsPayload) errors.push('The NWS active-alert feed is temporarily unavailable.');

  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  const recentUsgsObservations = extractUsgsObservations(usgsPayload)
    .filter((point) => Date.parse(point.time) >= cutoff);
  const recentNwpsObservations = extractNwpsObservations(nwpsPayload)
    .filter((point) => Date.parse(point.time) >= cutoff);
  if (usgsPayload && !recentUsgsObservations.length) {
    errors.push('No recent USGS observation was returned; NOAA NWPS readings are used when available.');
  }
  const observedSource = recentUsgsObservations.length ? 'USGS Water Services' : 'NOAA NWPS';
  const observations = recentUsgsObservations.length ? recentUsgsObservations : recentNwpsObservations;
  const forecastSeries = extractNwpsForecast(nwpsPayload);
  const forecast = forecastSeries.points.filter((point) => Date.parse(point.time) >= cutoff);
  const alerts = extractBristolAlerts(alertsPayload);
  const hasLiveData = observations.length > 0 || forecast.length > 0 || alerts.length > 0;

  const body = {
    checkedAt: new Date().toISOString(),
    gauge: {
      usgsSiteId: TAUNTON_USGS_SITE_ID,
      nwpsGaugeId: TAUNTON_NWPS_GAUGE_ID,
      name: 'Taunton River near Bridgewater',
      floodStageFt: TAUNTON_FLOOD_STAGE_FT,
      observedSource,
    },
    observations,
    latestObserved: observations.at(-1) ?? null,
    forecast,
    forecastIssuedAt: forecastSeries.issuedAt,
    alerts,
    tauntonWarning: findTauntonFloodWarning(alerts),
    errors,
  };

  if (!hasLiveData) {
    return Response.json(body, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }

  return Response.json(body, { headers: CACHE_HEADERS });
};
