# 🚌 Bus Radar — Altea · Albir · Benidorm

An unofficial web app that shows **in real time** where the
[Avanza Grupo](https://consultas.avanzagrupo.com) (Llorente Bus Benidorm) buses are
and when they arrive at a chosen stop. Coverage: Altea — Albir — Benidorm
(plus Finestrat, La Vila Joiosa, La Nucía and nearby towns).

**Live:** https://vladcherry.github.io/bus-radar/

## Features

- 📍 Nearest stops via geolocation
- 🔎 Stop search by name or number
- 🗺 Map of all stops (Leaflet + OpenStreetMap)
- ⏱ Real-time arrivals board, auto-refreshing every 15 seconds
- 🚌 Live positions of approaching buses on the map
- 🌐 4 languages (Español, Valencià, English, Українська) — auto-detected
  from the browser locale, switchable via the flag menu, choice saved in `localStorage`
- 🔗 Shareable stop links: `#/stop/510`

## How it works

The app is fully static (HTML + CSS + vanilla JS) and talks directly to the public
Avanza API (`apisvt.avanzagrupo.com`, CORS is open):

| Endpoint | Returns |
|---|---|
| `GET /lineas/getParadas?empresa=5` | all stops: code, name, coordinates, lines |
| `GET /lineas/getTraficosParada?empresa=5&parada=<code>` | arrivals + live bus coordinates |
| `GET /lineas/getLineas?empresa=5&N=1` | line list with colors |

`empresa=5` is the Benidorm operator code in the Avanza system. The stop and line
lists are cached in `localStorage` for 24 hours.

## Run locally

Any static file server works, e.g.:

```bash
python -m http.server 8000
```

then open http://localhost:8000

## Deployment

Hosted on GitHub Pages from the `gh-pages` branch. Every push to `main` triggers
a workflow ([.github/workflows/pages.yml](.github/workflows/pages.yml)) that
publishes the repository content to `gh-pages`.

## Disclaimer

This is an unofficial project, not affiliated with Avanza Grupo. All data comes
from the Avanza Grupo API; arrival time accuracy depends on the operator's data.
