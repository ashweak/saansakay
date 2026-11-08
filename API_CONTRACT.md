# SaanSakay API contract (backend: FastAPI on :8000, all JSON, prefix /api)

Discount values: "regular" | "student" | "senior" | "pwd"
Leg modes: "walk" | "jeep" | "bus" | "lrt1" | "lrt2" | "mrt3" | "pnr"

## GET /api/health -> {"ok": true, "ai": "gemini"|"rules", "stops": int, "routes": int}

## GET /api/places?q=cubao&limit=8
-> [{"name": "Araneta Center-Cubao LRT", "lat": 14.62, "lon": 121.05, "source": "stop"}]
(Local transit stops/landmarks. Frontend should ALSO query Nominatim
 https://nominatim.openstreetmap.org/search?format=json&countrycodes=ph&viewbox=120.90,14.80,121.15,14.35&bounded=1&q=...
 debounced >= 1s, and merge results.)

## POST /api/parse  {"text": "paano pumunta sa SM North galing Fairview", "lat": 14.6, "lon": 121.0}
-> {"origin": {"query": "Fairview"} | null,        // null => use current location
    "destination": {"query": "SM North"} | null,
    "preference": "fastest"|"cheapest"|"fewest_transfers"|null,
    "discount": "student"|... | null,
    "method": "gemini"|"rules"}
 If origin/destination query given, backend also returns resolved coords when it can:
    "origin": {"query": "...", "lat": ..., "lon": ..., "name": "..."} (lat/lon may be absent)

## POST /api/plan
{"origin": {"lat": 14.65, "lon": 121.03}, "destination": {"lat": 14.55, "lon": 121.02},
 "discount": "regular", "depart_hour": 8}          // depart_hour optional (0-23)
-> {"itineraries": [{
      "id": "a1", "label": "Fastest" | "Cheapest" | "Fewest transfers" (may be combined e.g. "Fastest · Cheapest"),
      "total_minutes": 52, "total_fare": 41.5, "transfers": 1, "walk_meters": 640,
      "legs": [{
          "mode": "walk"|"jeep"|..., "route_name": "Proj 6 Recto via Espana",
          "from": {"name": "...", "lat": .., "lon": ..}, "to": {"name": "...", "lat": .., "lon": ..},
          "distance_km": 3.2, "minutes": 14, "fare": 14.0, "fare_note": "₱14 first 4 km",
          "stops_count": 6, "instruction": "Sumakay ng jeep 'Proj 6 Recto via Espana' sa ... Bumaba sa ...",
          "geometry": [[lat, lon], ...]
      }]
   }],
   "warnings": ["..."], "fares_as_of": "2026-09-28"}

## GET /api/fares -> fare table config (modes, base, per_km, etc.) for display

## POST /api/fare/check {"mode": "jeep", "distance_km": 7.5, "discount": "student", "amount_paid": 25}
-> {"official_fare": 16.8, "difference": 8.2, "verdict": "overcharged"|"fair"|"undercharged",
    "message": "...Taglish explanation...", "breakdown": "₱14 + 4 km × ₱2 = ₱21 − 20% = ₱16.80"}

## POST /api/reports {"mode","route_name","distance_km","official_fare","amount_paid","note","lat","lon"} -> {"id": 1}
## GET  /api/reports -> [{id, mode, route_name, official_fare, amount_paid, note, created_at}] (latest 20)

## POST /api/eta/feedback {"predicted_minutes": 50, "actual_minutes": 63, "depart_hour": 8} -> {"ok": true, "factor": 1.21}
   (self-learning ETA: backend learns per-hour correction factor from finished trips)
