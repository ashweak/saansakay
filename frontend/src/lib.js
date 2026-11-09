// Shared helpers: API, geo math, modes, storage, alerts

export const MANILA = { lat: 14.5995, lon: 121.0 }

export const MODES = {
  walk: { label: 'Lakad', icon: '🚶', color: '#6b7280', speed: 4.5 },
  jeep: { label: 'Jeep', icon: '🚙', color: '#f59e0b', line: '#ea580c', speed: 14 },
  bus: { label: 'Bus (aircon)', icon: '🚌', color: '#3b82f6', line: '#2563eb', speed: 16 },
  lrt1: { label: 'LRT-1', icon: '🚈', color: '#16a34a', speed: 30 },
  lrt2: { label: 'LRT-2', icon: '🚈', color: '#7c3aed', speed: 32 },
  mrt3: { label: 'MRT-3', icon: '🚇', color: '#ca8a04', line: '#a16207', speed: 30 },
  pnr: { label: 'PNR', icon: '🚆', color: '#ea580c', speed: 28 },
  jeep_modern: { label: 'Modern Jeep', icon: '🚐', color: '#d97706', line: '#c2410c', speed: 14 },
  bus_ordinary: { label: 'Bus (ordinary)', icon: '🚌', color: '#2563eb', speed: 16 },
}
export const modeInfo = (m) => MODES[m] || { label: m, icon: '🚐', color: '#0f766e', speed: 15 }
export const RIDE_MODES = ['jeep', 'jeep_modern', 'bus', 'bus_ordinary', 'lrt1', 'lrt2', 'mrt3']

export const DISCOUNTS = [
  { value: 'regular', label: 'Regular' },
  { value: 'student', label: 'Student' },
  { value: 'senior', label: 'Senior' },
  { value: 'pwd', label: 'PWD' },
]

export const peso = (n) =>
  n == null || isNaN(n) ? '—' : '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const fmtMin = (m) => {
  if (m == null || isNaN(m)) return '—'
  m = Math.max(0, Math.round(m))
  return m >= 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${m} min`
}
export const fmtDist = (meters) =>
  meters == null || isNaN(meters) ? '—' : meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`

// ---------- storage (try/catch: storage can throw) ----------
export const store = {
  get(k, d) {
    try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) } catch { return d }
  },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* ignore */ }
  },
}

// ---------- API ----------
async function req(path, opts = {}) {
  let res
  try {
    res = await fetch(path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    })
  } catch {
    throw new Error('Hindi maabot ang server. Check your connection.')
  }
  let data = null
  try { data = await res.json() } catch { /* empty */ }
  if (!res.ok) {
    const msg = data?.detail ? (typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail)) : `Error ${res.status}`
    throw new Error(msg)
  }
  return data
}
export const api = {
  health: () => req('/api/health'),
  places: (q, limit = 8) => req(`/api/places?q=${encodeURIComponent(q)}&limit=${limit}`),
  parse: (body) => req('/api/parse', { method: 'POST', body: JSON.stringify(body) }),
  plan: (body) => req('/api/plan', { method: 'POST', body: JSON.stringify(body) }),
  fares: () => req('/api/fares'),
  fareCheck: (body) => req('/api/fare/check', { method: 'POST', body: JSON.stringify(body) }),
  report: (body) => req('/api/reports', { method: 'POST', body: JSON.stringify(body) }),
  reports: () => req('/api/reports'),
  snap: (body) => req('/api/snap', { method: 'POST', body: JSON.stringify(body) }),
  etaFeedback: (body) => req('/api/eta/feedback', { method: 'POST', body: JSON.stringify(body) }),
}

// Nominatim (free OSM geocoder) — bounded to Metro Manila
export async function nominatim(q, signal) {
  const url =
    'https://nominatim.openstreetmap.org/search?format=json&limit=6&countrycodes=ph&viewbox=120.85,14.85,121.25,14.30&bounded=1&q=' +
    encodeURIComponent(q)
  const res = await fetch(url, { signal, headers: { 'Accept-Language': 'en' } })
  if (!res.ok) return []
  const data = await res.json()
  return data.map((d) => ({
    name: d.display_name.split(',').slice(0, 3).join(','),
    lat: parseFloat(d.lat),
    lon: parseFloat(d.lon),
    source: 'osm',
  }))
}

// Search local stops first, then Nominatim; returns best single match
// Resolve free text to coordinates: curated landmarks → OpenStreetMap (exact addresses) → transit stops
export async function resolvePlace(q) {
  let local = []
  try { local = (await api.places(q, 3)) || [] } catch { /* ignore */ }
  const landmark = local.find((p) => p.source === 'landmark')
  if (landmark) return landmark
  try {
    const osm = await nominatim(q)
    if (osm.length) return osm[0]
  } catch { /* ignore */ }
  return local[0] || null
}

// ---------- geo ----------
const R = 6371000
const toRad = (d) => (d * Math.PI) / 180
export function haversine(a, b) {
  const dLat = toRad(b[0] - a[0]), dLon = toRad(b[1] - a[1])
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

// Flatten itinerary into one route: points with cumulative distance + which leg
export function buildTrack(itin) {
  const pts = [] // {p:[lat,lon], d:cum meters, leg:i}
  let cum = 0
  const legEnds = [] // cumulative distance at end of each leg
  itin.legs.forEach((leg, i) => {
    let geom = leg.geometry && leg.geometry.length >= 2 ? leg.geometry : [[leg.from.lat, leg.from.lon], [leg.to.lat, leg.to.lon]]
    geom.forEach((p) => {
      if (pts.length) cum += haversine(pts[pts.length - 1].p, p)
      pts.push({ p, d: cum, leg: i })
    })
    legEnds.push(cum)
  })
  return { pts, total: cum, legEnds }
}

// Project position onto polyline (local equirectangular) → distance along route
export function projectOnTrack(track, pos, hintD = 0) {
  const { pts } = track
  if (pts.length < 2) return { along: 0, off: 0, leg: 0 }
  const lat0 = toRad(pos[0])
  const kx = 111320 * Math.cos(lat0), ky = 110540
  let best = { off: Infinity, along: 0, leg: 0 }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1]
    const ax = a.p[1] * kx, ay = a.p[0] * ky, bx = b.p[1] * kx, by = b.p[0] * ky
    const px = pos[1] * kx, py = pos[0] * ky
    const dx = bx - ax, dy = by - ay
    const L2 = dx * dx + dy * dy
    let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0
    t = Math.max(0, Math.min(1, t))
    const cx = ax + t * dx, cy = ay + t * dy
    let off = Math.hypot(px - cx, py - cy)
    const along = a.d + t * (b.d - a.d)
    // prefer forward progress: small penalty for jumping backwards far from hint
    const penalty = along < hintD - 200 ? 150 : 0
    if (off + penalty < best.off) best = { off: off + penalty, rawOff: off, along, leg: b.leg }
  }
  return { along: best.along, off: best.rawOff ?? best.off, leg: best.leg }
}

// Point at distance d along the track
export function pointAt(track, d) {
  const { pts } = track
  if (d <= 0) return { p: pts[0].p, leg: pts[0].leg }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1]
    if (d <= b.d) {
      const t = b.d === a.d ? 0 : (d - a.d) / (b.d - a.d)
      return { p: [a.p[0] + t * (b.p[0] - a.p[0]), a.p[1] + t * (b.p[1] - a.p[1])], leg: b.leg }
    }
  }
  const last = pts[pts.length - 1]
  return { p: last.p, leg: last.leg }
}

// ---------- alerts ----------
let audioCtx = null
export function beep(times = 3) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)()
    const now = audioCtx.currentTime
    for (let i = 0; i < times; i++) {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain()
      o.type = 'square'
      o.frequency.value = 880
      g.gain.setValueAtTime(0.0001, now + i * 0.45)
      g.gain.exponentialRampToValueAtTime(0.25, now + i * 0.45 + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.45 + 0.3)
      o.connect(g).connect(audioCtx.destination)
      o.start(now + i * 0.45)
      o.stop(now + i * 0.45 + 0.32)
    }
  } catch { /* no audio */ }
}
export function unlockAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)()
    if (audioCtx.state === 'suspended') audioCtx.resume()
  } catch { /* ignore */ }
}
export function notify(title, body) {
  try {
    if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body, tag: 'para' })
  } catch { /* ignore */ }
}
export function vibrate() {
  try { navigator.vibrate && navigator.vibrate([400, 200, 400]) } catch { /* ignore */ }
}
