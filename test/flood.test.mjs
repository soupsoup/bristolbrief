import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractBristolAlerts,
  extractNwpsForecast,
  extractNwpsObservations,
  extractUsgsObservations,
  findTauntonFloodWarning,
  parseNwsFloodDetails,
} from '../src/lib/flood.mjs';

test('extracts and chronologically sorts Taunton River USGS gage-height readings', () => {
  const payload = {
    value: {
      timeSeries: [{
        sourceInfo: { siteCode: [{ agencyCode: 'USGS', value: '01108000' }] },
        variable: { variableCode: [{ value: '00065' }] },
        values: [{ value: [
          { dateTime: '2026-09-28T10:45:00-04:00', value: '8.26' },
          { dateTime: '2026-09-28T10:30:00-04:00', value: '8.24' },
          { dateTime: '2026-09-28T11:00:00-04:00', value: '-999999' },
        ] }],
      }],
    },
  };

  assert.deepEqual(extractUsgsObservations(payload), [
    { time: '2026-09-28T14:30:00.000Z', stage: 8.24 },
    { time: '2026-09-28T14:45:00.000Z', stage: 8.26 },
  ]);
});

test('extracts NWPS forecast hydrograph points and issuance time', () => {
  const forecast = extractNwpsForecast({
    forecast: {
      issuedTime: '2026-09-28T15:10:00Z',
      data: [
        { validTime: '2026-09-29T06:00:00Z', primary: 8.5 },
        { validTime: '2026-09-28T18:00:00Z', primary: 8.4 },
        { validTime: '2026-09-29T12:00:00Z', primary: null },
      ],
    },
  });

  assert.equal(forecast.issuedAt, '2026-09-28T15:10:00Z');
  assert.deepEqual(forecast.points, [
    { time: '2026-09-28T18:00:00.000Z', stage: 8.4 },
    { time: '2026-09-29T06:00:00.000Z', stage: 8.5 },
  ]);
});

test('provides sorted NWPS observations as a fallback when the USGS feed is unavailable', () => {
  const observations = extractNwpsObservations({
    observed: {
      data: [
        { validTime: '2026-09-28T14:45:00Z', primary: 8.27 },
        { validTime: '2026-09-28T14:30:00Z', primary: 8.24 },
        { validTime: '2026-09-28T15:00:00Z', primary: null },
      ],
    },
  });

  assert.deepEqual(observations, [
    { time: '2026-09-28T14:30:00.000Z', stage: 8.24 },
    { time: '2026-09-28T14:45:00.000Z', stage: 8.27 },
  ]);
});

test('keeps only Bristol County alerts and extracts the latest Taunton warning forecast', () => {
  const alerts = extractBristolAlerts({
    features: [
      {
        id: 'https://api.weather.gov/alerts/taunton-warning',
        properties: {
          event: 'Flood Warning',
          headline: 'Taunton River Flood Warning',
          areaDesc: 'Bristol, MA; Plymouth, MA',
          sent: '2026-09-28T11:23:00-04:00',
          affectedZones: ['https://api.weather.gov/zones/county/MAC005'],
          description: [
            '* IMPACTS...At 8.0 feet, low areas may flood.',
            '- ADDITIONAL DETAILS...',
            '- Forecast...The river is expected to crest at 8.5 feet this evening.',
            '- Flood stage is 8.0 feet.',
          ].join('\n'),
        },
      },
      {
        properties: {
          event: 'Flood Watch',
          areaDesc: 'Middlesex, MA',
          affectedZones: ['https://api.weather.gov/zones/county/MAC017'],
        },
      },
    ],
  });

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].forecastText, 'The river is expected to crest at 8.5 feet this evening.');
  assert.equal(alerts[0].impactsText, 'At 8.0 feet, low areas may flood.');
  assert.equal(findTauntonFloodWarning(alerts).crestStage, 8.5);
});

test('returns blank forecast details when NWS narrative has no forecast block', () => {
  assert.deepEqual(parseNwsFloodDetails('A routine weather message.'), {
    forecastText: '',
    impactsText: '',
    reportedStage: null,
    reportedStageText: '',
    crestStage: null,
    crestTiming: '',
  });
});
