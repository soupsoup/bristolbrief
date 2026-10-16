// National Weather Service gridpoint forecast (api.weather.gov), reduced to what the Weather
// page shows. The NWS forecast covers seven days in twelve-hour periods.

export const FORECAST_URL = 'https://api.weather.gov/gridpoints/BOX/74,80/forecast'; // Taunton, near the middle of the county
const TZ = 'America/New_York';

/** Keep the fields the page uses from the NWS response. */
export function normalizeForecast(json) {
  const p = json?.properties ?? {};
  const periods = (p.periods ?? []).map((x) => ({
    name: x.name,
    start: x.startTime,
    day: Boolean(x.isDaytime),
    temp: x.temperature,
    unit: x.temperatureUnit,
    pop: x.probabilityOfPrecipitation?.value ?? null,
    wind: [x.windDirection, x.windSpeed].filter(Boolean).join(' '),
    short: x.shortForecast,
    detail: x.detailedForecast,
  }));
  return { generated: p.updateTime ?? p.generatedAt ?? null, periods };
}

const dateKey = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });

/** Pair the day and night periods that fall on the same calendar day. */
export function groupDays(periods) {
  const days = [];
  for (const p of periods) {
    const key = dateKey(p.start);
    let d = days.find((x) => x.date === key);
    if (!d) {
      d = { date: key, day: null, night: null };
      days.push(d);
    }
    d[p.day ? 'day' : 'night'] = p;
  }
  return days.map((d) => ({
    ...d,
    high: d.day?.temp ?? null,
    low: d.night?.temp ?? null,
    // Highest chance of rain across the day's two periods.
    pop: Math.max(d.day?.pop ?? 0, d.night?.pop ?? 0),
    short: (d.day ?? d.night).short,
  }));
}
