import { useCallback, useEffect, useRef, useState } from 'react'
import { api, beep, buildTrack, haversine, modeInfo, notify, pointAt, projectOnTrack, unlockAudio, vibrate } from './lib.js'

const PARA_RADIUS = 300 // meters before alighting point
const ARRIVE_RADIUS = 40
const SIM_SECONDS = 35 // demo: whole trip plays in ~35 s regardless of length
const SIM_TICK = 200 // ms

export default function useTracker() {
  const [itin, setItin] = useState(null)
  const [track, setTrack] = useState(null)
  const [pos, setPos] = useState(null)
  const [along, setAlong] = useState(0)
  const [legIdx, setLegIdx] = useState(0)
  const [offRoute, setOffRoute] = useState(false)
  const [para, setPara] = useState(null) // {name, final}
  const [arrived, setArrived] = useState(null) // {actual, predicted, sent}
  const [simulating, setSimulating] = useState(false)
  const [gpsError, setGpsError] = useState(null)
  const [accuracy, setAccuracy] = useState(null)

  const r = useRef({}) // mutable state for callbacks
  r.current.itin = itin
  r.current.track = track

  const stopWatch = () => {
    if (r.current.watchId != null) { try { navigator.geolocation.clearWatch(r.current.watchId) } catch { /* */ } }
    r.current.watchId = null
  }
  const stopSim = () => { clearInterval(r.current.simTimer); r.current.simTimer = null; setSimulating(false) }

  const legAt = (tr, d) => {
    const i = tr.legEnds.findIndex((e) => d <= e + 0.5)
    return i === -1 ? tr.legEnds.length - 1 : i
  }

  const handlePosition = useCallback((p, isSim) => {
    const tr = r.current.track, it = r.current.itin
    if (!tr || !it || r.current.done) return
    setPos(p)
    const proj = projectOnTrack(tr, p, r.current.along || 0)
    const off = proj.off > 150
    setOffRoute(off)
    let a = r.current.along || 0
    if (!off || isSim) a = Math.max(a, proj.along)
    r.current.along = a
    setAlong(a)
    const li = legAt(tr, a)
    setLegIdx(li)

    // Para alert for current & upcoming ride legs
    it.legs.forEach((leg, i) => {
      if (leg.mode === 'walk' || i < li) return
      if (r.current.alerted?.has(i)) return
      const dTo = haversine(p, [leg.to.lat, leg.to.lon])
      const remainingInLeg = tr.legEnds[i] - a
      if (i === li && (dTo <= PARA_RADIUS || remainingInLeg <= PARA_RADIUS)) {
        r.current.alerted.add(i)
        fireAlert(leg.to.name, i === lastRideIndex(it))
      }
    })
    // Final destination proximity
    const dest = it.legs[it.legs.length - 1].to
    const remaining = tr.total - a
    if (!r.current.finalAlerted && remaining <= PARA_RADIUS) {
      r.current.finalAlerted = true
      // if the last leg is a ride, its Para alert already covered the destination
      if (!r.current.alerted.has(it.legs.length - 1)) fireAlert(dest.name, true)
    }
    if (remaining <= ARRIVE_RADIUS || haversine(p, [dest.lat, dest.lon]) <= ARRIVE_RADIUS) finish(isSim)
  }, []) // eslint-disable-line

  function lastRideIndex(it) {
    for (let i = it.legs.length - 1; i >= 0; i--) if (it.legs[i].mode !== 'walk') return i
    return -1
  }

  function fireAlert(name, final) {
    vibrate()
    beep(3)
    notify('PARA NA! 🛑', `Bababa ka na sa ${name}`)
    setPara({ name, final, at: Date.now() })
  }

  function finish(isSim) {
    if (r.current.done) return
    r.current.done = true
    stopWatch(); stopSim()
    const it = r.current.itin
    const predicted = it.total_minutes
    const actual = isSim ? null : (Date.now() - r.current.startedAt) / 60000
    const res = { predicted, actual, sim: isSim, sent: false }
    setArrived(res)
    if (!isSim && actual != null) {
      api.etaFeedback({ predicted_minutes: Math.round(predicted), actual_minutes: Math.round(actual * 10) / 10, depart_hour: r.current.departHour })
        .then((d) => setArrived({ ...res, sent: true, factor: d?.factor }))
        .catch(() => { /* ignore */ })
    }
  }

  const start = useCallback((itinerary) => {
    stopWatch(); stopSim()
    const tr = buildTrack(itinerary)
    r.current = { ...r.current, along: 0, alerted: new Set(), finalAlerted: false, done: false, startedAt: Date.now(), departHour: new Date().getHours(), itin: itinerary, track: tr }
    setItin(itinerary); setTrack(tr); setAlong(0); setLegIdx(0); setPara(null); setArrived(null); setOffRoute(false); setGpsError(null)
    setPos(null)
    unlockAudio()
    try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission() } catch { /* */ }
    if (!('geolocation' in navigator)) { setGpsError('Walang GPS ang browser na ito. Gamitin ang "Simulate ride".'); return }
    r.current.watchId = navigator.geolocation.watchPosition(
      (g) => { if (!r.current.simTimer) { setAccuracy(g.coords.accuracy); handlePosition([g.coords.latitude, g.coords.longitude], false) } },
      (err) => setGpsError(err.code === 1 ? 'Naka-block ang location permission. I-allow ito o gamitin ang "Simulate ride".' : 'Hindi makuha ang GPS signal.'),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 },
    )
  }, [handlePosition])

  const simulate = useCallback(() => {
    const tr = r.current.track, it = r.current.itin
    if (!tr || !it) return
    unlockAudio()
    stopSim()
    r.current.done = false
    if (r.current.along >= tr.total - ARRIVE_RADIUS) { r.current.along = 0; r.current.alerted = new Set(); r.current.finalAlerted = false; setPara(null); setArrived(null) }
    let d = r.current.along || 0
    // speed-up factor so the whole route (at realistic per-mode speeds) plays in ~SIM_SECONDS
    let realSec = 0, prev = 0
    tr.legEnds.forEach((end, i) => { realSec += (end - prev) / ((modeInfo(it.legs[i].mode).speed * 1000) / 3600); prev = end })
    const factor = Math.max(1, realSec / SIM_SECONDS)
    setSimulating(true)
    r.current.simTimer = setInterval(() => {
      const li = legAt(tr, d)
      const speed = (modeInfo(it.legs[li].mode).speed * 1000) / 3600 // m/s
      d = Math.min(tr.total, d + speed * factor * (SIM_TICK / 1000))
      const pt = pointAt(tr, d)
      handlePosition(pt.p, true)
      if (d >= tr.total) stopSim()
    }, SIM_TICK)
  }, [handlePosition])

  const stop = useCallback(() => {
    stopWatch(); stopSim()
    r.current.done = true
    setItin(null); setTrack(null); setPos(null); setPara(null); setArrived(null); setGpsError(null)
  }, [])

  useEffect(() => () => { stopWatch(); stopSim() }, [])

  // Derived: remaining distance, ETA (scaled by each leg's predicted minutes)
  let remaining = null, etaMin = null, progress = 0
  if (track && itin) {
    remaining = Math.max(0, track.total - along)
    progress = track.total ? along / track.total : 0
    etaMin = 0
    let prevEnd = 0
    itin.legs.forEach((leg, i) => {
      const end = track.legEnds[i]
      const len = end - prevEnd
      const done = Math.min(len, Math.max(0, along - prevEnd))
      const frac = len > 0 ? (len - done) / len : 0
      etaMin += (leg.minutes || 0) * frac
      prevEnd = end
    })
  }

  return {
    itin, track, pos, along, legIdx, offRoute, para, arrived, simulating, gpsError, accuracy,
    remaining, etaMin, progress,
    start, simulate, stop, pauseSim: stopSim, dismissPara: () => setPara(null),
  }
}
