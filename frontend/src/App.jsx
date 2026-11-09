import { useCallback, useEffect, useRef, useState } from 'react'
import MapView from './components/MapView.jsx'
import PlanPanel from './components/PlanPanel.jsx'
import TrackPanel from './components/TrackPanel.jsx'
import FareCheck from './components/FareCheck.jsx'
import FaresInfo from './components/FaresInfo.jsx'
import useTracker from './useTracker.js'
import { api, MANILA, resolvePlace, store } from './lib.js'

const TABS = [
  { id: 'plan', label: 'Plan', icon: '🗺️' },
  { id: 'track', label: 'Track', icon: '📍' },
  { id: 'fare', label: 'Fare Check', icon: '💸' },
  { id: 'fares', label: 'Fares', icon: '📋' },
]
const PREF_LABEL = { fastest: 'fastest', cheapest: 'cheapest', fewest_transfers: 'fewest' }

export default function App() {
  const [tab, setTab] = useState('plan')
  const [origin, setOrigin] = useState(null)
  const [destination, setDestination] = useState(null)
  const [discount, setDiscountState] = useState(() => store.get('ss_discount', 'regular'))
  const [locNotice, setLocNotice] = useState(null)
  const [here, setHere] = useState(null)
  const [aiText, setAiText] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiInfo, setAiInfo] = useState(null)
  const [planning, setPlanning] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [farePrefill, setFarePrefill] = useState(null)
  const [aiMode, setAiMode] = useState(null)
  const t = useTracker()
  const snapToken = useRef(0)

  // Replace stop-to-stop lines with road-following geometry (backend caches OSRM results).
  // Selected route first, max 3 requests at a time; stale runs are dropped when a new search starts.
  const snapRoutes = useCallback(async (res, firstId) => {
    const tok = ++snapToken.current
    const its = [...(res?.itineraries || [])].sort((a, b) => (b.id === firstId) - (a.id === firstId))
    const jobs = []
    its.forEach((it) => it.legs.forEach((leg, li) => {
      if (!['lrt1', 'lrt2', 'mrt3'].includes(leg.mode) && leg.geometry?.length >= 2) jobs.push({ id: it.id, li, leg })
    }))
    const seen = new Map()
    const run = async (job) => {
      const key = job.leg.mode + JSON.stringify(job.leg.geometry)
      if (!seen.has(key)) seen.set(key, api.snap({ mode: job.leg.mode, points: job.leg.geometry }).catch(() => null))
      const r = await seen.get(key)
      if (tok !== snapToken.current || !r?.snapped) return
      setResult((prev) => prev && {
        ...prev,
        itineraries: prev.itineraries.map((it) => it.id !== job.id ? it : {
          ...it, legs: it.legs.map((l, i) => i !== job.li ? l : { ...l, geometry: r.geometry, snapped: true }),
        }),
      })
    }
    const queue = [...jobs]
    await Promise.all(Array.from({ length: 3 }, async () => { while (queue.length && tok === snapToken.current) await run(queue.shift()) }))
  }, [])

  const setDiscount = (d) => { setDiscountState(d); store.set('ss_discount', d) }

  useEffect(() => { api.health().then((h) => setAiMode(h?.ai)).catch(() => {}) }, [])

  // Current location (fallback: center of Manila)
  const getCurrent = useCallback(() => new Promise((resolve) => {
    const fallback = () => {
      const p = { name: 'Manila (default — walang GPS)', lat: MANILA.lat, lon: MANILA.lon, current: true }
      setLocNotice('Hindi makuha ang location mo, kaya Manila ang ginamit. I-allow ang location o mag-type ng lugar.')
      resolve(p)
    }
    if (!('geolocation' in navigator)) return fallback()
    navigator.geolocation.getCurrentPosition(
      (g) => {
        const p = { name: 'Current location ko', lat: g.coords.latitude, lon: g.coords.longitude, current: true }
        setHere([p.lat, p.lon]); setLocNotice(null); resolve(p)
      },
      fallback,
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    )
  }), [])

  const useCurrent = useCallback(async () => setOrigin(await getCurrent()), [getCurrent])
  useEffect(() => { useCurrent() }, []) // eslint-disable-line

  const plan = useCallback(async (o = origin, d = destination, disc = discount, pref = null) => {
    if (!o || !d) return
    setPlanning(true); setError(null); setResult(null); setSelectedId(null)
    try {
      const res = await api.plan({
        origin: { lat: o.lat, lon: o.lon }, destination: { lat: d.lat, lon: d.lon },
        discount: disc, depart_hour: new Date().getHours(),
      })
      setResult(res)
      const its = res?.itineraries || []
      const preferred = pref && its.find((i) => (i.label || '').toLowerCase().includes(PREF_LABEL[pref] || pref))
      const first = (preferred || its[0])?.id ?? null
      setSelectedId(first)
      snapRoutes(res, first)
      setTab('plan')
    } catch (e) { setError(e.message) } finally { setPlanning(false) }
  }, [origin, destination, discount, snapRoutes])

  // Plan automatically when both endpoints / discount change
  useEffect(() => { if (origin && destination && !aiBusy) plan() }, [origin?.lat, origin?.lon, destination?.lat, destination?.lon, discount]) // eslint-disable-line

  async function ask() {
    const text = aiText.trim()
    if (!text) return
    setAiBusy(true); setAiInfo(null); setError(null)
    try {
      const p = await api.parse({ text, lat: here?.[0] ?? origin?.lat, lon: here?.[1] ?? origin?.lon })
      const resolve = async (x) => {
        if (!x) return null
        if (x.lat != null && x.lon != null) return { name: x.name || x.query, lat: x.lat, lon: x.lon }
        if (!x.query) return null
        const r = await resolvePlace(x.query)
        return r ? { ...r, name: r.name || x.query } : null
      }
      const [o, d] = await Promise.all([p.origin ? resolve(p.origin) : getCurrent(), resolve(p.destination)])
      const disc = p.discount || discount
      if (p.discount) setDiscount(p.discount)
      const bits = []
      if (p.destination?.query) bits.push(`Papunta: ${p.destination.query}`)
      bits.push(`Mula: ${p.origin?.query || 'current location'}`)
      if (p.preference) bits.push(`Gusto: ${p.preference.replace('_', ' ')}`)
      if (p.discount) bits.push(`Discount: ${p.discount}`)
      setAiInfo(`${p.method === 'gemini' ? '✨ Gemini' : '🧠 Rules'} → ${bits.join(' · ')}`)
      if (!d) { setError(p.destination?.query ? `Hindi mahanap ang "${p.destination.query}". Subukan ang mas specific na lugar.` : 'Hindi ko nakuha kung saan ka pupunta. Subukan: "papunta sa Cubao".'); if (o) setOrigin(o); return }
      if (!o) { setError(`Hindi mahanap ang "${p.origin?.query}".`); setDestination(d); return }
      setOrigin(o); setDestination(d)
      await plan(o, d, disc, p.preference)
    } catch (e) { setError(e.message) } finally { setAiBusy(false) }
  }

  function onMapClick(ll) {
    if (tab !== 'plan' || t.itin) return
    setDestination({ name: `Pinned (${ll.lat.toFixed(4)}, ${ll.lng.toFixed(4)})`, lat: ll.lat, lon: ll.lng })
  }

  const selected = result?.itineraries?.find((i) => i.id === selectedId) || null
  const mapItin = t.itin || selected

  function startTrip(it) { t.start(it); setTab('track') }
  function checkFare(leg) { setFarePrefill({ ...leg, _k: Date.now() }); setTab('fare') }

  const panel = (
    <>
      {tab === 'plan' && (
        <PlanPanel
          aiText={aiText} setAiText={setAiText} onAsk={ask} aiBusy={aiBusy} aiInfo={aiInfo}
          origin={origin} setOrigin={setOrigin} destination={destination} setDestination={setDestination}
          useCurrent={useCurrent} locNotice={locNotice} discount={discount} setDiscount={setDiscount}
          onPlan={() => plan()} planning={planning} error={error} result={result}
          selectedId={selectedId} setSelectedId={setSelectedId} onStart={startTrip} onCheckFare={checkFare}
        />
      )}
      {tab === 'track' && <TrackPanel t={t} onGoPlan={() => setTab('plan')} />}
      {tab === 'fare' && <FareCheck prefill={farePrefill} discount={discount} userPos={t.pos || here} />}
      {tab === 'fares' && <FaresInfo />}
    </>
  )

  // Map height on phones / iPad portrait: bigger while tracking, user can expand/collapse
  const [mapSize, setMapSize] = useState('auto') // 'auto' | 'big' | 'small'
  const mapH = mapSize === 'big' ? 'h-[70dvh]' : mapSize === 'small' ? 'h-[22dvh]'
    : tab === 'track' ? 'h-[50dvh] md:h-[55dvh]' : (tab === 'fare' || tab === 'fares') ? 'h-[26dvh] md:h-[30dvh]' : 'h-[38dvh] md:h-[42dvh]'

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden lg:flex-row">
      {/* Panel: below the map on phone/iPad portrait, sidebar on iPad landscape/desktop */}
      <aside className="order-2 flex min-h-0 flex-1 flex-col bg-slate-50 lg:order-1 lg:w-[400px] lg:flex-none lg:border-r lg:border-slate-200 xl:w-[440px]">
        <header className="hidden items-center justify-between px-4 pt-4 lg:flex">
          <Logo aiMode={aiMode} />
        </header>
        <nav className="hidden gap-1 px-4 pt-3 lg:flex">
          {TABS.map((x) => (
            <button key={x.id} onClick={() => setTab(x.id)}
              className={`flex-1 rounded-lg py-2 text-xs font-bold ${tab === x.id ? 'bg-teal-700 text-white' : 'text-slate-500 hover:bg-slate-200'}`}>
              {x.icon} {x.label}{x.id === 'track' && t.itin ? ' •' : ''}
            </button>
          ))}
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:px-6 md:py-5 lg:p-4 lg:pb-6">
          <div className="mx-auto w-full max-w-3xl lg:max-w-none">{panel}</div>
        </div>
      </aside>

      {/* Map */}
      <main className={`relative order-1 shrink-0 transition-[height] duration-300 lg:order-2 lg:h-auto lg:flex-1 ${mapH}`}>
        <div className="absolute left-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[1000] rounded-xl bg-white/95 px-3 py-1.5 shadow lg:hidden"><Logo small aiMode={aiMode} /></div>
        <div className="absolute bottom-3 right-3 z-[1000] flex gap-1.5 lg:hidden">
          <button aria-label="Liitan ang mapa" onClick={() => setMapSize(mapSize === 'small' ? 'auto' : 'small')}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-lg shadow active:scale-95">{mapSize === 'small' ? '⤢' : '－'}</button>
          <button aria-label="Laki ng mapa" onClick={() => setMapSize(mapSize === 'big' ? 'auto' : 'big')}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-lg shadow active:scale-95">{mapSize === 'big' ? '⤡' : '⛶'}</button>
        </div>
        {tab === 'plan' && !t.itin && !destination && (
          <div className="pointer-events-none absolute bottom-3 left-3 z-[1000] rounded-full bg-slate-900/80 px-3 py-1 text-xs text-white lg:left-1/2 lg:-translate-x-1/2">I-tap ang mapa para i-set ang destinasyon</div>
        )}
        {t.para && tab !== 'track' && (
          <button onClick={() => setTab('track')} className="para-pulse absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[1000] max-w-[60%] truncate rounded-xl bg-red-600 px-3 py-2 text-sm font-black text-white shadow">🛑 PARA NA! {t.para.name}</button>
        )}
        <MapView origin={t.itin ? null : origin} destination={t.itin ? null : destination} itinerary={mapItin}
          userPos={t.pos || here} follow={!!t.itin} onMapClick={onMapClick} track={t.track} progressD={t.itin ? t.along : null} />
      </main>

      {/* Bottom nav: phones + iPad portrait */}
      <nav className="fixed inset-x-0 bottom-0 z-[1200] flex border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <div className="mx-auto flex w-full max-w-3xl">
          {TABS.map((x) => (
            <button key={x.id} onClick={() => { setTab(x.id); setMapSize('auto') }}
              className={`flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold md:min-h-[64px] md:flex-row md:gap-2 md:text-sm ${tab === x.id ? 'text-teal-700' : 'text-slate-400'}`}>
              <span className="relative text-lg">{x.icon}{x.id === 'track' && t.itin && <span className="absolute -right-1 top-0 h-2 w-2 rounded-full bg-red-500" />}</span>
              {x.label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  )
}

function Logo({ small, aiMode }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`flex items-center justify-center rounded-lg bg-teal-700 text-white ${small ? 'h-6 w-6 text-xs' : 'h-9 w-9 text-lg'}`}>🚏</div>
      <div>
        <div className={`font-black tracking-tight text-slate-900 ${small ? 'text-sm' : 'text-xl'}`}>Saan<span className="text-teal-700">Sakay</span></div>
        {!small && <div className="text-[11px] text-slate-500">AI commute guide · Metro Manila{aiMode ? ` · AI: ${aiMode}` : ''}</div>}
      </div>
    </div>
  )
}
