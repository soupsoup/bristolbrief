  type StagePoint = { time: string; stage: number };
  type RiverAlert = {
    id: string;
    event: string;
    headline: string;
    area: string;
    sent: string | null;
    expires: string | null;
    ends: string | null;
    forecastText: string;
    impactsText: string;
    crestStage: number | null;
    crestTiming: string;
  };
  type FloodData = {
    checkedAt: string;
    gauge: { observedSource: string; floodStageFt: number };
    observations: StagePoint[];
    latestObserved: StagePoint | null;
    forecast: StagePoint[];
    forecastIssuedAt: string | null;
    alerts: RiverAlert[];
    tauntonWarning: RiverAlert | null;
    errors: string[];
  };

  const page = document.querySelector<HTMLElement>('[data-river-page]');
  const zone = 'America/New_York';
  const floodStage = 8;
  const svgNs = 'http://www.w3.org/2000/svg';

  function formatDateTime(value: string | null | undefined, options: Intl.DateTimeFormatOptions = {}) {
    if (!value) return 'Time unavailable';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return 'Time unavailable';
    return new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
      ...options,
    }).format(date);
  }

  function element<T extends Element = HTMLElement>(selector: string): T | null {
    return page?.querySelector<T>(selector) ?? null;
  }

  function setText(selector: string, value: string) {
    const target = element(selector);
    if (target) target.textContent = value;
  }

  function svgElement(name: string, attributes: Record<string, string | number> = {}, text = '') {
    const node = document.createElementNS(svgNs, name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    if (text) node.textContent = text;
    return node;
  }

  function drawChart(observations: StagePoint[], forecast: StagePoint[]) {
    const svg = element<SVGSVGElement>('[data-stage-chart]');
    if (!svg) return;
    svg.replaceChildren();

    const validObserved = observations.filter((point) => Number.isFinite(point.stage) && Number.isFinite(Date.parse(point.time)));
    const validForecast = forecast.filter((point) => Number.isFinite(point.stage) && Number.isFinite(Date.parse(point.time)));
    if (!validObserved.length) {
      svg.append(svgElement('text', { x: 490, y: 165, 'text-anchor': 'middle', class: 'chart-empty' }, 'Gauge history is temporarily unavailable'));
      return;
    }

    const allPoints = [...validObserved, ...validForecast];
    const minTime = Math.min(...allPoints.map((point) => Date.parse(point.time)));
    const maxTime = Math.max(...allPoints.map((point) => Date.parse(point.time)), minTime + 60 * 60 * 1000);
    const minStage = Math.min(floodStage, ...allPoints.map((point) => point.stage));
    const maxStage = Math.max(floodStage, ...allPoints.map((point) => point.stage));
    const step = 0.5;
    let low = Math.floor((minStage - 0.15) / step) * step;
    let high = Math.ceil((maxStage + 0.15) / step) * step;
    if (high - low < 2) { low -= 1; high += 1; }

    const left = 72;
    const right = 950;
    const top = 18;
    const bottom = 272;
    const x = (time: string) => left + ((Date.parse(time) - minTime) / (maxTime - minTime)) * (right - left);
    const y = (stage: number) => bottom - ((stage - low) / (high - low)) * (bottom - top);
    const grid = svgElement('g', { class: 'chart-grid' });
    for (let stage = Math.ceil(low / step) * step; stage <= high; stage += step) {
      const line = svgElement('line', { x1: left, x2: right, y1: y(stage), y2: y(stage) });
      const label = svgElement('text', { x: left - 12, y: y(stage) + 4, 'text-anchor': 'end' }, stage.toFixed(1));
      grid.append(line, label);
    }
    svg.append(grid);

    const thresholdY = y(floodStage);
    svg.append(svgElement('line', { x1: left, x2: right, y1: thresholdY, y2: thresholdY, class: 'chart-threshold' }));
    svg.append(svgElement('text', { x: right - 4, y: thresholdY - 8, 'text-anchor': 'end', class: 'chart-threshold-label' }, '8.0 ft flood stage'));

    const observationPath = validObserved.map((point, index) => `${index ? 'L' : 'M'}${x(point.time).toFixed(1)},${y(point.stage).toFixed(1)}`).join(' ');
    svg.append(svgElement('path', { d: observationPath, class: 'chart-observed' }));
    const latest = validObserved.at(-1)!;
    svg.append(svgElement('circle', { cx: x(latest.time), cy: y(latest.stage), r: 5, class: 'chart-current-point' }));

    if (validForecast.length) {
      const forecastPath = [latest, ...validForecast].map((point, index) => `${index ? 'L' : 'M'}${x(point.time).toFixed(1)},${y(point.stage).toFixed(1)}`).join(' ');
      svg.append(svgElement('path', { d: forecastPath, class: 'chart-forecast' }));
      for (const point of validForecast) {
        svg.append(svgElement('circle', { cx: x(point.time), cy: y(point.stage), r: 3.5, class: 'chart-forecast-point' }));
      }
      const crest = validForecast.reduce((highest, point) => point.stage > highest.stage ? point : highest, validForecast[0]);
      svg.append(svgElement('text', { x: x(crest.time), y: y(crest.stage) - 13, 'text-anchor': 'middle', class: 'chart-crest-label' }, `${crest.stage.toFixed(1)} ft forecast`));
    }

    const tickCount = 5;
    for (let index = 0; index < tickCount; index += 1) {
      const time = minTime + ((maxTime - minTime) * index) / (tickCount - 1);
      const dateLabel = new Intl.DateTimeFormat('en-US', { timeZone: zone, month: 'numeric', day: 'numeric', hour: 'numeric' }).format(new Date(time));
      const tickX = left + ((right - left) * index) / (tickCount - 1);
      svg.append(svgElement('line', { x1: tickX, x2: tickX, y1: bottom, y2: bottom + 5, class: 'chart-axis-tick' }));
      svg.append(svgElement('text', { x: tickX, y: bottom + 25, 'text-anchor': index === 0 ? 'start' : index === tickCount - 1 ? 'end' : 'middle', class: 'chart-time-label' }, dateLabel));
    }
    svg.append(svgElement('line', { x1: left, x2: right, y1: bottom, y2: bottom, class: 'chart-axis' }));
  }

  function renderAlerts(alerts: RiverAlert[]) {
    const list = element('[data-active-alerts]');
    if (!list) return;
    list.replaceChildren();
    if (!alerts.length) {
      const empty = document.createElement('p');
      empty.className = 'meta';
      empty.textContent = 'No active NWS alerts match the selected Bristol County zones.';
      list.append(empty);
      return;
    }

    const heading = document.createElement('h3');
    heading.textContent = 'Active NWS alerts for Bristol County';
    list.append(heading);
    for (const alert of alerts) {
      const item = document.createElement('article');
      item.className = 'active-alert';
      const title = document.createElement('strong');
      title.textContent = alert.event;
      const area = document.createElement('span');
      area.textContent = alert.area || 'Bristol County area';
      item.append(title, area);
      if (alert.headline) {
        const headline = document.createElement('p');
        headline.textContent = alert.headline;
        item.append(headline);
      }
      if (alert.id && /^https:\/\//i.test(alert.id)) {
        const link = document.createElement('a');
        link.href = alert.id;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = 'Official alert ↗';
        item.append(link);
      }
      list.append(item);
    }
  }

  function renderData(data: FloodData) {
    const latest = data.latestObserved;
    const stage = Number(latest?.stage);
    if (latest && Number.isFinite(stage)) {
      const stageText = stage.toFixed(2);
      setText('[data-stage-value]', stageText);
      setText('[data-verified-stage]', stageText);
      setText('[data-stage-status]', stage >= floodStage ? 'Above flood stage' : 'Below flood stage');
      const fill = element('[data-meter-fill]');
      if (fill) fill.style.width = `${Math.max(0, Math.min(100, stage / 10 * 100))}%`;
      const meter = element('.stage-meter');
      if (meter) meter.setAttribute('aria-label', `River stage ${stageText} feet; flood stage is 8 feet`);
      const localTime = formatDateTime(latest.time, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
      setText('[data-observed-time]', `Observed ${localTime}`);
      setText('[data-verified-time]', `Observed ${localTime} · ${data.gauge?.observedSource ?? 'official gauge'}`);
    } else {
      setText('[data-stage-status]', 'Latest gauge reading unavailable');
      setText('[data-observed-time]', 'Observation time unavailable');
      setText('[data-verified-time]', 'No gauge reading available');
    }

    setText('[data-checked-time]', `Feeds checked ${formatDateTime(data.checkedAt)}`);
    drawChart(data.observations ?? [], data.forecast ?? []);
    renderAlerts(data.alerts ?? []);

    const warning = data.tauntonWarning;
    const error = element('[data-page-error]');
    if (error) {
      error.hidden = !data.errors?.length;
      error.textContent = data.errors?.join(' ') ?? '';
    }
    if (warning) {
      setText('[data-warning-headline]', warning.headline || 'Active NWS Flood Warning for the Taunton River');
      const sourceLink = element<HTMLAnchorElement>('[data-warning-link]');
      if (sourceLink && /^https:\/\//i.test(warning.id ?? '')) {
        sourceLink.href = warning.id;
        sourceLink.textContent = 'Open Taunton River warning ↗';
      }
      setText('[data-forecast-copy]', warning.forecastText || 'See the latest official warning for forecast details.');
      setText('[data-alert-asof]', `NWS alert issued ${formatDateTime(warning.sent)} · valid until ${formatDateTime(warning.ends ?? warning.expires)}`);
      if (warning.crestStage) {
        const crestCallout = element('[data-crest-callout]');
        if (crestCallout) crestCallout.hidden = false;
        setText('[data-crest-stage]', Number(warning.crestStage).toFixed(1));
        setText('[data-crest-time]', warning.crestTiming ? `Expected ${warning.crestTiming}` : 'Timing in current NWS statement');
      }
      if (warning.impactsText) {
        const impact = element('[data-official-impact]');
        if (impact) impact.hidden = false;
        setText('[data-impact-copy]', warning.impactsText);
      }
    } else {
      setText('[data-warning-headline]', 'No active Taunton River Flood Warning found in the current NWS feed.');
      setText('[data-forecast-copy]', data.forecast?.length ? 'The chart still shows the latest available NWPS forecast hydrograph.' : 'An official Taunton River forecast is temporarily unavailable.');
    }

    const forecastIssued = data.forecastIssuedAt;
    setText('[data-chart-note]', forecastIssued
      ? `Forecast hydrograph issued ${formatDateTime(forecastIssued)} · observations and all times shown in Eastern Time.`
      : 'Official gauge and forecast values; times shown in Eastern Time.');
  }

  async function loadRiverData() {
    if (!page) return;
    try {
      const response = await fetch('/api/flood-data.json');
      const data = await response.json() as FloodData;
      if (!response.ok && !data.latestObserved && !data.alerts?.length) throw new Error('Live river data is temporarily unavailable.');
      renderData(data);
    } catch (error) {
      const message = element('[data-page-error]');
      if (message) {
        message.hidden = false;
        message.textContent = 'Live river data is temporarily unavailable. This page will retry automatically; use the official source links below for the latest conditions.';
      }
      setText('[data-stage-status]', 'Live gauge connection unavailable');
      setText('[data-forecast-copy]', 'The live alert feed could not be reached. Check the NWS source link for the current warning.');
      drawChart([], []);
    }
  }

  loadRiverData();
  window.setInterval(loadRiverData, 5 * 60 * 1000);
