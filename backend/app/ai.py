"""Natural-language (Taglish/English) trip parser. Uses Gemini free tier if GEMINI_API_KEY is set,
otherwise a rule-based parser so the app stays 100% free and works offline."""
import json, os, re
import httpx

GEMINI_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

# Common Metro Manila landmarks (approx. coordinates) to resolve queries without external geocoding.
LANDMARKS = {
    "sm north edsa": (14.6566, 121.0303), "sm north": (14.6566, 121.0303), "trinoma": (14.6533, 121.0335),
    "sm fairview": (14.7341, 121.0574), "fairview": (14.7341, 121.0574), "cubao": (14.6195, 121.0532),
    "araneta": (14.6206, 121.0530), "quiapo": (14.5990, 120.9839), "divisoria": (14.6015, 120.9725),
    "recto": (14.6035, 120.9830), "intramuros": (14.5896, 120.9747), "luneta": (14.5826, 120.9787),
    "rizal park": (14.5826, 120.9787), "lawton": (14.5946, 120.9810), "taft": (14.5378, 121.0014),
    "baclaran": (14.5340, 120.9980), "moa": (14.5352, 120.9822), "sm mall of asia": (14.5352, 120.9822),
    "pasay rotonda": (14.5378, 121.0014), "ayala": (14.5492, 121.0279), "makati": (14.5547, 121.0244),
    "greenbelt": (14.5526, 121.0219), "bgc": (14.5509, 121.0503), "bonifacio global city": (14.5509, 121.0503),
    "market market": (14.5496, 121.0557), "ortigas": (14.5876, 121.0567), "megamall": (14.5849, 121.0566),
    "sm megamall": (14.5849, 121.0566), "shaw": (14.5814, 121.0536), "pasig": (14.5764, 121.0851),
    "monumento": (14.6545, 120.9839), "caloocan": (14.6545, 120.9839), "valenzuela": (14.7004, 120.9830),
    "malabon": (14.6625, 120.9567), "novaliches": (14.7283, 121.0390), "commonwealth": (14.6900, 121.0870),
    "up diliman": (14.6538, 121.0685), "philcoa": (14.6553, 121.0510), "quezon city circle": (14.6516, 121.0493),
    "qc circle": (14.6516, 121.0493), "espana": (14.6100, 120.9890), "ust": (14.6096, 120.9894),
    "sampaloc": (14.6100, 120.9940), "alabang": (14.4231, 121.0300), "festival mall": (14.4170, 121.0390),
    "las pinas": (14.4500, 120.9830), "paranaque": (14.4793, 121.0198), "marikina": (14.6507, 121.1029),
    "antipolo": (14.6255, 121.1245), "san juan": (14.6019, 121.0355), "greenhills": (14.6022, 121.0496),
    "mandaluyong": (14.5794, 121.0359), "boni": (14.5735, 121.0482), "guadalupe": (14.5672, 121.0452),
    "naia": (14.5086, 121.0198), "naia terminal 3": (14.5205, 121.0153), "kalentong": (14.5880, 121.0235),
    "olfu valenzuela": (14.6950, 120.9690), "our lady of fatima university": (14.6950, 120.9690),
    "katipunan": (14.6390, 121.0745), "ateneo": (14.6397, 121.0779), "dlsu": (14.5649, 120.9932),
    "la salle": (14.5649, 120.9932), "pup": (14.5980, 121.0110), "pup sta mesa": (14.5980, 121.0110),
    "up manila": (14.5779, 120.9858), "pgh": (14.5779, 120.9858), "vito cruz": (14.5636, 120.9946),
}

STOPWORDS = r"\b(sa|ang|ng|po|na|yung|nalang|lang|the|my|ko|ako)\b"


def _clean(s):
    s = re.sub(r"[?!.,]", " ", s.lower())
    s = re.sub(STOPWORDS, " ", s)
    return re.sub(r"\s+", " ", s).strip()


ACRONYMS = {"sm", "ust", "up", "moa", "bgc", "naia", "pup", "dlsu", "pgh", "olfu", "qc"}


def nice(k):
    return " ".join(w.upper() if w in ACRONYMS else w.capitalize() for w in k.split())


def resolve(query, net=None):
    """Return {query, name, lat, lon} or {query} when unknown."""
    if not query:
        return None
    q = _clean(query)
    best = None
    for k, (la, lo) in LANDMARKS.items():
        if k == q or (k in q and (best is None or len(k) > len(best[0]))):
            best = (k, la, lo)
    if best:
        return {"query": query, "name": nice(best[0]), "lat": best[1], "lon": best[2]}
    if net:
        hits = net.search_stops(q, 1)
        if hits:
            h = hits[0]
            return {"query": query, "name": h["name"], "lat": h["lat"], "lon": h["lon"]}
    return {"query": query}


def _pref_discount(t):
    pref = None
    if re.search(r"\b(mura|murang|cheap|cheapest|tipid|pinakamura)\b", t): pref = "cheapest"
    elif re.search(r"\b(bilis|mabilis|fast|fastest|pinakamabilis|quick)\b", t): pref = "fastest"
    elif re.search(r"(konting sakay|less transfer|fewest|isang sakay|diretso)", t): pref = "fewest_transfers"
    disc = None
    if re.search(r"\b(student|estudyante|studyante)\b", t): disc = "student"
    elif re.search(r"\b(senior|lolo|lola)\b", t): disc = "senior"
    elif re.search(r"\bpwd\b", t): disc = "pwd"
    return pref, disc


def parse_rules(text):
    t = " " + text.lower().strip() + " "
    orig = dest = None
    patterns = [
        r"\b(?:galing|mula|from)\s+(?:sa\s+)?(?P<o>.+?)\s+\b(?:papunta|papuntang|patungo|to|hanggang|going to)\b\s+(?:sa\s+)?(?P<d>.+)",
        r"\b(?:papunta|papuntang|pumunta|punta|patungo|to|going to|get to|go to)\s+(?:sa\s+)?(?P<d>.+?)\s+\b(?:galing|mula|from)\b\s+(?:sa\s+)?(?P<o>.+)",
        r"^\s*(?P<o>[^,]+?)\s+(?:to|-|→)\s+(?P<d>.+)$",
        r"\b(?:papunta|papuntang|pumunta|punta|patungo|going to|get to|go to|to)\s+(?:sa\s+)?(?P<d>.+)",
    ]
    for p in patterns:
        m = re.search(p, t)
        if m:
            g = m.groupdict()
            orig, dest = g.get("o"), g.get("d")
            break
    if dest is None and t.strip():
        dest = t
    strip = lambda s: re.sub(r"^(?:sa|ako sa|ako)\s+", "", re.sub(r"\s*,.*$", "", re.sub(r"\b(ako|po|ngayon|now|please|pls|student|estudyante|senior|pwd|mura|mabilis|cheapest|fastest|bilang|ako ay)\b", " ", s or "")).strip(" ?.,")).strip() or None
    pref, disc = _pref_discount(t)
    return strip(orig), strip(dest), pref, disc


async def parse_gemini(text):
    prompt = (
        "Extract a Metro Manila commute request. Reply ONLY JSON: "
        '{"origin": string|null, "destination": string|null, '
        '"preference": "fastest"|"cheapest"|"fewest_transfers"|null, '
        '"discount": "student"|"senior"|"pwd"|null}. origin=null means current location. '
        "Use the place names as written (e.g. 'SM North EDSA'). Text: " + json.dumps(text)
    )
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
    async with httpx.AsyncClient(timeout=12) as c:
        r = await c.post(url, params={"key": GEMINI_KEY}, json={
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"responseMimeType": "application/json", "temperature": 0}})
        r.raise_for_status()
        out = json.loads(r.json()["candidates"][0]["content"]["parts"][0]["text"])
    return out.get("origin"), out.get("destination"), out.get("preference"), out.get("discount")


async def parse(text, net=None):
    method = "rules"
    if GEMINI_KEY:
        try:
            o, d, pref, disc = await parse_gemini(text)
            method = "gemini"
        except Exception:
            o, d, pref, disc = parse_rules(text)
    else:
        o, d, pref, disc = parse_rules(text)
    return {"origin": resolve(o, net) if o else None,
            "destination": resolve(d, net) if d else None,
            "preference": pref, "discount": disc, "method": method}
