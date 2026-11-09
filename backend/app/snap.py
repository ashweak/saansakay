"""Snap route lines to real roads with free OSRM servers (FOSSGIS routing.openstreetmap.de).

Transit data only gives stop coordinates, so lines drawn stop-to-stop cut through blocks.
For every leg we ask OSRM for a road route through (a thinned set of) its stops:

* each waypoint carries a *bearing* (direction of travel), so on divided roads such as
  EDSA, Quirino Hwy or Commonwealth the line uses the correct carriageway instead of
  looping around to the opposite side;
* leftover out-and-back spurs / U-turn loops are cut out of the geometry;
* a corridor check rejects anything that doesn't actually pass by the stops.

Results are cached in SQLite, and we fall back to the original straight lines whenever
the service is slow, rate-limited or returns something implausible.
"""
import asyncio, hashlib, json, math, os, sqlite3, time

import httpx

CAR = os.getenv("OSRM_CAR_URL", "https://routing.openstreetmap.de/routed-car")
FOOT = os.getenv("OSRM_FOOT_URL", "https://routing.openstreetmap.de/routed-foot")
HEADERS = {"User-Agent": "SaanSakay/1.0 (+https://github.com/ashweak/saansakay)"}
RAIL = {"lrt1", "lrt2", "mrt3"}
MAX_WAYPOINTS = 25
MIN_SPACING_M = 250
_sem = asyncio.Semaphore(2)  # be gentle with the free public server


def _hav(a, b):
    R = 6371000.0
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def _length(pts):
    return sum(_hav(a, b) for a, b in zip(pts, pts[1:]))


def _bearing(a, b):
    la1, la2 = math.radians(a[0]), math.radians(b[0])
    dl = math.radians(b[1] - a[1])
    x = math.sin(dl) * math.cos(la2)
    y = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(dl)
    return int((math.degrees(math.atan2(x, y)) + 360) % 360)


def _thin(pts):
    """Keep first/last stop, drop stops closer than MIN_SPACING_M, cap the waypoint count."""
    out = [pts[0]]
    for p in pts[1:-1]:
        if _hav(out[-1], p) >= MIN_SPACING_M:
            out.append(p)
    if _hav(out[-1], pts[-1]) < 60 and len(out) > 1:
        out.pop()
    out.append(pts[-1])
    if len(out) > MAX_WAYPOINTS:
        step = (len(out) - 1) / (MAX_WAYPOINTS - 1)
        out = [out[round(i * step)] for i in range(MAX_WAYPOINTS)]
    return out


def _bearings(wps):
    """Direction of travel at each waypoint (from the previous to the next stop)."""
    bs = []
    for i in range(len(wps)):
        a = wps[max(0, i - 1)]
        b = wps[min(len(wps) - 1, i + 1)]
        bs.append(f"{_bearing(a, b)},60")
    return ";".join(bs)


def _cut_loops(pts, max_loop_m=1500):
    """Remove out-and-back spurs and small U-turn loops (route revisits the same node)."""
    out, seen = [], {}
    for p in pts:
        k = (round(p[0], 5), round(p[1], 5))
        if k in seen:
            j = seen[k]
            if _length(out[j:] + [p]) <= max_loop_m:
                for q in out[j + 1:]:
                    seen.pop((round(q[0], 5), round(q[1], 5)), None)
                out = out[: j + 1]
                continue
        seen[k] = len(out)
        out.append(p)
    return out


def _dist_to_path(p, path):
    """Approx. distance (m) from point p to polyline path (equirectangular projection)."""
    k = math.cos(math.radians(p[0]))
    px, py = p[1] * k, p[0]
    best = 1e18
    for a, b in zip(path, path[1:]):
        ax, ay, bx, by = a[1] * k, a[0], b[1] * k, b[0]
        dx, dy = bx - ax, by - ay
        t = 0 if dx == dy == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
        cx, cy = ax + t * dx, ay + t * dy
        best = min(best, math.hypot(px - cx, py - cy))
    return best * 111320


def _check(snapped, stops, walk=False):
    """Return (ok, stats). Accept only lines that start/end at the leg and hug the stops."""
    if len(snapped) < 2:
        return False, {}
    straight = max(_length(stops), 30)
    st = {"ratio": round(_length(snapped) / straight, 2),
          "start_m": round(_hav(snapped[0], stops[0])), "end_m": round(_hav(snapped[-1], stops[-1]))}
    if walk:
        ok = st["start_m"] < 150 and st["end_m"] < 150 and (st["ratio"] < 4 or _length(snapped) < 600)
        return ok, st
    near = [_dist_to_path(p, snapped) for p in stops]
    st["stops_near"] = round(sum(d < 120 for d in near) / len(near), 2)
    ok = st["start_m"] < 200 and st["end_m"] < 200 and st["ratio"] < 1.9 and st["stops_near"] >= 0.85
    return ok, st


def _coords(pts):
    return ";".join(f"{lon:.6f},{lat:.6f}" for lat, lon in pts)


async def _route(client, base, wps, extra):
    async with _sem:
        r = await client.get(f"{base}/route/v1/driving/{_coords(wps)}",
                             params={"overview": "full", "geometries": "geojson", **extra}, headers=HEADERS)
    if r.status_code == 400:      # NoRoute / NoSegment: a definitive "no"
        return None
    r.raise_for_status()          # 403/429/5xx: transient -> raises -> not cached
    d = r.json()
    if d.get("code") != "Ok" or not d.get("routes"):
        return None
    return [[lat, lon] for lon, lat in d["routes"][0]["geometry"]["coordinates"]]


async def compute(mode, pts, client):
    """Try strategies in order; return (geometry|None, report)."""
    report = {}
    if mode == "walk":
        g = await _route(client, FOOT, [pts[0], pts[-1]], {})
        ok, st = _check(g or [], [pts[0], pts[-1]], walk=True)
        report["foot"] = {**st, "ok": ok}
        return (g if ok else None), report

    wps = _thin(pts)
    attempts = [
        ("bearings", wps, {"bearings": _bearings(wps), "continue_straight": "true"}),
        ("plain", wps, {"continue_straight": "true"}),
        ("ends", [pts[0], pts[-1]], {"bearings": _bearings([pts[0], pts[-1]])}),
    ]
    for name, w, extra in attempts:
        try:
            g = await _route(client, CAR, w, extra)
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 400:
                g = None
            else:
                raise
        if g:
            g = _cut_loops(g)
        ok, st = _check(g or [], pts)
        report[name] = {**st, "ok": ok, "waypoints": len(w)}
        if ok:
            return g, report
    return None, report


def _cache(db_path):
    con = sqlite3.connect(db_path)
    con.execute("CREATE TABLE IF NOT EXISTS snap_cache2(key TEXT PRIMARY KEY, geometry TEXT, ts REAL)")
    return con


async def snap(mode, points, db_path):
    pts = [[float(a), float(b)] for a, b in points if a is not None and b is not None]
    if len(pts) < 2 or mode in RAIL:
        return {"geometry": pts, "snapped": False}
    profile = "foot" if mode == "walk" else "car"
    key = hashlib.sha1((profile + json.dumps([[round(a, 5), round(b, 5)] for a, b in pts])).encode()).hexdigest()
    with _cache(db_path) as con:
        row = con.execute("SELECT geometry FROM snap_cache2 WHERE key=? AND (geometry != '[]' OR ts > ?)",
                          (key, time.time() - 6 * 3600)).fetchone()
    if row:
        g = json.loads(row[0])
        return {"geometry": g or pts, "snapped": bool(g)}
    try:
        async with httpx.AsyncClient(timeout=8) as c:
            geom, _ = await compute(mode, pts, c)
    except (httpx.HTTPError, ValueError, KeyError):
        return {"geometry": pts, "snapped": False}  # transient: don't cache, retry next time
    with _cache(db_path) as con:
        con.execute("INSERT OR REPLACE INTO snap_cache2 VALUES(?,?,?)", (key, json.dumps(geom or []), time.time()))
    return {"geometry": geom or pts, "snapped": bool(geom)}
