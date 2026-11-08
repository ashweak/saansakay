"""GTFS loader + multimodal routing engine (multi-criteria Dijkstra over stop/vehicle states)."""
import csv, heapq, math, os, pickle
from collections import defaultdict

from . import fares as F

DATA = os.path.join(os.path.dirname(__file__), "..", "data", "gtfs")
CACHE = os.path.join(os.path.dirname(__file__), "..", "data", "network.pkl")

WALK_KMH = 4.5
WALK_DETOUR = 1.25
ROAD_DETOUR = 1.15          # stop-to-stop straight line -> road distance
TRANSFER_WALK_M = 350       # max walk between stops for a transfer
ACCESS_M = 1000             # max walk from origin / to destination (auto-extends)
WAIT_MIN = {"jeep": 4, "bus": 7, "lrt1": 4, "lrt2": 5, "mrt3": 4}
RAIL = {"lrt1", "lrt2", "mrt3"}


def hav_m(lat1, lon1, lat2, lon2):
    R = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def road_kmh(mode, hour):
    """Traffic-aware speed model for Metro Manila road modes (km/h)."""
    if hour is None:
        hour = 12
    peak = hour in (6, 7, 8, 9, 17, 18, 19, 20)
    night = hour >= 22 or hour <= 4
    if mode == "bus":
        return 13 if peak else (28 if night else 18)
    return 11 if peak else (24 if night else 16)   # jeep


def route_mode(route_id, short):
    s = (short or "").upper()
    if s == "LRT 1": return "lrt1"
    if s == "LRT 2": return "lrt2"
    if s.startswith("MRT"): return "mrt3"
    if s == "PNR": return None              # PNR Metro Manila ops suspended for NSCR works
    if "PUJ" in route_id: return "jeep"
    return "bus"


class Network:
    def __init__(self):
        self.stop_name, self.stop_lat, self.stop_lon = [], [], []
        self.patterns = []   # dict(route_name, mode, stops[list idx], cum_km[list])
        self.boardings = []  # per stop: list of (pattern, pos)
        self.walk_nb = []    # per stop: list of (stop, meters)
        self.grid = defaultdict(list)

    # ---------- build ----------
    @classmethod
    def load(cls):
        if os.path.exists(CACHE):
            with open(CACHE, "rb") as f:
                return pickle.load(f)
        net = cls()
        net._build()
        with open(CACHE, "wb") as f:
            pickle.dump(net, f)
        return net

    def _build(self):
        rd = lambda n: csv.DictReader(open(os.path.join(DATA, n), encoding="utf-8-sig"))
        routes = {}
        for r in rd("routes.txt"):
            m = route_mode(r["route_id"], r["route_short_name"])
            if m:
                name = r["route_long_name"].strip() or r["route_short_name"]
                if m in RAIL:
                    name = {"lrt1": "LRT-1", "lrt2": "LRT-2", "mrt3": "MRT-3"}[m] + f" ({name})"
                routes[r["route_id"]] = (name, m)
        trip_route = {t["trip_id"]: t["route_id"] for t in rd("trips.txt") if t["route_id"] in routes}
        seqs = defaultdict(list)
        for st in rd("stop_times.txt"):
            if st["trip_id"] in trip_route:
                seqs[st["trip_id"]].append((int(st["stop_sequence"]), st["stop_id"]))
        raw = {s["stop_id"]: s for s in rd("stops.txt")}
        sid_idx = {}

        def idx(sid):
            if sid not in sid_idx:
                s = raw[sid]
                sid_idx[sid] = len(self.stop_name)
                self.stop_name.append(s["stop_name"].strip())
                self.stop_lat.append(float(s["stop_lat"]))
                self.stop_lon.append(float(s["stop_lon"]))
            return sid_idx[sid]

        seen = set()
        for tid, lst in seqs.items():
            lst.sort()
            stops = [idx(sid) for _, sid in lst if sid in raw]
            # drop consecutive duplicates
            stops = [s for i, s in enumerate(stops) if i == 0 or s != stops[i - 1]]
            if len(stops) < 2:
                continue
            key = (trip_route[tid], tuple(stops))
            if key in seen:
                continue
            seen.add(key)
            name, mode = routes[trip_route[tid]]
            cum = [0.0]
            for a, b in zip(stops, stops[1:]):
                cum.append(cum[-1] + hav_m(self.stop_lat[a], self.stop_lon[a], self.stop_lat[b], self.stop_lon[b]) / 1000)
            self.patterns.append({"route_name": name, "mode": mode, "stops": stops, "cum_km": cum})

        n = len(self.stop_name)
        self.boardings = [[] for _ in range(n)]
        for p, pat in enumerate(self.patterns):
            for i, s in enumerate(pat["stops"][:-1]):
                self.boardings[s].append((p, i))
        for s in range(n):
            self.grid[self._cell(self.stop_lat[s], self.stop_lon[s])].append(s)
        self.walk_nb = [[(t, d) for t, d in self.near(self.stop_lat[s], self.stop_lon[s], TRANSFER_WALK_M) if t != s]
                        for s in range(n)]
        self.vbase, off = [], n
        for pat in self.patterns:
            self.vbase.append(off)
            off += len(pat["stops"])
        self.n_states = off

    @staticmethod
    def _cell(lat, lon):
        return (int(lat / 0.01), int(lon / 0.01))

    def near(self, lat, lon, radius_m):
        r = int(radius_m / 1100) + 1
        cy, cx = self._cell(lat, lon)
        out = []
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                for s in self.grid.get((cy + dy, cx + dx), ()):
                    d = hav_m(lat, lon, self.stop_lat[s], self.stop_lon[s])
                    if d <= radius_m:
                        out.append((s, d))
        return out

    # ---------- search ----------
    def search_stops(self, q, limit=8):
        q = q.lower().strip()
        if len(q) < 2:
            return []
        seen, out = set(), []
        for i, name in enumerate(self.stop_name):
            ln = name.lower()
            if q in ln and ln not in seen:
                seen.add(ln)
                score = (0 if ln.startswith(q) else 1, any(k in ln for k in ("lrt", "mrt")) is False, len(ln))
                out.append((score, {"name": name, "lat": self.stop_lat[i], "lon": self.stop_lon[i], "source": "stop"}))
        out.sort(key=lambda x: x[0])
        return [o for _, o in out[:limit]]

    def _ride_min(self, mode, km, nstops, hour, factor):
        if mode in RAIL:
            return km / 32 * 60 + 0.4 * nstops
        return km * ROAD_DETOUR / road_kmh(mode, hour) * 60 * factor

    def _dijkstra(self, olat, olon, dlat, dlon, hour, factor, tp, fw, penal=frozenset()):
        S = len(self.stop_name)
        DEST, ORIG = self.n_states, self.n_states + 1
        walk_min = lambda m: m * WALK_DETOUR / 1000 / WALK_KMH * 60
        WALK_W = 1.4  # walking feels longer than riding

        radius = ACCESS_M
        while True:
            o_acc = self.near(olat, olon, radius)
            d_acc = {s: d for s, d in self.near(dlat, dlon, radius)}
            if (o_acc and d_acc) or radius >= 3000:
                break
            radius += 500
        dist = {ORIG: 0.0}
        prev = {}
        pq = [(0.0, ORIG)]
        direct = hav_m(olat, olon, dlat, dlon)
        if direct <= 2000:
            dist[DEST] = walk_min(direct) * WALK_W
            prev[DEST] = ORIG
            heapq.heappush(pq, (dist[DEST], DEST))
        for s, d in o_acc:
            c = walk_min(d) * WALK_W
            if c < dist.get(s, 1e18):
                dist[s], prev[s] = c, ORIG
                heapq.heappush(pq, (c, s))
        while pq:
            c, u = heapq.heappop(pq)
            if c > dist.get(u, 1e18):
                continue
            if u == DEST:
                break

            def relax(v, w):
                nc = c + w
                if nc < dist.get(v, 1e18):
                    dist[v], prev[v] = nc, u
                    heapq.heappush(pq, (nc, v))

            if u < S:  # on foot at stop
                if u in d_acc:
                    relax(DEST, walk_min(d_acc[u]) * WALK_W)
                for p, i in self.boardings[u]:
                    pat = self.patterns[p]
                    m = pat["mode"]
                    base = F.FARES[m]["boarding"] if m in RAIL else F.FARES[m]["base"]
                    relax(self.vbase[p] + i, WAIT_MIN[m] + tp + fw * base)
                if not (prev.get(u, -1) < S):  # only walk-transfer right after alighting / from origin
                    for t, d in self.walk_nb[u]:
                        relax(t, walk_min(d) * WALK_W)
            elif u < DEST:  # on vehicle
                p = self._pat_of(u)
                i = u - self.vbase[p]
                pat = self.patterns[p]
                stops = pat["stops"]
                if i + 1 < len(stops):
                    km = pat["cum_km"][i + 1] - pat["cum_km"][i]
                    w = self._ride_min(pat["mode"], km, 1, hour, factor)
                    if p in penal:
                        w *= 1.8
                    pkm = 0 if pat["mode"] in RAIL else F.FARES[pat["mode"]]["per_km"]
                    relax(u + 1, w + fw * pkm * km * 0.6)
                relax(stops[i], 0.0)  # alight
        if DEST not in prev:
            return None
        path, x = [], DEST
        while x != ORIG:
            path.append(x)
            x = prev[x]
        path.reverse()
        return path

    def _pat_of(self, state):
        import bisect
        return bisect.bisect_right(self.vbase, state) - 1

    def _build_itinerary(self, path, olat, olon, dlat, dlon, discount, hour, factor):
        S = len(self.stop_name)
        DEST = self.n_states
        pt = lambda s: {"name": self.stop_name[s], "lat": self.stop_lat[s], "lon": self.stop_lon[s]}
        origin = {"name": "Your location", "lat": olat, "lon": olon}
        dest = {"name": "Destination", "lat": dlat, "lon": dlon}
        legs, cur = [], origin
        k = 0
        while k < len(path):
            u = path[k]
            if u == DEST:
                legs.append(self._walk(cur, dest)); break
            if u < S:
                # walking to a stop (or transfer)
                nxt = path[k + 1] if k + 1 < len(path) else None
                if nxt is not None and S <= nxt < DEST:
                    if (cur["lat"], cur["lon"]) != (self.stop_lat[u], self.stop_lon[u]):
                        legs.append(self._walk(cur, pt(u)))
                    cur = pt(u)
                k += 1; continue
            # ride: collect consecutive vehicle states of same pattern
            p = self._pat_of(u)
            i0 = u - self.vbase[p]
            j = k
            while j + 1 < len(path) and S <= path[j + 1] < DEST and self._pat_of(path[j + 1]) == p:
                j += 1
            i1 = path[j] - self.vbase[p]
            legs.append(self._ride(p, i0, i1, discount, hour, factor))
            cur = pt(self.patterns[p]["stops"][i1])
            k = j + 1
        # merge consecutive walks, drop tiny walks
        merged = []
        for l in legs:
            if l["mode"] == "walk" and merged and merged[-1]["mode"] == "walk":
                a = merged[-1]
                l = self._walk(a["from"], l["to"])
                merged[-1] = l
            else:
                merged.append(l)
        merged = [l for l in merged if not (l["mode"] == "walk" and l["distance_km"] < 0.03)]
        rides = [l for l in merged if l["mode"] != "walk"]
        if not rides and hav_m(olat, olon, dlat, dlon) > 2000:
            return None
        return {
            "total_minutes": round(sum(l["minutes"] for l in merged)),
            "total_fare": round(sum(l["fare"] for l in merged), 2),
            "transfers": max(0, len(rides) - 1),
            "walk_meters": round(sum(l["distance_km"] for l in merged if l["mode"] == "walk") * 1000),
            "legs": merged,
        }

    def _walk(self, a, b):
        m = hav_m(a["lat"], a["lon"], b["lat"], b["lon"]) * WALK_DETOUR
        to = b["name"] if b["name"] not in ("Destination",) else "your destination"
        return {"mode": "walk", "route_name": "Walk", "from": a, "to": b,
                "distance_km": round(m / 1000, 2), "minutes": round(m / 1000 / WALK_KMH * 60, 1),
                "fare": 0.0, "fare_note": "", "stops_count": 0,
                "instruction": f"Maglakad papunta sa {to} (~{round(m)} m)",
                "geometry": [[a["lat"], a["lon"]], [b["lat"], b["lon"]]]}

    def _ride(self, p, i0, i1, discount, hour, factor):
        pat = self.patterns[p]
        m = pat["mode"]
        stops = pat["stops"][i0:i1 + 1]
        km = pat["cum_km"][i1] - pat["cum_km"][i0]
        road_km = km if m in RAIL else km * ROAD_DETOUR
        f = F.compute(m, road_km, discount)
        mins = WAIT_MIN[m] + self._ride_min(m, km, len(stops) - 1, hour, factor)
        a, b = stops[0], stops[-1]
        vehicle = {"jeep": "jeep", "bus": "bus"}.get(m, "tren")
        note = f["breakdown"]
        if m == "jeep":
            alt = F.compute("jeep_modern", road_km, discount)["fare"]
            note += f" · Modern jeep: ₱{alt:.2f}"
        elif m == "bus":
            alt = F.compute("bus_ordinary", road_km, discount)["fare"]
            note += f" · Ordinary bus: ₱{alt:.2f}"
        return {"mode": m, "route_name": pat["route_name"],
                "from": {"name": self.stop_name[a], "lat": self.stop_lat[a], "lon": self.stop_lon[a]},
                "to": {"name": self.stop_name[b], "lat": self.stop_lat[b], "lon": self.stop_lon[b]},
                "distance_km": round(road_km, 2), "minutes": round(mins, 1), "fare": f["fare"],
                "fare_note": note, "stops_count": len(stops) - 1,
                "instruction": (f"Sumakay ng {vehicle} “{pat['route_name']}” sa {self.stop_name[a]}. "
                                f"Bumaba sa {self.stop_name[b]} ({len(stops) - 1} stops, ~{road_km:.1f} km)."),
                "geometry": [[self.stop_lat[s], self.stop_lon[s]] for s in stops]}

    def plan(self, olat, olon, dlat, dlon, discount="regular", hour=None, factor=1.0):
        profiles = [("fastest", 4, 0.0, False), ("cheapest", 3, 1.2, False),
                    ("fewest", 22, 0.0, False), ("alt", 4, 0.0, True)]
        its, seen, first_pats = [], set(), frozenset()
        for name, tp, fw, use_pen in profiles:
            path = self._dijkstra(olat, olon, dlat, dlon, hour, factor, tp, fw, first_pats if use_pen else frozenset())
            if not path:
                continue
            if name == "fastest":
                first_pats = frozenset(self._pat_of(s) for s in path if len(self.stop_name) <= s < self.n_states)
            it = self._build_itinerary(path, olat, olon, dlat, dlon, discount, hour, factor)
            if not it:
                continue
            key = tuple(l["route_name"] for l in it["legs"] if l["mode"] != "walk")
            if key in seen:
                continue
            seen.add(key)
            its.append(it)
        if not its:
            return []
        # drop dominated options (no better on time, fare or transfers)
        def dominated(a, b):
            return (b["total_minutes"] <= a["total_minutes"] and b["total_fare"] <= a["total_fare"]
                    and b["transfers"] <= a["transfers"] and b is not a and
                    (b["total_minutes"], b["total_fare"], b["transfers"]) != (a["total_minutes"], a["total_fare"], a["transfers"]))
        its = [a for a in its if not any(dominated(a, b) for b in its)]
        best_t = min(i["total_minutes"] for i in its)
        best_f = min(i["total_fare"] for i in its)
        best_x = min(i["transfers"] for i in its)
        for n, it in enumerate(its):
            labels = []
            if it["total_minutes"] == best_t: labels.append("Fastest")
            if it["total_fare"] == best_f: labels.append("Cheapest")
            fastest_x = min(its, key=lambda i: i["total_minutes"])["transfers"]
            if it["transfers"] == best_x and best_x < fastest_x: labels.append("Fewest transfers")
            it["label"] = " · ".join(labels) or "Alternative"
            it["id"] = f"r{n + 1}"
        its.sort(key=lambda i: i["total_minutes"])
        return its
