"""Snap route lines to real roads with free OSRM servers (FOSSGIS routing.openstreetmap.de).

Transit data only gives stop coordinates, so lines drawn stop-to-stop cut through blocks.
We map-match the stop sequence onto the OSM road network, cache the result in SQLite
(every route segment is fetched once, then served locally), and fall back to the
original straight lines whenever the service is slow, down, or returns something odd.
"""
import hashlib, json, math, os, sqlite3, time

import httpx

CAR = os.getenv("OSRM_CAR_URL", "https://routing.openstreetmap.de/routed-car")
FOOT = os.getenv("OSRM_FOOT_URL", "https://routing.openstreetmap.de/routed-foot")
HEADERS = {"User-Agent": "SaanSakay/1.0 (+https://github.com/ashweak/saansakay)"}
RAIL = {"lrt1", "lrt2", "mrt3"}
MAX_PTS = 40


def _hav(a, b):
    R = 6371000.0
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def _length(pts):
    return sum(_hav(a, b) for a, b in zip(pts, pts[1:]))


def _sample(pts, n=MAX_PTS):
    if len(pts) <= n:
        return pts
    step = (len(pts) - 1) / (n - 1)
    return [pts[round(i * step)] for i in range(n)]


def _plausible(snapped, original):
    """Reject results that wander far off (wrong-way detours, failed matches)."""
    if len(snapped) < 2:
        return False
    base = max(_length(original), 50)
    ratio = _length(snapped) / base
    ends_ok = _hav(snapped[0], original[0]) < 250 and _hav(snapped[-1], original[-1]) < 250
    return ratio < 2.2 and ends_ok


def _coords(pts):
    return ";".join(f"{lon:.6f},{lat:.6f}" for lat, lon in pts)


async def _osrm(client, base, service, pts, extra):
    url = f"{base}/{service}/v1/driving/{_coords(pts)}"
    r = await client.get(url, params={"overview": "full", "geometries": "geojson", **extra}, headers=HEADERS)
    if r.status_code == 400:      # e.g. NoSegment / too-far points: a definitive "no match"
        return None
    r.raise_for_status()          # 403/429/5xx: transient, raises -> not cached
    d = r.json()
    if d.get("code") != "Ok":
        return None
    parts = d.get("matchings") if service == "match" else d.get("routes", [])[:1]
    out = []
    for p in parts or []:
        out += [[lat, lon] for lon, lat in p["geometry"]["coordinates"]]
    return out or None


def _cache(db_path):
    con = sqlite3.connect(db_path)
    con.execute("CREATE TABLE IF NOT EXISTS snap_cache(key TEXT PRIMARY KEY, geometry TEXT, ts REAL DEFAULT 0)")
    return con


async def snap(mode, points, db_path):
    pts = [[float(a), float(b)] for a, b in points if a is not None and b is not None]
    if len(pts) < 2 or mode in RAIL:
        return {"geometry": pts, "snapped": False}
    profile = "foot" if mode == "walk" else "car"
    key = hashlib.sha1((profile + json.dumps([[round(a, 5), round(b, 5)] for a, b in pts])).encode()).hexdigest()
    with _cache(db_path) as con:
        row = con.execute("SELECT geometry FROM snap_cache WHERE key=? AND (geometry != '[]' OR ts > ?)",
                          (key, time.time() - 6 * 3600)).fetchone()
    if row:
        g = json.loads(row[0])
        return {"geometry": g or pts, "snapped": bool(g)}

    geom = None
    try:
        async with httpx.AsyncClient(timeout=6) as c:
            if profile == "foot":
                geom = await _osrm(c, FOOT, "route", [pts[0], pts[-1]], {})
            else:
                s = _sample(pts)
                # 1) map-match the stop sequence (tolerant of stops placed off the road)
                try:
                    geom = await _osrm(c, CAR, "match", s,
                                       {"radiuses": ";".join(["60"] * len(s)), "gaps": "ignore", "tidy": "true"})
                except httpx.HTTPError:
                    geom = None  # match service unavailable -> try plain routing
                if not (geom and _plausible(geom, pts)):
                    # 2) fall back to routing through the stops
                    geom = await _osrm(c, CAR, "route", s, {"continue_straight": "true"})
        if geom and not _plausible(geom, pts):
            geom = None
    except (httpx.HTTPError, ValueError, KeyError):
        return {"geometry": pts, "snapped": False}  # network trouble: don't cache, retry next time

    with _cache(db_path) as con:  # cache successes and definitive failures
        con.execute("INSERT OR REPLACE INTO snap_cache VALUES(?,?,?)", (key, json.dumps(geom or []), time.time()))
    return {"geometry": geom or pts, "snapped": bool(geom)}


async def diagnose():
    """Live check of the OSRM services (used to debug snapping on the deployed server)."""
    sample = [[14.73245, 121.05897], [14.72718, 121.05417], [14.72072, 121.04839], [14.71425, 121.04355]]
    out = {"car_url": CAR, "foot_url": FOOT}
    async with httpx.AsyncClient(timeout=8) as c:
        for name, base, svc, extra in [
            ("match", CAR, "match", {"radiuses": ";".join(["60"] * len(sample)), "gaps": "ignore", "tidy": "true"}),
            ("route", CAR, "route", {}),
            ("foot", FOOT, "route", {}),
        ]:
            url = f"{base}/{svc}/v1/driving/{_coords(sample if name != 'foot' else sample[:2])}"
            try:
                r = await c.get(url, params={"overview": "full", "geometries": "geojson", **extra}, headers=HEADERS)
                body = r.text[:300]
                info = {"status": r.status_code, "body": body if r.status_code != 200 else None}
                if r.status_code == 200:
                    d = r.json()
                    parts = d.get("matchings") if svc == "match" else d.get("routes", [])[:1]
                    pts = [[la, lo] for p in parts or [] for lo, la in p["geometry"]["coordinates"]]
                    info.update(code=d.get("code"), points=len(pts),
                                plausible=_plausible(pts, sample if name != "foot" else sample[:2]) if pts else False)
            except Exception as e:  # noqa: BLE001
                info = {"error": f"{type(e).__name__}: {e}"}
            out[name] = info
    return out
