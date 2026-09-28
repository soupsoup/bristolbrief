export const TAUNTON_USGS_SITE_ID = '01108000';
export const TAUNTON_NWPS_GAUGE_ID = 'BDGM3';
export const TAUNTON_FLOOD_STAGE_FT = 8;

const BRISTOL_ZONE_IDS = new Set(['MAC005', 'MAZ017', 'MAZ020']);

function validStage(value) {
  if (value === null || value === undefined || String(value).trim() === '') return false;
  const stage = Number(value);
  return Number.isFinite(stage) && stage > -9000 && stage < 1000;
}

export function extractUsgsObservations(payload) {
  const series = payload?.value?.timeSeries ?? [];
  const points = series.flatMap((timeSeries) => {
    const siteId = timeSeries.sourceInfo?.siteCode?.find((site) => site.agencyCode === 'USGS')?.value;
    const parameter = timeSeries.variable?.variableCode?.[0]?.value;
    if (siteId !== TAUNTON_USGS_SITE_ID || parameter !== '00065') return [];

    return (timeSeries.values ?? []).flatMap((valueSet) => valueSet.value ?? []).flatMap((reading) => {
      if (!validStage(reading.value) || !reading.dateTime) return [];
      const timestamp = Date.parse(reading.dateTime);
      if (!Number.isFinite(timestamp)) return [];
      return [{ time: new Date(timestamp).toISOString(), stage: Number(reading.value) }];
    });
  });

  return points.sort((left, right) => Date.parse(left.time) - Date.parse(right.time));
}

export function extractNwpsForecast(payload) {
  const series = payload?.forecast;
  const points = (series?.data ?? []).flatMap((point) => {
    if (!validStage(point.primary) || !point.validTime) return [];
    const timestamp = Date.parse(point.validTime);
    if (!Number.isFinite(timestamp)) return [];
    return [{ time: new Date(timestamp).toISOString(), stage: Number(point.primary) }];
  }).sort((left, right) => Date.parse(left.time) - Date.parse(right.time));

  return {
    issuedAt: series?.issuedTime ?? null,
    points,
  };
}

export function extractNwpsObservations(payload) {
  const series = payload?.observed;
  return (series?.data ?? []).flatMap((point) => {
    if (!validStage(point.primary) || !point.validTime) return [];
    const timestamp = Date.parse(point.validTime);
    if (!Number.isFinite(timestamp)) return [];
    return [{ time: new Date(timestamp).toISOString(), stage: Number(point.primary) }];
  }).sort((left, right) => Date.parse(left.time) - Date.parse(right.time));
}

export function parseNwsFloodDetails(description = '') {
  const lines = String(description).split(/\r?\n/);
  const extractBlock = (label) => {
    const start = lines.findIndex((line) => new RegExp(`^\\s*[-*]?\\s*${label}\\s*(?:\\.{2,}|:)`, 'i').test(line));
    if (start < 0) return '';
    const first = lines[start].replace(new RegExp(`^\\s*[-*]?\\s*${label}\\s*(?:\\.{2,}|:)\\s*`, 'i'), '').trim();
    const block = [first];
    for (let index = start + 1; index < lines.length; index += 1) {
      if (/^\s*[-*]\s+/.test(lines[index])) break;
      if (lines[index].trim()) block.push(lines[index].trim());
    }
    return block.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  };

  const forecastText = extractBlock('Forecast');
  const impactsText = extractBlock('IMPACTS');
  const observation = lines.map((line) => line.match(/At\s+(.+?)\s+the stage was\s+([\d.]+)\s+feet/i)).find(Boolean);
  const crest = forecastText.match(/crest\s+(?:of|at)\s+([\d.]+)\s+(?:feet|ft)(?:\s+([^.;]+))?/i);

  return {
    forecastText,
    impactsText,
    reportedStage: observation ? Number(observation[2]) : null,
    reportedStageText: observation ? observation[0].trim() : '',
    crestStage: crest ? Number(crest[1]) : null,
    crestTiming: crest?.[2]?.trim() ?? '',
  };
}

export function isRelevantBristolAlert(feature) {
  const properties = feature?.properties ?? feature ?? {};
  const zoneIds = (properties.affectedZones ?? []).map((zone) => String(zone).split('/').at(-1));
  const area = `${properties.areaDesc ?? ''} ${properties.headline ?? ''} ${properties.description ?? ''}`;
  return zoneIds.some((zone) => BRISTOL_ZONE_IDS.has(zone)) || /\bBristol(?: County|,? MA)?\b/i.test(area);
}

export function extractBristolAlerts(payload) {
  return (payload?.features ?? [])
    .filter(isRelevantBristolAlert)
    .map((feature) => {
      const properties = feature.properties ?? {};
      const details = parseNwsFloodDetails(properties.description);
      return {
        id: feature.id ?? properties.id ?? '',
        event: properties.event ?? 'Weather alert',
        headline: properties.headline ?? '',
        area: properties.areaDesc ?? '',
        sent: properties.sent ?? properties.effective ?? null,
        expires: properties.expires ?? properties.ends ?? null,
        ends: properties.ends ?? null,
        description: properties.description ?? '',
        ...details,
      };
    })
    .sort((left, right) => Date.parse(right.sent ?? '') - Date.parse(left.sent ?? ''));
}

export function findTauntonFloodWarning(alerts) {
  return alerts.find((alert) => /flood warning/i.test(alert.event) && /taunton river/i.test(`${alert.headline} ${alert.description}`)) ?? null;
}
