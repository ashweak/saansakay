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
    ok = st["start_m"] < 200 and st["end_m"] < 200 and st["ratio"] < 1.8 and st["stops_near"] >= 0.8
    return ok, st


def _coords(pts):
    return ";".join(f"{lon:.6f},{lat:.6f}" for lat, lon in pts)


async def _route(client, base, wps, extra):
    """Return (geometry, per-leg road distances) or (None, None). Retries once on rate-limit."""
    for attempt in (0, 1):
        async with _sem:
            r = await client.get(f"{base}/route/v1/driving/{_coords(wps)}",
                                 params={"overview": "full", "geometries": "geojson", **extra}, headers=HEADERS)
        if r.status_code == 429 and attempt == 0:
            await asyncio.sleep(1.5)
            continue
        break
    if r.status_code == 400:      # NoRoute / NoSegment: a definitive "no"
        return None, None
    r.raise_for_status()          # 403/429/5xx: transient -> raises -> not cached
    d = r.json()
    if d.get("code") != "Ok" or not d.get("routes"):
        return None, None
    route = d["routes"][0]
    geom = [[lat, lon] for lon, lat in route["geometry"]["coordinates"]]
    return geom, [leg.get("distance", 0) for leg in route.get("legs", [])]


def _detour_waypoints(wps, leg_d, ratio=1.4, extra_m=110):
    """Interior waypoints that pull the route off its path (stop inside a gas station, on a
    side street, or on the opposite carriageway): both road legs touching them are much
    longer than the straight distance."""
    bad = []
    infl = []
    for i, d in enumerate(leg_d):
        straight = max(_hav(wps[i], wps[i + 1]), 25)
        infl.append(d > straight * ratio and d - straight > extra_m)
    for k in range(1, len(wps) - 1):
        if infl[k - 1] and infl[k]:
            bad.append(k)
    return bad


def _trim_end_spurs(geom, start, end, max_m=250):
    """Drop a dangling start/end hook: if the line passes closer to the stop again a bit
    later, start (or end) there instead of at the first (or last) snapped point."""
    def trim_front(g, p):
        best_i, best_d, run = 0, _hav(g[0], p), 0.0
        for i in range(1, len(g)):
            run += _hav(g[i - 1], g[i])
            if run > max_m:
                break
            d = _hav(g[i], p)
            if d < best_d - 5:
                best_i, best_d = i, d
        return g[best_i:]
    g = trim_front(geom, start)
    g = list(reversed(trim_front(list(reversed(g)), end)))
    return g if len(g) >= 2 else geom


async def _snap_chain(client, pts, max_rounds=3):
    """Route through thinned stops with direction (bearings) + curbside approach, then
    repeatedly drop detour-causing stops and re-route. Returns (geom|None, stats)."""
    wps = _thin(pts)
    removed = 0
    geom = None
    for _ in range(max_rounds):
        extra = {"bearings": _bearings(wps), "continue_straight": "true",
                 "approaches": ";".join(["unrestricted"] + ["curb"] * (len(wps) - 2) + ["unrestricted"]) if len(wps) > 2 else "unrestricted;unrestricted"}
        try:
            geom, leg_d = await _route(client, CAR, wps, extra)
        except httpx.HTTPStatusError as e:
            if e.response.status_code != 400:
                raise
            geom, leg_d = None, None
        if not geom:
            # curbside/bearing constraints can make a route impossible: retry without them once
            geom, leg_d = await _route(client, CAR, wps, {"continue_straight": "true"})
            if not geom:
                return None, {"removed": removed, "waypoints": len(wps)}
        bad = _detour_waypoints(wps, leg_d) if leg_d else []
        if not bad:
            break
        wps = [w for k, w in enumerate(wps) if k not in set(bad)]
        removed += len(bad)
    geom = _trim_end_spurs(_cut_loops(geom), pts[0], pts[-1])
    return geom, {"removed": removed, "waypoints": len(wps)}


def _chunks(pts, target_m=2500):
    """Split a long stop sequence into overlapping pieces of about target_m."""
    out, cur, run = [], [pts[0]], 0.0
    for a, b in zip(pts, pts[1:]):
        cur.append(b)
        run += _hav(a, b)
        if run >= target_m:
            out.append(cur)
            cur, run = [b], 0.0
    if len(cur) >= 2:
        if out and run < target_m * 0.35:
            out[-1] = out[-1] + cur[1:]   # merge a short tail into the previous piece
        else:
            out.append(cur)
    return out


async def compute(mode, pts, client):
    """Return (geometry|None, report)."""
    report = {}
    if mode == "walk":
        a, b = pts[0], pts[-1]
        straight = _hav(a, b)
        if straight < 120:
            report["foot"] = {"ok": False, "reason": "short walk: straight line"}
            return None, report
        g, _ = await _route(client, FOOT, [a, b], {})
        if g:
            g = _cut_loops(g)
        ok, st = _check(g or [], [a, b], walk=True)
        # a short walk that loops around (e.g. through a mall or across a divided road) is
        # clearer as a straight line than as a long detour
        if ok and straight < 400 and st.get("ratio", 9) > 1.7:
            ok, st["reason"] = False, "walk detour"
        report["foot"] = {**st, "ok": ok}
        return (g if ok else None), report

    # 1) whole leg in one go
    g, info = await _snap_chain(client, pts)
    ok, st = _check(g or [], pts)
    report["whole"] = {**st, **info, "ok": ok}
    if ok:
        return g, report

    # 2) piece by piece: keep every verified piece, straight lines only where a piece fails
    pieces = _chunks(pts)
    if len(pieces) > 12:
        return None, report
    out, good_m, total_m = [], 0.0, 0.0
    for piece in pieces:
        pg, _ = await _snap_chain(client, piece, max_rounds=2)
        pok, _ = _check(pg or [], piece)
        seg_len = _length(piece)
        total_m += seg_len
        if pok:
            good_m += seg_len
            seg = pg
        else:
            seg = piece
        out.extend(seg if not out else seg[1:])
    frac = good_m / max(total_m, 1)
    report["pieces"] = {"count": len(pieces), "snapped_fraction": round(frac, 2)}
    return (out if frac >= 0.5 else None), report


def _cache(db_path):
    con = sqlite3.connect(db_path)
    con.execute("CREATE TABLE IF NOT EXISTS snap_cache3(key TEXT PRIMARY KEY, geometry TEXT, ts REAL)")
    return con


async def snap(mode, points, db_path):
    pts = [[float(a), float(b)] for a, b in points if a is not None and b is not None]
    if len(pts) < 2 or mode in RAIL:
        return {"geometry": pts, "snapped": False}
    profile = "foot" if mode == "walk" else "car"
    key = hashlib.sha1((profile + json.dumps([[round(a, 5), round(b, 5)] for a, b in pts])).encode()).hexdigest()
    with _cache(db_path) as con:
        row = con.execute("SELECT geometry FROM snap_cache3 WHERE key=? AND (geometry != '[]' OR ts > ?)",
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
        con.execute("INSERT OR REPLACE INTO snap_cache3 VALUES(?,?,?)", (key, json.dumps(geom or []), time.time()))
    return {"geometry": geom or pts, "snapped": bool(geom)}
