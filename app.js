/* Bus Radar — Altea · Albir · Benidorm
 * Данные: публичное API Avanza Grupo (apisvt.avanzagrupo.com), empresa 5 (Llorente Bus Benidorm).
 * Полностью статическое приложение: API отдаёт Access-Control-Allow-Origin: *.
 */
'use strict';

const API = 'https://apisvt.avanzagrupo.com';
const EMPRESA = 5;
const REFRESH_MS = 15000;
const STOPS_CACHE_KEY = 'busradar_stops_v1';
const LINES_CACHE_KEY = 'busradar_lines_v1';
const CACHE_TTL = 24 * 60 * 60 * 1000;

const TOWN_CODES = {
  BND: 'Бенидорм', VIL: 'Ла-Вила-Жойоза', FIN: 'Финестрат', NUC: 'Ла-Нусия',
  ALT: 'Альтеа', ALF: 'Альфас-дель-Пи / Альбир', POL: 'Полоп', REL: 'Рельеу',
  ORX: 'Орчета', SEL: 'Селья', GUA: 'Гуадалест', CSA: 'CSA',
};

let stops = [];            // [{cod, ds, town, lat, lon, lines[]}]
let lineColors = {};       // '010' -> '#FF0000'
let userPos = null;        // {lat, lon}
let currentStop = null;    // объект остановки
let refreshTimer = null;
let map, stopsLayer, busLayer, userMarker, selectedMarker;

const $ = (id) => document.getElementById(id);

/* ---------- утилиты ---------- */

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function fmtDist(m) {
  return m < 950 ? `${Math.round(m / 10) * 10} м` : `${(m / 1000).toFixed(1)} км`;
}

function normalize(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}

function cacheGet(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { t, v } = JSON.parse(raw);
    return Date.now() - t < CACHE_TTL ? v : null;
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

/* ---------- загрузка справочников ---------- */

function parseStop(p) {
  const m = p.ds.match(/^(.*?)\s*[-_]([A-Z]{2,4})\s*$/);
  const known = m && TOWN_CODES[m[2]];
  return {
    cod: p.cod,
    ds: known ? m[1] : p.ds.trim(),
    town: known || '',
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

/* ---------- карта ---------- */

function initMap() {
  map = L.map('map', { zoomControl: true }).setView([38.556, -0.083], 13);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  stopsLayer = L.layerGroup().addTo(map);
  busLayer = L.layerGroup().addTo(map);
}

function drawStops() {
  stopsLayer.clearLayers();
  for (const s of stops) {
    const marker = L.circleMarker([s.lat, s.lon], {
      radius: 6, weight: 2, color: '#d32f2f', fillColor: '#fff', fillOpacity: .9,
    });
    marker.bindTooltip(`${s.cod} · ${s.ds}`, { direction: 'top', offset: [0, -6] });
    marker.on('click', () => selectStop(s.cod));
    stopsLayer.addLayer(marker);
  }
}

function highlightStop(s) {
  if (selectedMarker) { map.removeLayer(selectedMarker); selectedMarker = null; }
  if (!s) return;
  selectedMarker = L.circleMarker([s.lat, s.lon], {
    radius: 10, weight: 3, color: '#1565c0', fillColor: '#42a5f5', fillOpacity: .9,
  }).addTo(map);
  map.setView([s.lat, s.lon], Math.max(map.getZoom(), 15));
}

function drawBuses(traficos) {
  busLayer.clearLayers();
  for (const t of traficos) {
    const lat = parseFloat(t.lat), lon = parseFloat(t.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const label = t.coLinea && t.coLinea !== '000' ? t.coLinea.replace(/^0+/, '') || t.coLinea : '🚌';
    const icon = L.divIcon({
      className: '',
      html: `<div class="bus-icon" style="background:${esc(lineColor(t.coLinea))};padding:2px 6px">🚌 ${esc(label)}</div>`,
      iconSize: null,
    });
    const m = L.marker([lat, lon], { icon, zIndexOffset: 1000 });
    m.bindTooltip(`Линия ${esc(t.coLinea)} → ${esc(t.dsDestino || '?')} · ${esc(t.quedan || '')}`);
    busLayer.addLayer(m);
  }
}

/* ---------- список остановок ---------- */

function renderStopsList(filter) {
  const list = $('stops-list');
  const q = normalize(filter || '');
  let items = stops;

  if (q) {
    items = stops.filter(s => normalize(s.ds).includes(q) || s.cod.startsWith(q) || normalize(s.town).includes(q));
  }
  if (userPos) {
    items = items.map(s => ({ ...s, dist: haversine(userPos.lat, userPos.lon, s.lat, s.lon) }))
                 .sort((a, b) => a.dist - b.dist);
  } else if (!q) {
    $('stops-hint').hidden = false;
    list.innerHTML = '';
    return;
  }
  $('stops-hint').hidden = true;

  list.innerHTML = items.slice(0, 30).map(s => `
    <li data-cod="${esc(s.cod)}">
      <span class="code">${esc(s.cod)}</span>
      <span class="name">${esc(s.ds)}${s.town ? ` <small>(${esc(s.town)})</small>` : ''}
        <span class="lines">Линии: ${s.lines.map(esc).join(', ') || '—'}</span>
      </span>
      ${s.dist != null ? `<span class="dist">${fmtDist(s.dist)}</span>` : ''}
    </li>`).join('');

  list.querySelectorAll('li').forEach(li =>
    li.addEventListener('click', () => selectStop(li.dataset.cod)));
}

function locate() {
  if (!navigator.geolocation) {
    $('stops-hint').textContent = 'Геолокация не поддерживается браузером.';
    return;
  }
  $('btn-locate').disabled = true;
  $('btn-locate').textContent = '📍 …';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      userPos = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      if (userMarker) map.removeLayer(userMarker);
      userMarker = L.circleMarker([userPos.lat, userPos.lon], {
        radius: 8, weight: 3, color: '#1565c0', fillColor: '#2196f3', fillOpacity: 1,
      }).addTo(map).bindTooltip('Вы здесь');
      map.setView([userPos.lat, userPos.lon], 15);
      $('btn-locate').disabled = false;
      $('btn-locate').textContent = '📍 Рядом';
      renderStopsList($('search').value);
    },
    (err) => {
      $('btn-locate').disabled = false;
      $('btn-locate').textContent = '📍 Рядом';
      $('stops-hint').hidden = false;
      $('stops-hint').textContent = 'Не удалось определить местоположение: ' + err.message;
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
  );
}

/* ---------- табло прибытий ---------- */

function selectStop(cod) {
  const s = stops.find(x => x.cod === String(cod));
  if (!s) return;
  currentStop = s;
  location.hash = '#/stop/' + s.cod;

  $('view-stops').hidden = true;
  $('view-arrivals').hidden = false;
  $('stop-name').textContent = s.ds + (s.town ? ` (${s.town})` : '');
  $('stop-code').textContent = '№ ' + s.cod;
  $('stop-lines').textContent = s.lines.length ? 'Линии: ' + s.lines.join(', ') : '';
  $('arrivals-table').hidden = true;
  $('arrivals-status').textContent = 'Загрузка…';

  highlightStop(s);
  scheduleRefresh(true);
}

function closeStop() {
  currentStop = null;
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
  if (!currentStop) return;
  if (now) refreshArrivals();
  refreshTimer = setTimeout(() => scheduleRefresh(true), REFRESH_MS);
}

async function refreshArrivals() {
  if (!currentStop) return;
  const stop = currentStop;
  $('btn-refresh').classList.add('spin');
  try {
    const data = await apiGet(`/lineas/getTraficosParada?empresa=${EMPRESA}&parada=${encodeURIComponent(stop.cod)}&find=`);
    if (currentStop !== stop) return; // пользователь уже ушёл на другую остановку
    const traficos = (data.traficos || []).slice()
      .sort((a, b) => (a.minres ?? 999) - (b.minres ?? 999));
    renderArrivals(traficos);
    drawBuses(traficos);
    $('arrivals-status').textContent =
      'Обновлено в ' + new Date().toLocaleTimeString('ru-RU') + ' · автообновление каждые 15 с';
  } catch (e) {
    if (currentStop !== stop) return;
    $('arrivals-status').textContent = 'Ошибка загрузки данных: ' + e.message + ' — повтор через 15 с';
  } finally {
    $('btn-refresh').classList.remove('spin');
  }
}

function renderArrivals(traficos) {
  const tbl = $('arrivals-table'), body = $('arrivals-body');
  if (!traficos.length) {
    tbl.hidden = true;
    $('arrivals-status').textContent = 'Пока нет автобусов в пути к этой остановке.';
    return;
  }
  body.innerHTML = traficos.map(t => {
    const arriving = t.minres != null && t.minres <= 0;
    const eta = arriving
      ? 'сейчас'
      : (t.quedan || (t.minres != null ? `${t.minres} мин` : '—')).replace(/\bmin\b/, 'мин');
    const abs = t.llegada ? t.llegada.slice(0, 5) : '';
    const line = t.coLinea === '000' ? '—' : t.coLinea;
    return `<tr>
      <td><span class="line-badge" style="background:${esc(lineColor(t.coLinea))}">${esc(line)}</span></td>
      <td><span class="eta${arriving ? ' now' : ''}">${esc(eta)}${abs ? `<span class="abs">${esc(abs)}</span>` : ''}</span></td>
      <td class="dest">${esc(t.dsDestino || t.dsLinea || '—')}</td>
    </tr>`;
  }).join('');
  tbl.hidden = false;
}

/* ---------- запуск ---------- */

function handleHash() {
  const m = location.hash.match(/^#\/stop\/(\w+)/);
  if (m) selectStop(m[1]);
  else if (currentStop) closeStop();
}

async function main() {
  initMap();
  $('btn-locate').addEventListener('click', locate);
  $('btn-back').addEventListener('click', closeStop);
  $('btn-refresh').addEventListener('click', () => scheduleRefresh(true));
  $('search').addEventListener('input', (e) => renderStopsList(e.target.value));
  window.addEventListener('hashchange', handleHash);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleRefresh(true);
    else clearTimeout(refreshTimer);
  });

  try {
    await Promise.all([loadStops(), loadLines()]);
  } catch (e) {
    $('stops-hint').textContent = 'Не удалось загрузить список остановок: ' + e.message;
    return;
  }
  drawStops();
  handleHash();
  if (!currentStop) locate();
}

main();
