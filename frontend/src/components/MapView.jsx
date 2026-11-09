import { useEffect, useMemo, useRef } from 'react'
import { MapContainer, TileLayer, Polyline, Marker, CircleMarker, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { MANILA, modeInfo, fmtMin, peso } from '../lib.js'

const pinIcon = (color, text) =>
  L.divIcon({ className: '', html: `<div class="pin pin-drop" style="background:${color}"><span>${text}</span></div>`, iconSize: [26, 26], iconAnchor: [13, 26] })
const userIcon = L.divIcon({ className: '', html: '<div class="user-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] })

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

function Follow({ pos, enabled }) {
  const map = useMap()
  useEffect(() => {
    if (enabled && pos) map.panTo(pos, { animate: true })
  }, [pos?.[0], pos?.[1], enabled]) // eslint-disable-line
  return null
}

function InvalidateOnResize() {
  const map = useMap()
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
function SelectedRoute({ itinerary, animKey, fitKey, fitPts, onDrawn }) {
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

    if (fitKey !== lastFit.current && fitPts.length >= 2) {
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
  userPos, follow, onMapClick, progressD, track,
}) {
  // Split traveled vs remaining when tracking
  const traveled = useMemo(() => {
    if (!track || progressD == null) return null
    const out = []
    for (const pt of track.pts) { if (pt.d <= progressD) out.push(pt.p); else break }
    return out.length >= 2 ? out : null
  }, [track, progressD])

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
    return [...alternatives, itinerary].map((it, n) => ({ it, pos: pointAt(allPts(it), n % 2 ? 0.38 : 0.58), selected: it === itinerary, n }))
  }, [itinerary, alternatives, onSelectRoute])

  return (
    <MapContainer center={[MANILA.lat, MANILA.lon]} zoom={12} zoomControl={false} className="h-full w-full">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      <InvalidateOnResize />
      <ClickHandler onMapClick={onMapClick} />
      <PinCamera origin={origin} destination={destination} active={!itinerary} />
      <Follow pos={userPos} enabled={follow} />

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

      {itinerary && <SelectedRoute itinerary={itinerary} animKey={animKey} fitKey={fitKey} fitPts={fitPts} />}
      {traveled && <Polyline positions={traveled} pathOptions={{ color: '#94a3b8', weight: 7, opacity: 1, lineCap: 'round' }} />}

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

      {chips.map(({ it, pos, selected, n }) => (
        <Marker key={`chip-${it.id}-${animKey}`} position={pos} icon={chipIcon(it, selected, n)} zIndexOffset={selected ? 900 : 500}
          eventHandlers={{ click: () => onSelectRoute?.(it.id) }} />
      ))}

      {origin && <Marker key={`o-${origin.lat}-${origin.lon}`} position={[origin.lat, origin.lon]} icon={pinIcon('#0f766e', 'A')} />}
      {destination && <Marker key={`d-${destination.lat}-${destination.lon}`} position={[destination.lat, destination.lon]} icon={pinIcon('#dc2626', 'B')} />}
      {userPos && <Marker position={userPos} icon={userIcon} zIndexOffset={1000} />}
    </MapContainer>
  )
}
