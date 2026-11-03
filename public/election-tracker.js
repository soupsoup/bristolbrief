// Live odds for the Bristol County federal races, read from the Market vs. Desk tracker's public
// Supabase tables (read-only, publishable key). Used by the Election page and the home page module.
(function () {
  var cfgEl = document.getElementById('electscore-config');
  if (!cfgEl) return;
  var tracker = JSON.parse(cfgEl.textContent);
  var ids = tracker.races.map(function (r) { return r.id; });
  var H = { apikey: tracker.key, Authorization: 'Bearer ' + tracker.key };
  function get(table, extra) {
    return fetch(tracker.url + '/rest/v1/' + table + '?race_id=in.(' + ids.join(',') + ')' + extra, { headers: H })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error(String(r.status))); });
  }
  var fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
  var time = function (iso) { return fmt.format(new Date(iso)) + ' ET'; };
  var pct = function (p) { return p >= 0.995 ? '>99%' : p <= 0.005 ? '<1%' : Math.round(p * 100) + '%'; };
  var NAMES = { kalshi: 'Kalshi', polymarket: 'Polymarket', blend: 'Blend' };
  var by = function (rows, id) { return rows.filter(function (r) { return r.race_id === id; }); };
  function earliest(rows) { return rows.slice().sort(function (a, b) { return new Date(a.called_at) - new Date(b.called_at); })[0]; }
  function render(data) {
    tracker.races.forEach(function (t) {
      var el = document.querySelector('[data-race="' + t.id + '"]');
      if (!el) return;
      var info = data.races.filter(function (r) { return r.id === t.id; })[0] || {};
      el.querySelector('[data-names]').textContent = (info.d_name || 'Democrat') + ' (D) vs. ' + (info.r_name || 'Republican') + ' (R)';
      var odds = by(data.odds, t.id);
      var box = el.querySelector('[data-odds]');
      if (!odds.length) { box.innerHTML = '<p class="meta">No market odds listed for this race right now.</p>'; }
      else {
        box.innerHTML = ['blend', 'kalshi', 'polymarket'].map(function (src) {
          var o = odds.filter(function (x) { return x.source === src; })[0];
          if (!o) return '';
          var d = Number(o.d_prob);
          return '<div class="odds-row"><span class="odds-src">' + NAMES[src] + '</span>' +
            '<span class="odds-bar" role="img" aria-label="Democrat ' + pct(d) + ', Republican ' + pct(1 - d) + '"><i style="width:' + (d * 100).toFixed(1) + '%"></i></span>' +
            '<span class="odds-val">D ' + pct(d) + ' · R ' + pct(1 - d) + '</span></div>';
        }).join('');
      }
      var mc = by(data.market, t.id).filter(function (c) { return !c.reversed_at; });
      var dc = by(data.desk, t.id);
      var m = earliest(mc.filter(function (c) { return c.source === 'blend'; })) || earliest(mc);
      var dk = earliest(dc.filter(function (c) { return c.source === 'manual'; })) || earliest(dc);
      var line = [];
      if (m) line.push('<strong>Markets called ' + m.side + '</strong> at ' + time(m.called_at) + ' (' + (NAMES[m.source] || m.source) + ').');
      else line.push('Markets have not called this race.');
      if (dk) line.push('<strong>Desks called ' + dk.side + '</strong> at ' + time(dk.called_at) + '.');
      if (m && dk) {
        var mins = Math.round((new Date(dk.called_at) - new Date(m.called_at)) / 60000);
        line.push(mins > 0 ? 'Markets were ' + mins + ' min ahead.' : mins < 0 ? 'Desks were ' + (-mins) + ' min ahead.' : 'Called at the same time.');
      }
      el.querySelector('[data-call]').innerHTML = line.join(' ');
      var mv = by(data.moves, t.id).filter(function (x) { return x.source !== 'blend'; })
        .sort(function (a, b) { return new Date(b.updated_at) - new Date(a.updated_at); })[0];
      el.querySelector('[data-move]').innerHTML = mv
        ? '<strong>Big move</strong> toward ' + mv.toward + ' (' + NAMES[mv.source] + '): ' + Math.round(mv.from_p * 100) + '% to ' + Math.round(mv.to_p * 100) + '% by ' + time(mv.updated_at) + '.'
        : '';
      var stamp = odds.map(function (o) { return o.fetched_at; }).sort().pop();
      el.querySelector('[data-stamp]').textContent = stamp ? 'Odds as of ' + time(stamp) + '.' : '';
    });
  }
  function load() {
    var since = new Date(Date.now() - 2 * 3600e3).toISOString();
    Promise.all([
      fetch(tracker.url + '/rest/v1/races?id=in.(' + ids.join(',') + ')&select=id,d_name,r_name', { headers: H }).then(function (r) { return r.ok ? r.json() : []; }),
      get('latest_odds', '&select=race_id,source,d_prob,fetched_at'),
      get('market_calls', '&select=race_id,source,called_at,side,reversed_at'),
      get('desk_calls', '&select=race_id,source,called_at,side'),
      get('moves', '&select=race_id,source,toward,from_p,to_p,updated_at&detected_at=gte.' + since),
    ]).then(function (r) { render({ races: r[0], odds: r[1], market: r[2], desk: r[3], moves: r[4] }); })
      .catch(function () {
        document.querySelectorAll('[data-odds]').forEach(function (b) { b.innerHTML = '<p class="meta">Market odds are unavailable right now. The state count below still updates.</p>'; });
      });
  }
  load();
  setInterval(load, 60000);
})();
