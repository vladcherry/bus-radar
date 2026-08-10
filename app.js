/* Bus Radar — Altea · Albir · Benidorm
 * Data source: public Avanza Grupo API (apisvt.avanzagrupo.com), empresa 5 (Llorente Bus Benidorm).
 * Fully static app: the API sends Access-Control-Allow-Origin: *.
 */
'use strict';

const API = 'https://apisvt.avanzagrupo.com';
const EMPRESA = 5;
const REFRESH_MS = 15000;
const STOPS_CACHE_KEY = 'busradar_stops_v1';
const LINES_CACHE_KEY = 'busradar_lines_v1';
const TRAY_CACHE_KEY = 'busradar_tray_v1_';  // + line code
const FAVS_KEY = 'busradar_favs';
const LANG_KEY = 'busradar_lang';
const CACHE_TTL = 24 * 60 * 60 * 1000;
const BUS_ETA_STOPS_MAX = 20;   // cap per-stop ETA requests for a clicked bus
const BUS_ETA_CONCURRENCY = 5;

let lang = detectLang();
let stops = [];            // [{cod, ds, town, lat, lon, lines[]}]
let lineColors = {};       // '010' -> '#FF0000'
let favs = loadFavs();     // Set of stop codes
let userPos = null;        // {lat, lon}
let currentStop = null;
let currentBus = null;     // trafico of the bus being inspected
let busSeq = 0;            // guards async bus-view fills against stale responses
let lastTraficos = null;   // last arrivals payload, so a language switch can re-render instantly
let busTrack = {};         // ref -> {lat, lon, bearing} for movement-based heading
let refreshTimer = null;
let map, stopsLayer, busLayer, routeLayer, userMarker, selectedMarker;

const $ = (id) => document.getElementById(id);
const t = () => I18N[lang];

/* ---------- helpers ---------- */

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function bearing(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * rad) * Math.cos(lat2 * rad);
  const x = Math.cos(lat1 * rad) * Math.sin(lat2 * rad) -
    Math.sin(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos((lon2 - lon1) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

function fmtDist(m) {
  return m < 950 ? `${Math.round(m / 10) * 10} ${t().m}` : `${(m / 1000).toFixed(1)} ${t().km}`;
}

function normalize(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}

/* Some endpoints (getTrayectos) return UTF-8 double-encoded as Latin-1 ("MediterrÃ¡neo") */
function fixEnc(s) {
  if (!s || !/[Ã‚]/.test(s)) return s || '';
  try { return decodeURIComponent(escape(s)); } catch { return s; }
}

function townName(code) {
  const n = TOWN_NAMES[code];
  if (!n) return code || '';
  return lang === 'uk' ? n.uk : n.latin;
}

function cacheGet(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { t: ts, v } = JSON.parse(raw);
    return Date.now() - ts < CACHE_TTL ? v : null;
  } catch { return null; }
}

function cacheSet(key, v) {
  try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), v })); } catch {}
}

async function apiGet(path) {
  const res = await fetch(API + path);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json();
  if (json.status !== 'ok') throw new Error(json.message || 'API error');
  return json.data;
}

/* ---------- favorites ---------- */

function loadFavs() {
  try { return new Set(JSON.parse(localStorage.getItem(FAVS_KEY) || '[]')); }
  catch { return new Set(); }
}

function toggleFav(cod) {
  if (favs.has(cod)) favs.delete(cod); else favs.add(cod);
  try { localStorage.setItem(FAVS_KEY, JSON.stringify([...favs])); } catch {}
  if (currentStop) updateFavButton();
  if (!$('view-stops').hidden) renderStopsList($('search').value);
}

function updateFavButton() {
  const on = currentStop && favs.has(currentStop.cod);
  const b = $('btn-fav');
  b.textContent = on ? '♥' : '♡';
  b.classList.toggle('on', !!on);
  b.title = on ? t().favRemove : t().favAdd;
}

/* ---------- reference data ---------- */

function parseStop(p) {
  // Stop names carry a town suffix in two formats: "… _BND" or "… -ALF".
  // Strip it only when the code is known, so real name endings survive.
  const m = p.ds.match(/^(.*?)\s*[-_]([A-Z]{2,4})\s*$/);
  const known = m && TOWN_NAMES[m[2]];
  return {
    cod: p.cod,
    ds: known ? m[1] : p.ds.trim(),
    town: known ? m[2] : '',
    lat: parseFloat(p.coordinates[0]),
    lon: parseFloat(p.coordinates[1]),
    lines: p.lines || [],
  };
}

async function loadStops() {
  let data = cacheGet(STOPS_CACHE_KEY);
  if (!data) {
    data = (await apiGet(`/lineas/getParadas?empresa=${EMPRESA}`)).paradas;
    cacheSet(STOPS_CACHE_KEY, data);
  }
  stops = data.map(parseStop).filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon));
}

async function loadLines() {
  let data = cacheGet(LINES_CACHE_KEY);
  if (!data) {
    try {
      data = await apiGet(`/lineas/getLineas?empresa=${EMPRESA}&N=1`);
      cacheSet(LINES_CACHE_KEY, data);
    } catch { data = []; }
  }
  const arr = Array.isArray(data) ? data : Object.values(data);
  for (const l of arr) {
    if (l && l.color) {
      if (l.id) lineColors[l.id] = l.color;
      if (l.idsae) lineColors[l.idsae] = l.color;
    }
  }
}

function lineColor(co) {
  return lineColors[co] || lineColors[String(co).padStart(3, '0')] || '#d32f2f';
}

async function getTrayectos(linea) {
  const key = TRAY_CACHE_KEY + linea;
  let data = cacheGet(key);
  if (!data) {
    data = (await apiGet(`/lineas/getTrayectos?empresa=${EMPRESA}&linea=${encodeURIComponent(linea)}`)).trayectos || [];
    cacheSet(key, data);
  }
  return data;
}

/* ---------- map ---------- */

function initMap() {
  map = L.map('map', { zoomControl: true }).setView([38.556, -0.083], 13);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  stopsLayer = L.layerGroup().addTo(map);
  routeLayer = L.layerGroup().addTo(map);
  busLayer = L.layerGroup().addTo(map);
}

// Front-view bus glyph drawn in the marker's currentColor
const BUS_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M5 4 h14 a1.5 1.5 0 0 1 1.5 1.5 V17 a1.5 1.5 0 0 1 -1.5 1.5 H5 A1.5 1.5 0 0 1 3.5 17 V5.5 A1.5 1.5 0 0 1 5 4 Z"/>
  <rect x="6.5" y="7" width="11" height="6" rx="0.8"/>
  <circle cx="8" cy="21" r="1.3" fill="currentColor" stroke="none"/>
  <circle cx="16" cy="21" r="1.3" fill="currentColor" stroke="none"/>
</svg>`;

function stopIcon(selected) {
  const size = selected ? 30 : 20;
  return L.divIcon({
    className: '',
    html: `<div class="stop-icon${selected ? ' selected' : ''}" style="width:${size}px;height:${size}px">${BUS_SVG}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function drawStops() {
  stopsLayer.clearLayers();
  for (const s of stops) {
    const marker = L.marker([s.lat, s.lon], { icon: stopIcon(false) });
    marker.bindTooltip(`${s.cod} · ${s.ds}`, { direction: 'top', offset: [0, -10] });
    marker.on('click', () => selectStop(s.cod));
    stopsLayer.addLayer(marker);
  }
}

function highlightStop(s) {
  if (selectedMarker) { map.removeLayer(selectedMarker); selectedMarker = null; }
  if (!s) return;
  selectedMarker = L.marker([s.lat, s.lon], { icon: stopIcon(true), zIndexOffset: 500 }).addTo(map);
  map.setView([s.lat, s.lon], Math.max(map.getZoom(), 15));
}

function updateBusTrack(traficos) {
  const seen = {};
  for (const tr of traficos) {
    if (!tr.ref) continue;
    const lat = parseFloat(tr.lat), lon = parseFloat(tr.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const prev = busTrack[tr.ref];
    let brg = prev ? prev.bearing : null;
    // recompute heading only after real movement, so GPS jitter doesn't spin the arrow
    if (prev && haversine(prev.lat, prev.lon, lat, lon) > 8) {
      brg = bearing(prev.lat, prev.lon, lat, lon);
    }
    seen[tr.ref] = { lat, lon, bearing: brg };
  }
  busTrack = { ...busTrack, ...seen };
}

function drawBuses(traficos) {
  busLayer.clearLayers();
  updateBusTrack(traficos);
  for (const tr of traficos) {
    const lat = parseFloat(tr.lat), lon = parseFloat(tr.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const label = tr.coLinea && tr.coLinea !== '000' ? tr.coLinea.replace(/^0+/, '') || tr.coLinea : '?';
    const brg = tr.ref && busTrack[tr.ref] ? busTrack[tr.ref].bearing : null;
    const arrow = brg == null ? '' :
      `<span class="bus-arrow" style="transform:rotate(${Math.round(brg)}deg)">▲</span>`;
    const icon = L.divIcon({
      className: '',
      html: `<div class="bus-icon" style="background:${esc(lineColor(tr.coLinea))};padding:2px 6px">${arrow}🚌 ${esc(label)}</div>`,
      iconSize: null,
    });
    const m = L.marker([lat, lon], { icon, zIndexOffset: 1000 });
    m.bindTooltip(`${esc(t().thLine)} ${esc(tr.coLinea)} → ${esc(tr.dsDestino || '?')} · ${esc(fmtEta(tr))}`);
    if (tr.ref && tr.coLinea !== '000') m.on('click', () => openBusView(tr));
    busLayer.addLayer(m);
  }
}

/* ---------- stop list ---------- */

function stopListItem(s, extra) {
  const fav = favs.has(s.cod);
  return `
    <li data-cod="${esc(s.cod)}">
      <span class="code">${esc(s.cod)}</span>
      <span class="name">${esc(s.ds)}${s.town ? ` <small>(${esc(townName(s.town))})</small>` : ''}
        <span class="lines">${esc(t().lines)}: ${s.lines.map(esc).join(', ') || '—'}</span>
      </span>
      ${extra || ''}
      <button class="fav${fav ? ' on' : ''}" data-fav="${esc(s.cod)}" title="${esc(fav ? t().favRemove : t().favAdd)}">${fav ? '♥' : '♡'}</button>
    </li>`;
}

function withDist(items) {
  if (!userPos) return items;
  return items.map(s => ({ ...s, dist: haversine(userPos.lat, userPos.lon, s.lat, s.lon) }))
              .sort((a, b) => a.dist - b.dist);
}

function renderStopsList(filter) {
  const list = $('stops-list');
  const q = normalize(filter || '');
  let html = '';

  if (q) {
    const items = withDist(stops.filter(s =>
      normalize(s.ds).includes(q) || s.cod.startsWith(q) || normalize(townName(s.town)).includes(q)));
    html = items.slice(0, 30).map(s => stopListItem(s, distSpan(s))).join('');
  } else {
    const favItems = withDist(stops.filter(s => favs.has(s.cod)));
    if (favItems.length) {
      html += `<div class="section-title">♥ ${esc(t().favorites)}</div>`;
      html += favItems.map(s => stopListItem(s, distSpan(s))).join('');
    }
    if (userPos) {
      const rest = withDist(stops.filter(s => !favs.has(s.cod))).slice(0, 30);
      html += rest.map(s => stopListItem(s, distSpan(s))).join('');
    }
    if (!html) {
      $('stops-hint').hidden = false;
      list.innerHTML = '';
      return;
    }
  }
  $('stops-hint').hidden = true;
  list.innerHTML = html;

  list.querySelectorAll('li').forEach(li =>
    li.addEventListener('click', () => selectStop(li.dataset.cod)));
  list.querySelectorAll('button.fav').forEach(b =>
    b.addEventListener('click', (e) => { e.stopPropagation(); toggleFav(b.dataset.fav); }));
}

function distSpan(s) {
  return s.dist != null ? `<span class="dist">${fmtDist(s.dist)}</span>` : '';
}

function locate() {
  if (!navigator.geolocation) {
    $('stops-hint').textContent = t().geoUnsupported;
    return;
  }
  $('btn-locate').disabled = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      userPos = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      if (userMarker) map.removeLayer(userMarker);
      userMarker = L.circleMarker([userPos.lat, userPos.lon], {
        radius: 8, weight: 3, color: '#1565c0', fillColor: '#2196f3', fillOpacity: 1,
      }).addTo(map).bindTooltip(t().youAreHere);
      map.setView([userPos.lat, userPos.lon], 15);
      $('btn-locate').disabled = false;
      renderStopsList($('search').value);
    },
    (err) => {
      $('btn-locate').disabled = false;
      $('stops-hint').hidden = false;
      $('stops-hint').textContent = t().geoFail + err.message;
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
  );
}

/* ---------- arrivals board ---------- */

function fmtEta(tr) {
  if (tr.minres != null) return tr.minres <= 0 ? t().now : `${tr.minres} ${t().min}`;
  return tr.quedan || '—';
}

function selectStop(cod) {
  const s = stops.find(x => x.cod === String(cod));
  if (!s) return;
  closeBusView(true);
  currentStop = s;
  lastTraficos = null;
  location.hash = '#/stop/' + s.cod;

  $('view-stops').hidden = true;
  $('view-arrivals').hidden = false;
  $('stop-name').textContent = s.ds + (s.town ? ` (${townName(s.town)})` : '');
  $('stop-code').textContent = `${t().stopNo} ${s.cod}`;
  $('stop-lines').textContent = s.lines.length ? `${t().lines}: ${s.lines.join(', ')}` : '';
  $('arrivals-table').hidden = true;
  $('arrivals-status').textContent = t().loading;
  updateFavButton();

  highlightStop(s);
  scheduleRefresh(true);
}

function closeStop() {
  closeBusView(true);
  currentStop = null;
  lastTraficos = null;
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  clearTimeout(refreshTimer);
  busLayer.clearLayers();
  highlightStop(null);
  $('view-arrivals').hidden = true;
  $('view-stops').hidden = false;
  renderStopsList($('search').value);
}

function scheduleRefresh(now) {
  clearTimeout(refreshTimer);
  if (!currentStop || currentBus) return;
  if (now) refreshArrivals();
  refreshTimer = setTimeout(() => scheduleRefresh(true), REFRESH_MS);
}

async function refreshArrivals() {
  if (!currentStop) return;
  const stop = currentStop;
  $('btn-refresh').classList.add('spin');
  try {
    const data = await apiGet(`/lineas/getTraficosParada?empresa=${EMPRESA}&parada=${encodeURIComponent(stop.cod)}&find=`);
    if (currentStop !== stop || currentBus) return; // user navigated away meanwhile
    const traficos = (data.traficos || []).slice()
      .sort((a, b) => (a.minres ?? 999) - (b.minres ?? 999));
    lastTraficos = traficos;
    renderArrivals(traficos);
    drawBuses(traficos);
    $('arrivals-status').textContent =
      t().updatedAt(new Date().toLocaleTimeString(lang === 'en' ? 'en-GB' : lang));
  } catch (e) {
    if (currentStop !== stop || currentBus) return;
    $('arrivals-status').textContent = t().loadError(e.message);
  } finally {
    $('btn-refresh').classList.remove('spin');
  }
}

function renderArrivals(traficos) {
  const tbl = $('arrivals-table'), body = $('arrivals-body');
  if (!traficos.length) {
    tbl.hidden = true;
    $('arrivals-status').textContent = t().noBuses;
    return;
  }
  body.innerHTML = traficos.map((tr, i) => {
    const arriving = tr.minres != null && tr.minres <= 0;
    const abs = tr.llegada ? tr.llegada.slice(0, 5) : '';
    const line = tr.coLinea === '000' ? '—' : tr.coLinea;
    const clickable = tr.ref && tr.coLinea !== '000';
    return `<tr data-idx="${i}" class="${clickable ? 'clickable' : ''}">
      <td><span class="line-badge" style="background:${esc(lineColor(tr.coLinea))}">${esc(line)}</span></td>
      <td><span class="eta${arriving ? ' now' : ''}">${esc(fmtEta(tr))}${abs ? `<span class="abs">${esc(abs)}</span>` : ''}</span></td>
      <td class="dest">${esc(tr.dsDestino || tr.dsLinea || '—')}${clickable ? ' <span class="chev">›</span>' : ''}</td>
    </tr>`;
  }).join('');
  tbl.hidden = false;
  body.querySelectorAll('tr.clickable').forEach(row =>
    row.addEventListener('click', () => {
      const tr = lastTraficos && lastTraficos[Number(row.dataset.idx)];
      if (tr) openBusView(tr);
    }));
}

/* ---------- bus route view ---------- */

function stopByCod(cod) {
  return stops.find(x => x.cod === String(cod));
}

function trayStopName(p) {
  const local = stopByCod(p.codigo);
  if (local) return local.ds + (local.town ? ` (${townName(local.town)})` : '');
  return fixEnc(p.nombre);
}

async function openBusView(tr) {
  const seq = ++busSeq;
  currentBus = tr;
  clearTimeout(refreshTimer);

  $('view-stops').hidden = true;
  $('view-arrivals').hidden = true;
  $('view-bus').hidden = false;
  $('btn-bus-back').textContent = currentStop ? t().backToBoard : t().back;
  $('bus-title').innerHTML =
    `<span class="line-badge" style="background:${esc(lineColor(tr.coLinea))}">${esc(tr.coLinea)}</span> ${esc(t().busTitle(tr.coLinea.replace(/^0+/, '') || tr.coLinea))}`;
  $('bus-dest').textContent = `→ ${tr.dsDestino || '?'}`;
  $('bus-status').textContent = t().loading;
  $('bus-table').hidden = true;
  $('bus-upcoming-title').hidden = true;
  $('bus-body').innerHTML = '';

  const busLat = parseFloat(tr.lat), busLon = parseFloat(tr.lon);

  let tray = null;
  try {
    const trayectos = await getTrayectos(tr.coLinea);
    if (seq !== busSeq) return;
    // the right variant ends at the bus's destination stop
    tray = trayectos.find(x => x.paradas.length && x.paradas[x.paradas.length - 1].codigo === tr.coDestino)
        || trayectos.find(x => normalize(fixEnc(x.nomtray)).endsWith(normalize(tr.dsDestino || '')))
        || null;
  } catch { /* fall through to noRouteData */ }

  if (!tray || !tray.paradas.length) {
    $('bus-status').textContent = t().noRouteData;
    return;
  }

  // trayecto coordinates come as [lon, lat]
  const pts = tray.paradas
    .map(p => [parseFloat(p.coordinates[1]), parseFloat(p.coordinates[0])])
    .filter(pt => Number.isFinite(pt[0]) && Number.isFinite(pt[1]));

  routeLayer.clearLayers();
  const color = lineColor(tr.coLinea);
  routeLayer.addLayer(L.polyline(pts, { color, weight: 4, opacity: .75 }));
  tray.paradas.forEach((p, i) => {
    const pt = [parseFloat(p.coordinates[1]), parseFloat(p.coordinates[0])];
    if (!Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) return;
    const dot = L.circleMarker(pt, { radius: 4, weight: 2, color, fillColor: '#fff', fillOpacity: 1 });
    dot.bindTooltip(`${p.codigo} · ${trayStopName(p)}`);
    dot.on('click', () => { if (stopByCod(p.codigo)) selectStop(p.codigo); });
    routeLayer.addLayer(dot);
  });
  if (Number.isFinite(busLat)) routeLayer.addLayer(L.circleMarker([busLat, busLon], {
    radius: 3, weight: 6, color, opacity: .35, fillOpacity: 0,
  }));
  map.fitBounds(L.latLngBounds(pts).pad(0.1));

  // upcoming stops = from the stop nearest to the bus through the end of the trayecto
  let nearestIdx = 0, best = Infinity;
  tray.paradas.forEach((p, i) => {
    const d = haversine(busLat, busLon, parseFloat(p.coordinates[1]), parseFloat(p.coordinates[0]));
    if (d < best) { best = d; nearestIdx = i; }
  });
  const upcoming = tray.paradas.slice(nearestIdx, nearestIdx + BUS_ETA_STOPS_MAX);

  $('bus-status').textContent = '';
  $('bus-upcoming-title').hidden = false;
  $('bus-upcoming-title').textContent = t().upcomingStops;
  $('bus-table').hidden = false;
  $('bus-body').innerHTML = upcoming.map(p => `
    <tr data-stop="${esc(p.codigo)}">
      <td class="dest">${esc(p.codigo)} · ${esc(trayStopName(p))}</td>
      <td class="bus-eta"><span class="eta-pending">…</span></td>
    </tr>`).join('');
  $('bus-body').querySelectorAll('tr').forEach(row =>
    row.addEventListener('click', () => { if (stopByCod(row.dataset.stop)) selectStop(row.dataset.stop); }));

  // fill per-stop ETAs for this vehicle (identified by ref) with limited concurrency
  const queue = [...upcoming];
  const fill = async () => {
    while (queue.length) {
      const p = queue.shift();
      let text = '—';
      try {
        const data = await apiGet(`/lineas/getTraficosParada?empresa=${EMPRESA}&parada=${encodeURIComponent(p.codigo)}&find=`);
        const mine = (data.traficos || []).find(x => x.ref === tr.ref);
        if (mine) {
          const abs = mine.llegada ? mine.llegada.slice(0, 5) : '';
          text = `${fmtEta(mine)}${abs ? ` (${abs})` : ''}`;
        }
      } catch { text = '—'; }
      if (seq !== busSeq) return;
      const cell = $('bus-body').querySelector(`tr[data-stop="${CSS.escape(p.codigo)}"] .bus-eta`);
      if (cell) cell.textContent = text;
    }
  };
  await Promise.all(Array.from({ length: BUS_ETA_CONCURRENCY }, fill));
}

function closeBusView(silent) {
  if (!currentBus && silent) return;
  busSeq++;
  currentBus = null;
  routeLayer.clearLayers();
  $('view-bus').hidden = true;
  if (silent) return;
  if (currentStop) {
    $('view-arrivals').hidden = false;
    highlightStop(currentStop);
    scheduleRefresh(true);
  } else {
    $('view-stops').hidden = false;
  }
}

/* ---------- i18n ---------- */

function applyI18n() {
  document.documentElement.lang = lang;
  $('btn-locate').textContent = t().near;
  $('search').placeholder = t().searchPlaceholder;
  if (!userPos && !$('search').value) $('stops-hint').textContent = t().hintStart;
  $('btn-back').textContent = t().back;
  $('btn-refresh').title = t().refresh;
  $('th-line').textContent = t().thLine;
  $('th-eta').textContent = t().thEta;
  $('th-dest').textContent = t().thDest;
  $('th-bus-stop').textContent = t().stopNo;
  $('th-bus-time').textContent = t().thTime;
  $('btn-bus-back').textContent = currentStop ? t().backToBoard : t().back;
  $('credits').innerHTML = t().credits
    .replace('{link}', '<a href="https://consultas.avanzagrupo.com" target="_blank" rel="noopener">Avanza Grupo</a>')
    .replace('{feedback}', `<a href="mailto:${FEEDBACK_EMAIL}">✉ ${esc(t().feedback)}</a>`);
  $('btn-lang').innerHTML = `${langFlag(lang)} ${lang.toUpperCase()}`;

  $('lang-menu').innerHTML = Object.keys(LANGS).map(code =>
    `<button data-lang="${code}" class="${code === lang ? 'active' : ''}">${langFlag(code)} ${LANGS[code].name}</button>`
  ).join('');
  $('lang-menu').querySelectorAll('button').forEach(b =>
    b.addEventListener('click', () => setLang(b.dataset.lang)));
}

function setLang(code) {
  if (!I18N[code]) return;
  lang = code;
  try { localStorage.setItem(LANG_KEY, code); } catch {}
  $('lang-menu').hidden = true;
  applyI18n();
  // Re-render dynamic views in the new language without waiting for the next poll
  if (currentBus) {
    const tr = currentBus;
    $('bus-title').innerHTML =
      `<span class="line-badge" style="background:${esc(lineColor(tr.coLinea))}">${esc(tr.coLinea)}</span> ${esc(t().busTitle(tr.coLinea.replace(/^0+/, '') || tr.coLinea))}`;
    $('bus-upcoming-title').textContent = t().upcomingStops;
  } else if (currentStop) {
    $('stop-code').textContent = `${t().stopNo} ${currentStop.cod}`;
    $('stop-lines').textContent = currentStop.lines.length ? `${t().lines}: ${currentStop.lines.join(', ')}` : '';
    $('stop-name').textContent = currentStop.ds + (currentStop.town ? ` (${townName(currentStop.town)})` : '');
    updateFavButton();
    if (lastTraficos) { renderArrivals(lastTraficos); drawBuses(lastTraficos); }
  } else {
    renderStopsList($('search').value);
  }
}

/* ---------- boot ---------- */

function handleHash() {
  const m = location.hash.match(/^#\/stop\/(\w+)/);
  if (m) selectStop(m[1]);
  else if (currentStop) closeStop();
}

async function main() {
  initMap();
  applyI18n();
  $('btn-locate').addEventListener('click', locate);
  $('btn-back').addEventListener('click', closeStop);
  $('btn-bus-back').addEventListener('click', () => closeBusView(false));
  $('btn-fav').addEventListener('click', () => { if (currentStop) toggleFav(currentStop.cod); });
  $('btn-refresh').addEventListener('click', () => scheduleRefresh(true));
  $('btn-lang').addEventListener('click', (e) => {
    e.stopPropagation();
    $('lang-menu').hidden = !$('lang-menu').hidden;
  });
  document.addEventListener('click', () => { $('lang-menu').hidden = true; });
  $('search').addEventListener('input', (e) => renderStopsList(e.target.value));
  window.addEventListener('hashchange', handleHash);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleRefresh(true);
    else clearTimeout(refreshTimer);
  });

  try {
    await Promise.all([loadStops(), loadLines()]);
  } catch (e) {
    $('stops-hint').textContent = t().stopsLoadError + e.message;
    return;
  }
  drawStops();
  handleHash();
  if (!currentStop) locate();
}

main();
