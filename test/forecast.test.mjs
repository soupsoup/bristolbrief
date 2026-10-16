import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeForecast, groupDays } from '../scripts/lib/forecast.mjs';

const raw = {
  properties: {
    updateTime: '2026-10-16T22:00:00+00:00',
    periods: [
      { name: 'Tonight', startTime: '2026-10-16T19:00:00-04:00', isDaytime: false, temperature: 49, temperatureUnit: 'F', probabilityOfPrecipitation: { value: 96 }, windSpeed: '7 to 12 mph', windDirection: 'W', shortForecast: 'Patchy Fog', detailedForecast: 'Fog.' },
      { name: 'Saturday', startTime: '2026-10-17T06:00:00-04:00', isDaytime: true, temperature: 62, temperatureUnit: 'F', probabilityOfPrecipitation: { value: null }, windSpeed: '10 mph', windDirection: 'NW', shortForecast: 'Mostly Sunny', detailedForecast: 'Sunny.' },
      { name: 'Saturday Night', startTime: '2026-10-17T18:00:00-04:00', isDaytime: false, temperature: 44, temperatureUnit: 'F', probabilityOfPrecipitation: { value: 10 }, windSpeed: '5 mph', windDirection: 'N', shortForecast: 'Clear', detailedForecast: 'Clear.' },
    ],
  },
};

test('forecast periods keep the fields the page uses', () => {
  const f = normalizeForecast(raw);
  assert.equal(f.periods.length, 3);
  assert.deepEqual(f.periods[0], { name: 'Tonight', start: '2026-10-16T19:00:00-04:00', day: false, temp: 49, unit: 'F', pop: 96, wind: 'W 7 to 12 mph', short: 'Patchy Fog', detail: 'Fog.' });
  assert.equal(f.generated, '2026-10-16T22:00:00+00:00');
});

test('day and night periods pair up by calendar day', () => {
  const days = groupDays(normalizeForecast(raw).periods);
  assert.equal(days.length, 2);
  assert.equal(days[0].high, null); // today starts at night
  assert.equal(days[0].low, 49);
  assert.equal(days[1].high, 62);
  assert.equal(days[1].low, 44);
  assert.equal(days[1].pop, 10);
});

test('an empty response gives no periods', () => {
  assert.deepEqual(normalizeForecast({}), { generated: null, periods: [] });
});
