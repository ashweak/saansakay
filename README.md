<img src="frontend/public/logo.svg" width="72" alt="SaanSakay logo">

# SaanSakay — AI commute guide for Metro Manila

**"Saan ako sasakay?"** Ask in Taglish, get the jeep/bus/train combo, the **official fare**, and **live tracking with a "Para!" alert** before your stop. 100% free to run.

## Features
| | |
|---|---|
| 🗣️ **Taglish AI search** | "Paano pumunta sa SM North galing Fairview, student ako" → origin, destination, discount, preference. Gemini (free tier) when a key is set, rule-based parser otherwise. |
| 🧭 **Multimodal route planner** | Custom routing engine over 1,700+ jeep, bus, LRT-1/2, MRT-3 routes & 4,800+ stops. Returns *Fastest / Cheapest / Fewest transfers* options. |
| 💸 **Official fare calculator** | LTFRB fare matrix (effective Sept 28, 2026) + 20% PUV / 50% rail discounts for students, seniors and PWD, and the DOTr 50% LRT-2/MRT-3 promo. |
| 🚨 **Overcharge checker** | Enter what you paid → instant verdict with the computed breakdown, plus community reports. |
| 🛣️ **Road-snapped routes** | Stop-to-stop lines are map-matched onto OSM roads (free FOSSGIS OSRM), cached in SQLite, with a straight-line fallback. |
| 🗺️ **Custom vector map** | Warm, clean basemap (OpenFreeMap vector tiles, own MapLibre style) so routes stand out; automatic fallback to OSM raster. |
| 📍 **Live tracking + Para alert** | Gliding vehicle marker with heading (eased every animation frame), smooth camera follow with re-center, GPS progress along the route, remaining distance, ETA, vibration + sound + notification ~300 m before your stop. "Simulate ride" for demos. |
| 🧠 **Self-learning ETA** | Every finished trip sends predicted vs actual minutes; the backend learns a per-hour traffic correction (Bayesian-shrunk mean). |

## Architecture
```
React + Vite + Tailwind + Leaflet + MapLibre GL (OpenFreeMap vector tiles, Nominatim geocoding)
        │  /api
FastAPI ─┬─ ai.py        Taglish parser (Gemini JSON mode → rule-based fallback) + landmark resolver
         ├─ transit.py   GTFS loader → stop/vehicle state graph → multi-criteria Dijkstra
         │               (weights: minutes + transfer penalty + fare weight; traffic-aware speeds per hour)
         ├─ fares.py     LTFRB/DOTr fare rules (single source of truth, easy to update)
         └─ SQLite       fare reports, ETA feedback (learning)
```
**Routing engine:** each state is either *on foot at a stop* or *on a vehicle at position i of a route pattern*. Edges: walk access/egress (≤1 km, auto-extends), board (wait + transfer penalty + base fare × weight), ride (traffic-model minutes + per-km fare × weight), alight, short walking transfers (≤350 m). Several weight profiles + a diversity pass give real alternatives; dominated options are dropped. A query takes ~0.1–0.4 s.

## Run locally
```bash
# backend
cd backend && pip install -r requirements.txt
export GEMINI_API_KEY=...   # optional (free: aistudio.google.com)
uvicorn app.main:app --reload --port 8000
# frontend (new terminal)
cd frontend && npm install && npm run dev     # http://localhost:5173
```
Tests: `cd backend && pytest -q`

## Deploy free
**Render (free web service):** push to GitHub → New → Blueprint → pick this repo (`render.yaml` + `Dockerfile` build the frontend and serve everything from one container). Live GPS needs HTTPS, which Render provides.

## Data & accuracy
- Routes: DOTC/LTFRB GTFS published by Sakay.ph (2015) — used under its license for assisting public-transport riders. Some jeepney routes have changed and newer rail extensions (LRT-1 Cavite, LRT-2 East) aren't in it yet; PNR Metro Manila is excluded (suspended for NSCR works).
- Fares: `backend/app/fares.py`, as of 2026-09-28. Rail fares are distance-based estimates.

## Roadmap
- [ ] Local/provincial routes (crowd-sourced route drawing + AI validation)
- [ ] Rail extensions & modern jeep route rationalization data
- [ ] Learned travel-time model per corridor (gradient boosting on trip feedback)
- [ ] PWA offline mode
