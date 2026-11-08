"""Official fare rules for Metro Manila (edit FARES when LTFRB/DOTr change rates)."""
import math

FARES_AS_OF = "2026-09-28"

# PUV fares: LTFRB adjustment effective Sept 28, 2026 (suspension lifted by DOTr).
# Rail: distance-based estimates; students/seniors/PWD 50% on all lines (since 2025);
# LRT-2 & MRT-3 50% for ALL passengers since Mar 23, 2026 "until further notice".
FARES = {
    "jeep":         {"label": "Traditional jeepney", "base": 14.0, "base_km": 4, "per_km": 2.00},
    "jeep_modern":  {"label": "Modern jeepney",      "base": 17.0, "base_km": 4, "per_km": 2.40},
    "bus":          {"label": "City bus (aircon)",   "base": 18.0, "base_km": 5, "per_km": 2.98},
    "bus_ordinary": {"label": "City bus (ordinary)", "base": 15.0, "base_km": 5, "per_km": 2.49},
    "lrt1": {"label": "LRT-1", "rail": True, "boarding": 16.25, "per_km": 1.47, "min": 20, "max": 55, "promo_all_50": False},
    "lrt2": {"label": "LRT-2", "rail": True, "boarding": 13.00, "per_km": 1.21, "min": 15, "max": 35, "promo_all_50": True},
    "mrt3": {"label": "MRT-3", "rail": True, "boarding": 12.00, "per_km": 1.00, "min": 13, "max": 28, "promo_all_50": True},
}
ALIASES = {"jeepney": "jeep", "puj": "jeep", "modern_jeep": "jeep_modern", "pub": "bus",
           "bus_aircon": "bus", "aircon_bus": "bus", "mrt": "mrt3", "lrt": "lrt1"}
PUV_DISCOUNT = 0.20   # RA 9994 / RA 10754 / RA 11314: seniors, PWD, students
RAIL_DISCOUNT = 0.50


def norm_mode(mode: str) -> str:
    m = (mode or "").lower().strip()
    return ALIASES.get(m, m)


def round_quarter(x: float) -> float:
    return round(x * 4) / 4


def compute(mode: str, distance_km: float, discount: str = "regular") -> dict:
    """Return {fare, breakdown, note}."""
    mode = norm_mode(mode)
    if mode == "walk":
        return {"fare": 0.0, "breakdown": "Libre ang lakad", "note": ""}
    if mode not in FARES:
        raise ValueError(f"Unknown mode '{mode}'")
    f = FARES[mode]
    km = max(0.0, distance_km)
    discounted = discount in ("student", "senior", "pwd")

    if f.get("rail"):
        raw = f["boarding"] + f["per_km"] * km
        reg = float(min(f["max"], max(f["min"], math.ceil(raw))))
        txt = f"{f['label']} ≈ ₱{reg:.0f} (distance-based, {km:.1f} km)"
        fare = reg
        if discounted:
            fare = reg * (1 - RAIL_DISCOUNT)
            txt += f" − 50% {discount} = ₱{fare:.2f}"
        elif f.get("promo_all_50"):
            fare = reg * 0.5
            txt += f" − 50% DOTr promo for all = ₱{fare:.2f}"
        return {"fare": round(fare, 2), "breakdown": txt,
                "note": "Rail fares are estimates from the distance-based matrix."}

    billable = max(0, math.ceil(km - 1e-9) - f["base_km"])
    reg = round_quarter(f["base"] + billable * f["per_km"])
    txt = f"₱{f['base']:.0f} (first {f['base_km']} km)"
    if billable:
        txt += f" + {billable} km × ₱{f['per_km']:.2f}"
    txt += f" = ₱{reg:.2f}"
    fare = reg
    if discounted:
        fare = round_quarter(reg * (1 - PUV_DISCOUNT))
        txt += f" − 20% {discount} = ₱{fare:.2f}"
    return {"fare": fare, "breakdown": txt, "note": ""}


def check(mode: str, distance_km: float, discount: str, amount_paid: float) -> dict:
    r = compute(mode, distance_km, discount)
    official = r["fare"]
    diff = round(amount_paid - official, 2)
    tol = 0.50  # coin rounding tolerance
    if diff > tol:
        verdict = "overcharged"
        msg = (f"Overcharged ka ng ₱{diff:.2f}. Ang tamang pamasahe ay ₱{official:.2f}. "
               "Pwede mong ipakita ang fare matrix sa driver o i-report sa LTFRB.")
    elif diff < -tol:
        verdict = "undercharged"
        msg = f"Mas mababa ang binayad mo (₱{amount_paid:.2f}) kaysa sa official na ₱{official:.2f}."
    else:
        verdict = "fair"
        msg = f"Tama ang singil! Official fare: ₱{official:.2f}."
    return {"official_fare": official, "difference": diff, "verdict": verdict,
            "message": msg, "breakdown": r["breakdown"]}


def table() -> dict:
    return {"as_of": FARES_AS_OF, "puv_discount": PUV_DISCOUNT, "rail_discount": RAIL_DISCOUNT,
            "fares_as_of": FARES_AS_OF,
            "modes": {k: {**v, "name": v["label"],
                          "note": ("50% promo for all passengers" if v.get("promo_all_50") else
                                   "Distance-based estimate" if v.get("rail") else "")}
                      for k, v in FARES.items()},
            "discount_note": "Students, seniors & PWD: 20% off jeep/bus; 50% off LRT/MRT.",
            "sources": ["LTFRB fare adjustment (effective Sept 28, 2026)",
                        "DOTr 50% rail discount for students/seniors/PWD (2025)",
                        "DOTr 50% LRT-2/MRT-3 discount for all (Mar 23, 2026, until further notice)"]}
