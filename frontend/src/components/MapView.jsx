import { useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, Polyline, Marker, CircleMarker, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { MANILA, modeInfo } from '../lib.js'

const pinIcon = (color, text) =>
  L.divIcon({ className: '', html: `<div class="pin" style="background:${color}"><span>${text}</span></div>`, iconSize: [26, 26], iconAnchor: [13, 26] })
const userIcon = L.divIcon({ className: '', html: '<div class="user-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] })

function ClickHandler({ onMapClick }) {
  useMapEvents({ click: (e) => onMapClick && onMapClick(e.latlng) })
  return null
}

function FitBounds({ itinerary, origin, destination }) {
  const map = useMap()
  useEffect(() => {
    const pts = []
    if (itinerary) itinerary.legs.forEach((l) => (l.geometry || []).forEach((p) => pts.push(p)))
    if (origin) pts.push([origin.lat, origin.lon])
    if (destination) pts.push([destination.lat, destination.lon])
    map.invalidateSize()
    if (pts.length >= 2) map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 16, animate: false })
    else if (pts.length === 1) map.setView(pts[0], 15, { animate: false })
  }, [itinerary, origin?.lat, origin?.lon, destination?.lat, destination?.lon]) // eslint-disable-line
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

export default function MapView({ origin, destination, itinerary, userPos, follow, onMapClick, progressD, track }) {
  // Split traveled vs remaining when tracking
  const traveled = useMemo(() => {
    if (!track || progressD == null) return null
    const out = []
    for (const pt of track.pts) { if (pt.d <= progressD) out.push(pt.p); else break }
    return out.length >= 2 ? out : null
  }, [track, progressD])

  return (
    <MapContainer center={[MANILA.lat, MANILA.lon]} zoom={12} zoomControl={false} className="h-full w-full">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      <InvalidateOnResize />
      <ClickHandler onMapClick={onMapClick} />
      <FitBounds itinerary={itinerary} origin={origin} destination={destination} />
      <Follow pos={userPos} enabled={follow} />

      {itinerary && itinerary.legs.map((leg, i) => {
        const m = modeInfo(leg.mode)
        const geom = leg.geometry && leg.geometry.length >= 2 ? leg.geometry : [[leg.from.lat, leg.from.lon], [leg.to.lat, leg.to.lon]]
        return (
          <Polyline key={i} positions={geom}
            pathOptions={leg.mode === 'walk'
              ? { color: m.color, weight: 4, dashArray: '6 8', opacity: 0.9 }
              : { color: m.color, weight: 6, opacity: 0.9 }}>
            <Tooltip sticky>{m.icon} {m.label}{leg.route_name ? ` · ${leg.route_name}` : ''}</Tooltip>
          </Polyline>
        )
      })}
      {traveled && <Polyline positions={traveled} pathOptions={{ color: '#94a3b8', weight: 7, opacity: 0.95 }} />}

      {itinerary && itinerary.legs.filter((l) => l.mode !== 'walk').map((leg, i) => (
        <CircleMarker key={'s' + i} center={[leg.from.lat, leg.from.lon]} radius={6}
          pathOptions={{ color: 'white', weight: 2, fillColor: modeInfo(leg.mode).color, fillOpacity: 1 }}>
          <Tooltip>Sakay: {leg.from.name}</Tooltip>
        </CircleMarker>
      ))}
      {itinerary && itinerary.legs.filter((l) => l.mode !== 'walk').map((leg, i) => (
        <CircleMarker key={'e' + i} center={[leg.to.lat, leg.to.lon]} radius={6}
          pathOptions={{ color: modeInfo(leg.mode).color, weight: 3, fillColor: 'white', fillOpacity: 1 }}>
          <Tooltip>Baba: {leg.to.name}</Tooltip>
        </CircleMarker>
      ))}

      {origin && <Marker position={[origin.lat, origin.lon]} icon={pinIcon('#0f766e', 'A')} />}
      {destination && <Marker position={[destination.lat, destination.lon]} icon={pinIcon('#dc2626', 'B')} />}
      {userPos && <Marker position={userPos} icon={userIcon} zIndexOffset={1000} />}
    </MapContainer>
  )
}
