import os, sqlite3, time
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import ai, fares as F
from .transit import Network

BASE = os.path.dirname(os.path.dirname(__file__))
DB = os.getenv("DB_PATH", os.path.join(BASE, "data", "saansakay.db"))
STATIC = os.path.join(BASE, "static")

app = FastAPI(title="SaanSakay API", version="1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
net = Network.load()


def db():
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    con.execute("""CREATE TABLE IF NOT EXISTS reports(id INTEGER PRIMARY KEY, mode TEXT, route_name TEXT,
        distance_km REAL, official_fare REAL, amount_paid REAL, note TEXT, lat REAL, lon REAL, created_at REAL)""")
    con.execute("""CREATE TABLE IF NOT EXISTS eta_feedback(id INTEGER PRIMARY KEY, hour INTEGER,
        predicted REAL, actual REAL, created_at REAL)""")
    return con


def eta_factor(hour: Optional[int]) -> float:
    """Self-learning ETA correction: weighted mean of actual/predicted for this hour (±1h), shrunk toward 1."""
    if hour is None:
        return 1.0
    with db() as con:
        rows = con.execute("SELECT predicted, actual FROM eta_feedback WHERE hour IN (?,?,?) "
                           "AND predicted > 0 ORDER BY id DESC LIMIT 200",
                           ((hour - 1) % 24, hour, (hour + 1) % 24)).fetchall()
    if not rows:
        return 1.0
    ratios = [min(3.0, max(0.33, r["actual"] / r["predicted"])) for r in rows]
    k = 5  # prior strength
    return round((sum(ratios) + k * 1.0) / (len(ratios) + k), 3)


class Pt(BaseModel):
    lat: float
    lon: float


class PlanReq(BaseModel):
    origin: Pt
    destination: Pt
    discount: str = "regular"
    depart_hour: Optional[int] = Field(None, ge=0, le=23)


class ParseReq(BaseModel):
    text: str
    lat: Optional[float] = None
    lon: Optional[float] = None


class FareCheckReq(BaseModel):
    mode: str
    distance_km: float = Field(ge=0, le=200)
    discount: str = "regular"
    amount_paid: float = Field(ge=0, le=5000)


class ReportReq(BaseModel):
    mode: str
    route_name: str = ""
    distance_km: float = 0
    official_fare: float = 0
    amount_paid: float = 0
    note: str = Field("", max_length=500)
    lat: Optional[float] = None
    lon: Optional[float] = None


class EtaReq(BaseModel):
    predicted_minutes: float = Field(gt=0)
    actual_minutes: float = Field(gt=0)
    depart_hour: int = Field(ge=0, le=23)


@app.get("/api/health")
def health():
    return {"ok": True, "ai": "gemini" if ai.GEMINI_KEY else "rules",
            "stops": len(net.stop_name), "routes": len(net.patterns)}


@app.get("/api/places")
def places(q: str, limit: int = 8):
    out = []
    ql = q.lower().strip()
    for k, (la, lo) in ai.LANDMARKS.items():
        if ql and ql in k:
            out.append({"name": ai.nice(k), "lat": la, "lon": lo, "source": "landmark"})
    return (out + net.search_stops(q, limit))[:limit]


@app.post("/api/parse")
async def parse(req: ParseReq):
    return await ai.parse(req.text, net)


MM_BOX = (14.30, 14.85, 120.85, 121.25)


def _in_box(p):
    return MM_BOX[0] <= p.lat <= MM_BOX[1] and MM_BOX[2] <= p.lon <= MM_BOX[3]


@app.post("/api/plan")
def plan(req: PlanReq):
    if not (_in_box(req.origin) and _in_box(req.destination)):
        raise HTTPException(400, "Metro Manila pa lang ang supported. (Only Metro Manila is supported for now.)")
    hour = req.depart_hour if req.depart_hour is not None else datetime.now(ZoneInfo('Asia/Manila')).hour
    t0 = time.time()
    its = net.plan(req.origin.lat, req.origin.lon, req.destination.lat, req.destination.lon,
                   req.discount, hour, eta_factor(hour))
    warnings = ["Routes are based on DOTC/Sakay.ph GTFS data (2015); some jeepney routes may have changed.",
                "Travel times are estimates using a traffic model for the selected hour."]
    if not its:
        warnings.insert(0, "Walang nahanap na ruta. Subukang ilipat ang pin malapit sa main road.")
    return {"itineraries": its, "warnings": warnings, "fares_as_of": F.FARES_AS_OF,
            "depart_hour": hour, "compute_ms": round((time.time() - t0) * 1000)}


@app.get("/api/fares")
def fares():
    return F.table()


@app.post("/api/fare/check")
def fare_check(req: FareCheckReq):
    try:
        return F.check(req.mode, req.distance_km, req.discount, req.amount_paid)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post("/api/reports")
def add_report(r: ReportReq):
    with db() as con:
        cur = con.execute("INSERT INTO reports(mode,route_name,distance_km,official_fare,amount_paid,note,lat,lon,created_at)"
                          " VALUES(?,?,?,?,?,?,?,?,?)", (r.mode, r.route_name, r.distance_km, r.official_fare,
                                                          r.amount_paid, r.note, r.lat, r.lon, time.time()))
        return {"id": cur.lastrowid}


@app.get("/api/reports")
def list_reports():
    with db() as con:
        rows = con.execute("SELECT id,mode,route_name,official_fare,amount_paid,note,created_at "
                           "FROM reports ORDER BY id DESC LIMIT 20").fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["created_at"] = datetime.fromtimestamp(d["created_at"], ZoneInfo("Asia/Manila")).isoformat()
        out.append(d)
    return out


@app.post("/api/eta/feedback")
def eta_feedback(r: EtaReq):
    with db() as con:
        con.execute("INSERT INTO eta_feedback(hour,predicted,actual,created_at) VALUES(?,?,?,?)",
                    (r.depart_hour, r.predicted_minutes, r.actual_minutes, time.time()))
    return {"ok": True, "factor": eta_factor(r.depart_hour)}


# Serve the built React app
if os.path.isdir(STATIC):
    app.mount("/assets", StaticFiles(directory=os.path.join(STATIC, "assets")), name="assets") \
        if os.path.isdir(os.path.join(STATIC, "assets")) else None

    @app.get("/{path:path}")
    def spa(path: str):
        f = os.path.join(STATIC, path)
        if path and os.path.isfile(f) and os.path.realpath(f).startswith(os.path.realpath(STATIC)):
            return FileResponse(f)
        return FileResponse(os.path.join(STATIC, "index.html"))
