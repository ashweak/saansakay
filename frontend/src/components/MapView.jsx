import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Polyline, Marker, CircleMarker, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import * as maplibregl from 'maplibre-gl'
import mlWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import 'maplibre-gl/dist/maplibre-gl.css'
import '@maplibre/maplibre-gl-leaflet'
import { MANILA, modeInfo, fmtMin, peso, pointAt as trackPointAt } from '../lib.js'
import { baseStyle, VECTOR_ATTRIBUTION } from '../mapStyle.js'

const pinIcon = (color, text) =>
  L.divIcon({ className: '', html: `<div class="pin pin-drop" style="background:${color}"><span>${text}</span></div>`, iconSize: [26, 26], iconAnchor: [13, 26] })
const userIcon = L.divIcon({ className: '', html: '<div class="user-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] })

const EMPTY = []
const DRAW_MS = 1200 // total time to draw the selected route
const legGeom = (l) => (l.geometry && l.geometry.length >= 2 ? l.geometry : [[l.from.lat, l.from.lon], [l.to.lat, l.to.lon]])
const allPts = (it) => it.legs.flatMap(legGeom)

function hav(a, b) {
  const R = 6371000, r = Math.PI / 180
  const dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
// point at fraction f along a polyline (used to place the route label)
function pointAt(pts, f) {
  let total = 0
  for (let i = 1; i < pts.length; i++) total += hav(pts[i - 1], pts[i])
  let goal = total * f
  for (let i = 1; i < pts.length; i++) {
    const d = hav(pts[i - 1], pts[i])
    if (goal <= d && d > 0) { const t = goal / d; return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t] }
    goal -= d
  }
  return pts[pts.length - 1]
}

function ClickHandler({ onMapClick }) {
  useMapEvents({ click: (e) => onMapClick && onMapClick(e.latlng) })
  return null
}


// bundlers don't copy MapLibre's worker file automatically: point it at the emitted asset
try { maplibregl.setWorkerUrl(mlWorkerUrl) } catch { /* older API */ }

const webglOK = () => {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')) } catch { return false }
}

// Styled vector basemap (OpenFreeMap). Falls back to standard OSM raster tiles if WebGL
// is unavailable or the vector tiles can't be loaded.
function BaseLayer() {
  const map = useMap()
  const [fallback, setFallback] = useState(() => !webglOK())
  useEffect(() => {
    if (fallback) return
    let layer
    try {
      layer = L.maplibreGL({ style: baseStyle, interactive: false }).addTo(map)
    } catch { setFallback(true); return }
    map.attributionControl?.addAttribution(VECTOR_ATTRIBUTION)
    const gl = layer.getMaplibreMap()
    let tiles = 0, errors = 0
    const onData = (e) => { if (e.dataType === 'source' && e.tile) tiles++ }
    const onError = () => { errors++; if (!tiles && errors >= 3) setFallback(true) }
    gl.on('data', onData); gl.on('error', onError)
    const timer = setTimeout(() => { if (!tiles) setFallback(true) }, 9000)
    return () => {
      clearTimeout(timer); gl.off('data', onData); gl.off('error', onError)
      map.attributionControl?.removeAttribution(VECTOR_ATTRIBUTION); map.removeLayer(layer)
    }
  }, [fallback, map])
  if (!fallback) return null
  return <TileLayer className="raster-base" maxZoom={19} url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' />
}

const toRad = (d) => (d * Math.PI) / 180
function bearingDeg(a, b) {
  const y = Math.sin(toRad(b[1] - a[1])) * Math.cos(toRad(b[0]))
  const x = Math.cos(toRad(a[0])) * Math.sin(toRad(b[0])) - Math.sin(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.cos(toRad(b[1] - a[1]))
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}
const vehicleIcon = (mode) => {
  const m = modeInfo(mode)
  return L.divIcon({
    className: '', iconSize: [44, 44], iconAnchor: [22, 22],
    html: `<div class="veh"><div class="veh-cone"></div><div class="veh-arrow"></div><div class="veh-body" style="background:${m.line || m.color}">${m.icon}</div></div>`,
  })
}

/**
 * Live position that glides instead of jumping: the target "distance along the route"
 * (from GPS or the simulator) is eased every animation frame, the marker is moved and
 * rotated imperatively (no React re-render per frame), the traveled line grows smoothly
 * and the camera follows until the user drags the map.
 */
function SmoothTracker({ track, itinerary, target, rawPos, offRoute, follow, paused, setPaused }) {
  const map = useMap()
  const markerRef = useRef(null)
  const travRef = useRef(null)
  const st = useRef({ shown: null, raw: null, leg: -1, lastTrav: 0, zoomed: false })
  const live = useRef({})
  live.current = { target, rawPos, offRoute, follow, paused }

  useEffect(() => { st.current = { shown: null, raw: null, leg: -1, lastTrav: 0, zoomed: false } }, [track])
  useEffect(() => {
    const onDrag = () => setPaused(true)
    map.on('dragstart', onDrag)
    return () => map.off('dragstart', onDrag)
  }, [map, setPaused])

  useEffect(() => {
    if (!track) return
    let raf, prev = performance.now()
    const loop = (now) => {
      const dt = Math.min(0.1, (now - prev) / 1000); prev = now
      const s = st.current, L_ = live.current
      const mk = markerRef.current
      let p = null, hdg = null, leg = 0
      if (L_.offRoute && L_.rawPos) {
        // away from the route: ease the raw GPS fix
        s.raw = s.raw || L_.rawPos
        const k = 1 - Math.exp(-dt / 0.5)
        s.raw = [s.raw[0] + (L_.rawPos[0] - s.raw[0]) * k, s.raw[1] + (L_.rawPos[1] - s.raw[1]) * k]
        p = s.raw
      } else if (L_.target != null) {
        if (s.shown == null) s.shown = L_.target
        const k = 1 - Math.exp(-dt / 0.45)
        s.shown += (L_.target - s.shown) * k
        const a = trackPointAt(track, s.shown)
        p = a.p; leg = a.leg
        const ahead = trackPointAt(track, Math.min(track.total, s.shown + 12)).p
        if (ahead[0] !== p[0] || ahead[1] !== p[1]) hdg = bearingDeg(p, ahead)
        s.raw = p
        // traveled (grey) part grows smoothly, updated ~12x per second
        if (travRef.current && now - s.lastTrav > 80) {
          s.lastTrav = now
          const pts = []
          for (const q of track.pts) { if (q.d <= s.shown) pts.push(q.p); else break }
          pts.push(p)
          travRef.current.setLatLngs(pts.length >= 2 ? pts : [])
        }
      }
      if (p && mk) {
        mk.setLatLng(p)
        if (leg !== s.leg) { s.leg = leg; mk.setIcon(vehicleIcon(itinerary.legs[leg]?.mode || 'walk')) }
        const el = mk.getElement()?.querySelector('.veh')
        if (el && hdg != null) { el.style.setProperty('--hdg', `${hdg}deg`); el.classList.add('has-hdg') }
        if (L_.follow && !L_.paused) {
          if (!s.zoomed) { s.zoomed = true; map.setView(p, Math.max(map.getZoom(), 16), { animate: true }) }
          else map.panTo(p, { animate: false })
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [track, itinerary, map])

  const startIcon = useMemo(() => vehicleIcon(itinerary.legs[0]?.mode || 'walk'), [track]) // eslint-disable-line
  const travStyle = useMemo(() => ({ color: '#94a3b8', weight: 7, opacity: 1, lineCap: 'round' }), [])
  if (!track) return null
  const start = track.pts[0].p
  return (
    <>
      <Polyline ref={travRef} positions={EMPTY} interactive={false} pathOptions={travStyle} />
      <Marker ref={markerRef} position={start} icon={startIcon} zIndexOffset={1200} interactive={false} />
    </>
  )
}

function InvalidateOnResize() {
  const map = useMap()
  // hide the "Leaflet" prefix (not required); the map-data credit stays as the licence requires
  useEffect(() => { map.attributionControl?.setPrefix(false) }, [map])
  useEffect(() => {
    const fn = () => map.invalidateSize()
    window.addEventListener('resize', fn)
    const t = setTimeout(fn, 300)
    // map container height changes (expand/collapse, tab switch, rotation) → re-measure
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fn) : null
    ro?.observe(map.getContainer())
    return () => { window.removeEventListener('resize', fn); clearTimeout(t); ro?.disconnect() }
  }, [map])
  return null
}

// Smoothly fly to the pins when only origin/destination are set (no route yet)
function PinCamera({ origin, destination, active }) {
  const map = useMap()
  useEffect(() => {
    if (!active) return
    const pts = [origin, destination].filter(Boolean).map((p) => [p.lat, p.lon])
    if (pts.length === 2) map.flyToBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 15, duration: 0.7 })
    else if (pts.length === 1) map.flyTo(pts[0], 15, { duration: 0.7 })
  }, [origin?.lat, origin?.lon, destination?.lat, destination?.lon, active]) // eslint-disable-line
  return null
}

/**
 * Selected route: white casing + colored legs. On every new animKey the camera flies to
 * the routes (only when fitKey changed, i.e. a new search) and then the route "draws"
 * itself leg by leg from origin to destination (SVG stroke-dashoffset animation).
 */
function SelectedRoute({ itinerary, animKey, fitKey, fitPts, onDrawn, noFly }) {
  const map = useMap()
  const refs = useRef([])
  const lastFit = useRef(null)

  useEffect(() => {
    const timers = []
    let started = false
    const pairs = itinerary.legs.map((leg, i) => ({ leg, casing: refs.current[i * 2]?.getElement(), line: refs.current[i * 2 + 1]?.getElement() }))

    const draw = () => {
      if (started) return
      started = true
      const lens = pairs.map((p) => { try { return p.line?.getTotalLength() || 0 } catch { return 0 } })
      const total = lens.reduce((a, b) => a + b, 0) || 1
      let t = 0
      pairs.forEach((p, i) => {
        const len = lens[i]
        const dur = Math.max(160, (DRAW_MS * len) / total)
        const delay = t
        t += dur
        for (const el of [p.casing, p.line]) {
          if (!el) continue
          el.style.transition = 'none'
          if (p.leg.mode === 'walk') {
            el.style.opacity = '0'
            timers.push(setTimeout(() => { el.style.transition = 'opacity 300ms ease'; el.style.opacity = '1' }, delay))
          } else {
            el.style.strokeDasharray = `${len} ${len}`
            el.style.strokeDashoffset = `${len}`
            el.style.opacity = '1'
            el.getBoundingClientRect() // force reflow so the start state is applied
            timers.push(setTimeout(() => {
              el.style.transition = `stroke-dashoffset ${dur}ms cubic-bezier(.45,.05,.55,.95)`
              el.style.strokeDashoffset = '0'
            }, delay))
            // remove dash styles afterwards so zooming / snapped geometry never clips the line
            timers.push(setTimeout(() => { el.style.transition = ''; el.style.strokeDasharray = ''; el.style.strokeDashoffset = '' }, delay + dur + 60))
          }
        }
      })
      timers.push(setTimeout(() => onDrawn && onDrawn(), t))
    }

    if (!noFly && fitKey !== lastFit.current && fitPts.length >= 2) {
      lastFit.current = fitKey
      const pad = window.innerWidth < 768 ? [36, 36] : [70, 70]
      map.flyToBounds(L.latLngBounds(fitPts), { padding: pad, maxZoom: 16, duration: 0.8 })
      map.once('moveend', draw)
      timers.push(setTimeout(draw, 1100)) // in case the camera didn't need to move
    } else {
      draw()
    }
    return () => { timers.forEach(clearTimeout); map.off('moveend', draw) }
  }, [animKey]) // eslint-disable-line

  return itinerary.legs.flatMap((leg, i) => {
    const m = modeInfo(leg.mode)
    const geom = legGeom(leg)
    const walk = leg.mode === 'walk'
    return [
      <Polyline key={`${animKey}-c${i}`} ref={(r) => { refs.current[i * 2] = r }} positions={geom} interactive={false}
        pathOptions={{ className: 'route-anim', color: '#ffffff', weight: walk ? 8 : 12, opacity: 1, lineCap: 'round', lineJoin: 'round' }} />,
      <Polyline key={`${animKey}-l${i}`} ref={(r) => { refs.current[i * 2 + 1] = r }} positions={geom}
        pathOptions={walk
          ? { className: 'route-anim', color: '#334155', weight: 4, dashArray: '2 9', opacity: 1, lineCap: 'round' }
          : { className: 'route-anim', color: m.line || m.color, weight: 7, opacity: 1, lineCap: 'round', lineJoin: 'round' }}>
        <Tooltip sticky>{m.icon} {m.label}{leg.route_name ? ` · ${leg.route_name}` : ''}</Tooltip>
      </Polyline>,
    ]
  })
}

const chipIcon = (it, selected, n) => {
  const rides = it.legs.filter((l) => l.mode !== 'walk').map((l) => modeInfo(l.mode).icon).join('')
  return L.divIcon({
    className: '',
    iconSize: null,
    html: `<div class="route-chip ${selected ? 'is-selected' : ''}" style="animation-delay:${selected ? 0.9 : 1 + n * 0.08}s">
      <span class="rc-modes">${rides || '🚶'}</span><b>${fmtMin(it.total_minutes)}</b><span class="rc-fare">${peso(it.total_fare)}</span></div>`,
  })
}

export default function MapView({
  origin, destination, itinerary, alternatives = [], animKey, fitKey, onSelectRoute,
  userPos, follow, onMapClick, progressD, track, offRoute,
}) {
  const [map, setMap] = useState(null)
  const [paused, setPaused] = useState(false)
  const wrapRef = useRef(null)
  const tracking = !!(track && progressD != null)
  useEffect(() => { setPaused(false) }, [track])

  const fitPts = useMemo(() => {
    const pts = []
    if (itinerary) pts.push(...allPts(itinerary))
    alternatives.forEach((a) => pts.push(...allPts(a)))
    if (origin) pts.push([origin.lat, origin.lon])
    if (destination) pts.push([destination.lat, destination.lon])
    return pts
  }, [fitKey]) // eslint-disable-line  (recomputed per search, not on every snapped update)

  const chips = useMemo(() => {
    if (!itinerary || !onSelectRoute) return []
    return [...alternatives, itinerary].map((it, n) => ({ it, pos: pointAt(allPts(it), n % 2 ? 0.38 : 0.58), selected: it === itinerary, n, icon: chipIcon(it, it === itinerary, n) }))
  }, [itinerary, alternatives, onSelectRoute])

  const locate = () => {
    if (!map) return
    if (tracking) { setPaused(false); return }
    const go = (p) => map.flyTo(p, Math.max(map.getZoom(), 16), { duration: 0.7 })
    if (userPos) go(userPos)
    else navigator.geolocation?.getCurrentPosition((g) => go([g.coords.latitude, g.coords.longitude]), () => {}, { enableHighAccuracy: true, timeout: 8000 })
  }
  const canFs = typeof document !== 'undefined' && !!document.documentElement.requestFullscreen
  const toggleFs = () => {
    if (document.fullscreenElement) document.exitFullscreen?.()
    else wrapRef.current?.requestFullscreen?.()
  }

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      <MapContainer ref={setMap} center={[MANILA.lat, MANILA.lon]} zoom={12} zoomControl={false} className="h-full w-full">
        <BaseLayer />
        <InvalidateOnResize />
        <ClickHandler onMapClick={onMapClick} />
        <PinCamera origin={origin} destination={destination} active={!itinerary} />

        {/* Alternative routes: muted grey, tap to switch */}
        {alternatives.map((a) => (
          <Polyline key={`alt-c-${a.id}-${fitKey}`} positions={allPts(a)} interactive={false}
            pathOptions={{ className: 'alt-route', color: '#ffffff', weight: 11, opacity: 1, lineCap: 'round', lineJoin: 'round' }} />
        ))}
        {alternatives.map((a) => (
          <Polyline key={`alt-l-${a.id}-${fitKey}`} positions={allPts(a)}
            eventHandlers={{ click: (e) => { L.DomEvent.stopPropagation(e); onSelectRoute?.(a.id) } }}
            pathOptions={{ className: 'alt-route alt-line', color: '#94a3b8', weight: 7, opacity: 1, lineCap: 'round', lineJoin: 'round' }}>
            <Tooltip sticky>{a.label || 'Alternative'} · {fmtMin(a.total_minutes)} · {peso(a.total_fare)}</Tooltip>
          </Polyline>
        ))}

        {itinerary && <SelectedRoute itinerary={itinerary} animKey={animKey} fitKey={fitKey} fitPts={fitPts} noFly={tracking} />}

        {itinerary && itinerary.legs.filter((l) => l.mode !== 'walk').map((leg, i) => (
          <CircleMarker key={`s${i}-${animKey}`} center={[leg.from.lat, leg.from.lon]} radius={7}
            pathOptions={{ className: 'stop-dot', color: 'white', weight: 3, fillColor: modeInfo(leg.mode).color, fillOpacity: 1 }}>
            <Tooltip>Sakay: {leg.from.name}</Tooltip>
          </CircleMarker>
        ))}
        {itinerary && itinerary.legs.filter((l) => l.mode !== 'walk').map((leg, i) => (
          <CircleMarker key={`e${i}-${animKey}`} center={[leg.to.lat, leg.to.lon]} radius={7}
            pathOptions={{ className: 'stop-dot', color: modeInfo(leg.mode).line || modeInfo(leg.mode).color, weight: 4, fillColor: 'white', fillOpacity: 1 }}>
            <Tooltip>Baba: {leg.to.name}</Tooltip>
          </CircleMarker>
        ))}

        {chips.map(({ it, pos, selected, icon }) => (
          <Marker key={`chip-${it.id}-${animKey}`} position={pos} icon={icon} zIndexOffset={selected ? 900 : 500}
            eventHandlers={{ click: () => onSelectRoute?.(it.id) }} />
        ))}

        {origin && <Marker key={`o-${origin.lat}-${origin.lon}`} position={[origin.lat, origin.lon]} icon={pinIcon('#0f766e', 'A')} />}
        {destination && <Marker key={`d-${destination.lat}-${destination.lon}`} position={[destination.lat, destination.lon]} icon={pinIcon('#dc2626', 'B')} />}
        {tracking
          ? <SmoothTracker track={track} itinerary={itinerary} target={progressD} rawPos={userPos} offRoute={offRoute}
              follow={follow} paused={paused} setPaused={setPaused} />
          : userPos && <Marker position={userPos} icon={userIcon} zIndexOffset={1000} />}
      </MapContainer>

      {/* Map buttons */}
      {canFs && (
        <button onClick={toggleFs} aria-label="Fullscreen" className="map-btn absolute right-3 top-3 z-[1000] hidden lg:flex">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
        </button>
      )}
      <div className="absolute bottom-7 right-3 z-[1000] flex flex-col items-end gap-2">
        <button onClick={locate} aria-label="Nasaan ako" className={`map-btn ${tracking && !paused ? 'text-teal-700' : ''}`}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>
        </button>
        <div className="map-btn-group hidden md:flex">
          <button onClick={() => map?.zoomIn()} aria-label="Zoom in">＋</button>
          <button onClick={() => map?.zoomOut()} aria-label="Zoom out">－</button>
        </div>
      </div>
      {tracking && paused && (
        <button onClick={() => setPaused(false)}
          className="absolute bottom-7 left-1/2 z-[1000] -translate-x-1/2 rounded-full bg-teal-700 px-4 py-2.5 text-sm font-bold text-white shadow-lg active:scale-95">
          ◎ I-center ulit
        </button>
      )}
    </div>
  )
}
