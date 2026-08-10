/* Bus Radar localization: es, va (valencià), en, uk */
'use strict';

const FEEDBACK_EMAIL = 'vladcherry+busradar@gmail.com';

/* All flags are inline SVG: emoji flags do not render on Windows (fall back to letter codes) */
const FLAG_BODIES = {
  es: `<rect width="30" height="20" fill="#AA151B"/>
       <rect y="5" width="30" height="10" fill="#F1BF00"/>`,
  va: `<rect width="30" height="20" fill="#FCDD09"/>
       <rect y="2.2" width="30" height="2.2" fill="#DA121A"/>
       <rect y="6.6" width="30" height="2.2" fill="#DA121A"/>
       <rect y="11" width="30" height="2.2" fill="#DA121A"/>
       <rect y="15.4" width="30" height="2.2" fill="#DA121A"/>
       <rect width="7.5" height="20" fill="#0F47AF"/>`,
  en: `<rect width="30" height="20" fill="#012169"/>
       <path d="M0,0 L30,20 M30,0 L0,20" stroke="#fff" stroke-width="4"/>
       <path d="M0,0 L30,20 M30,0 L0,20" stroke="#C8102E" stroke-width="1.8"/>
       <path d="M15,0 V20 M0,10 H30" stroke="#fff" stroke-width="6.5"/>
       <path d="M15,0 V20 M0,10 H30" stroke="#C8102E" stroke-width="3.8"/>`,
  uk: `<rect width="30" height="10" fill="#0057B7"/>
       <rect y="10" width="30" height="10" fill="#FFD700"/>`,
};

const LANGS = {
  es: { name: 'Español' },
  va: { name: 'Valencià' },
  en: { name: 'English' },
  uk: { name: 'Українська' },
};

function langFlag(code) {
  return `<svg viewBox="0 0 30 20" width="1.15em" height=".78em" style="vertical-align:-.05em;border-radius:2px">${FLAG_BODIES[code]}</svg>`;
}

const TOWN_NAMES = {
  BND: { latin: 'Benidorm', uk: 'Бенідорм' },
  VIL: { latin: 'La Vila Joiosa', uk: 'Ла-Віла-Жойоза' },
  FIN: { latin: 'Finestrat', uk: 'Фінестрат' },
  NUC: { latin: 'La Nucía', uk: 'Ла-Нусія' },
  ALT: { latin: 'Altea', uk: 'Альтеа' },
  ALF: { latin: "l'Alfàs del Pi / Albir", uk: 'Альфас-дель-Пі / Альбір' },
  POL: { latin: 'Polop', uk: 'Полоп' },
  REL: { latin: 'Relleu', uk: 'Рельєу' },
  ORX: { latin: 'Orxeta', uk: 'Орчета' },
  SEL: { latin: 'Sella', uk: 'Селья' },
  GUA: { latin: 'El Castell de Guadalest', uk: 'Гуадалест' },
  CSA: { latin: 'CSA', uk: 'CSA' },
};

const I18N = {
  es: {
    near: '📍 Cerca de mí',
    searchPlaceholder: 'Buscar parada: nombre o número…',
    hintStart: 'Pulsa «📍 Cerca de mí», elige una parada en el mapa o búscala por su nombre.',
    geoUnsupported: 'La geolocalización no está disponible en este navegador.',
    geoFail: 'No se pudo obtener tu ubicación: ',
    youAreHere: 'Estás aquí',
    lines: 'Líneas',
    back: '‹ Paradas',
    refresh: 'Actualizar',
    loading: 'Cargando…',
    updatedAt: (t) => `Actualizado a las ${t}`,
    loadError: (e) => `Error al cargar datos: ${e} — reintento en 15 s`,
    stopsLoadError: 'No se pudieron cargar las paradas: ',
    noBuses: 'Ahora mismo no hay autobuses en camino a esta parada.',
    thLine: 'Línea', thEta: 'Llega', thDest: 'Sentido',
    now: 'ya', min: 'min', m: 'm', km: 'km',
    stopNo: 'Parada',
    favorites: 'Paradas favoritas',
    favAdd: 'Añadir a favoritas',
    favRemove: 'Quitar de favoritas',
    feedback: 'Comentarios',
    credits: 'Datos: {link} · aplicación no oficial · {feedback}',
    busTitle: (line) => `Bus · línea ${line}`,
    upcomingStops: 'Próximas paradas',
    noRouteData: 'No hay datos del recorrido de esta línea.',
    backToBoard: '‹ Panel de llegadas',
    thTime: 'Hora prevista',
  },
  va: {
    near: '📍 Prop de mi',
    searchPlaceholder: 'Busca la parada: nom o número…',
    hintStart: 'Prem «📍 Prop de mi», tria una parada al mapa o busca-la pel nom.',
    geoUnsupported: 'La geolocalització no està disponible en este navegador.',
    geoFail: "No s'ha pogut obtindre la teua ubicació: ",
    youAreHere: 'Estàs ací',
    lines: 'Línies',
    back: '‹ Parades',
    refresh: 'Actualitza',
    loading: 'Carregant…',
    updatedAt: (t) => `Actualitzat a les ${t}`,
    loadError: (e) => `Error en carregar les dades: ${e} — es reintentarà en 15 s`,
    stopsLoadError: "No s'han pogut carregar les parades: ",
    noBuses: 'Ara mateix no hi ha autobusos en camí cap a esta parada.',
    thLine: 'Línia', thEta: 'Arriba', thDest: 'Sentit',
    now: 'ja', min: 'min', m: 'm', km: 'km',
    stopNo: 'Parada',
    favorites: 'Parades preferides',
    favAdd: 'Afig a preferides',
    favRemove: 'Lleva de preferides',
    feedback: 'Comentaris',
    credits: "Dades: {link} · aplicació no oficial · {feedback}",
    busTitle: (line) => `Bus · línia ${line}`,
    upcomingStops: 'Pròximes parades',
    noRouteData: "No hi ha dades del recorregut d'esta línia.",
    backToBoard: "‹ Panell d'arribades",
    thTime: 'Hora prevista',
  },
  en: {
    near: '📍 Near me',
    searchPlaceholder: 'Find a stop: name or number…',
    hintStart: 'Tap “📍 Near me”, pick a stop on the map, or search by name.',
    geoUnsupported: 'Geolocation is not supported by this browser.',
    geoFail: 'Could not get your location: ',
    youAreHere: 'You are here',
    lines: 'Lines',
    back: '‹ Stops',
    refresh: 'Refresh',
    loading: 'Loading…',
    updatedAt: (t) => `Updated at ${t}`,
    loadError: (e) => `Failed to load data: ${e} — retrying in 15 s`,
    stopsLoadError: 'Could not load the stop list: ',
    noBuses: 'No buses on the way to this stop right now.',
    thLine: 'Line', thEta: 'Arrives', thDest: 'Direction',
    now: 'now', min: 'min', m: 'm', km: 'km',
    stopNo: 'Stop',
    favorites: 'Favourite stops',
    favAdd: 'Add to favourites',
    favRemove: 'Remove from favourites',
    feedback: 'Feedback',
    credits: 'Data: {link} · unofficial app · {feedback}',
    busTitle: (line) => `Bus · line ${line}`,
    upcomingStops: 'Upcoming stops',
    noRouteData: 'No route data available for this line.',
    backToBoard: '‹ Arrivals board',
    thTime: 'Expected time',
  },
  uk: {
    near: '📍 Поруч',
    searchPlaceholder: 'Пошук зупинки: назва або номер…',
    hintStart: 'Натисніть «📍 Поруч», оберіть зупинку на мапі або знайдіть її за назвою.',
    geoUnsupported: 'Геолокація не підтримується цим браузером.',
    geoFail: 'Не вдалося визначити місцезнаходження: ',
    youAreHere: 'Ви тут',
    lines: 'Лінії',
    back: '‹ Зупинки',
    refresh: 'Оновити',
    loading: 'Завантаження…',
    updatedAt: (t) => `Оновлено о ${t}`,
    loadError: (e) => `Помилка завантаження даних: ${e} — повтор за 15 с`,
    stopsLoadError: 'Не вдалося завантажити список зупинок: ',
    noBuses: 'Поки немає автобусів у дорозі до цієї зупинки.',
    thLine: 'Лінія', thEta: 'Прибуття', thDest: 'Напрямок',
    now: 'зараз', min: 'хв', m: 'м', km: 'км',
    stopNo: 'Зупинка',
    favorites: 'Улюблені зупинки',
    favAdd: 'Додати до улюблених',
    favRemove: 'Прибрати з улюблених',
    feedback: 'Зворотний зв’язок',
    credits: 'Дані: {link} · неофіційний застосунок · {feedback}',
    busTitle: (line) => `Автобус · лінія ${line}`,
    upcomingStops: 'Наступні зупинки',
    noRouteData: 'Немає даних про маршрут цієї лінії.',
    backToBoard: '‹ Табло прибуттів',
    thTime: 'Очікуваний час',
  },
};

function detectLang() {
  const saved = localStorage.getItem('busradar_lang');
  if (saved && I18N[saved]) return saved;
  for (const raw of navigator.languages || [navigator.language || 'en']) {
    const l = raw.toLowerCase();
    if (l.startsWith('uk') || l.startsWith('ru')) return 'uk';
    if (l.startsWith('ca')) return 'va'; // Catalan/Valencian
    if (l.startsWith('es')) return 'es';
    if (l.startsWith('en')) return 'en';
  }
  return 'en';
}
