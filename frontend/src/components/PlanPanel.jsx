import { useEffect, useRef, useState } from 'react'
import PlaceInput from './PlaceInput.jsx'
import { DISCOUNTS, modeInfo, peso, fmtMin, fmtDist, RIDE_MODES } from '../lib.js'

const EXAMPLES = [
  'Paano pumunta sa SM North galing Fairview?',
  'Cubao to Ayala, pinakamura',
  'Papunta ako sa Intramuros, student ako',
]

export default function PlanPanel({
  aiText, setAiText, onAsk, aiBusy, aiInfo,
  origin, setOrigin, destination, setDestination, useCurrent, locNotice,
  discount, setDiscount, onPlan, planning, error,
  result, selectedId, setSelectedId, onStart, onCheckFare,
}) {
  const resultsRef = useRef(null)
  // On phones/tablets the results sit below the form: bring them into view when they arrive
  useEffect(() => {
    if (result) resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [result])
  return (
    <div className="space-y-3">
      {/* AI search */}
      <form onSubmit={(e) => { e.preventDefault(); onAsk() }} className="rounded-2xl bg-gradient-to-br from-teal-600 to-teal-800 p-3 text-white shadow">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">✨ Tanong kay SaanSakay AI</div>
        <div className="flex gap-2">
          <input
            className="min-w-0 flex-1 rounded-xl bg-white/95 px-3 py-3 text-base md:text-sm text-slate-900 outline-none placeholder:text-slate-400"
            placeholder="Saan ka pupunta? e.g. 'Paano pumunta sa SM North galing Fairview'"
            value={aiText}
            onChange={(e) => setAiText(e.target.value)}
          />
          <button disabled={aiBusy || !aiText.trim()} className="shrink-0 rounded-xl bg-amber-400 px-4 text-sm font-bold text-slate-900 disabled:opacity-50">
            {aiBusy ? '…' : 'Go'}
          </button>
        </div>
        <div className={`mt-2 flex-wrap gap-1.5 ${result ? 'hidden lg:flex' : 'flex'}`}>
          {EXAMPLES.map((ex) => (
            <button type="button" key={ex} onClick={() => setAiText(ex)} className="rounded-full bg-white/15 px-3 py-1.5 text-xs hover:bg-white/25">{ex}</button>
          ))}
        </div>
        {aiInfo && <div className="mt-2 text-xs text-teal-50/90">{aiInfo}</div>}
      </form>

      {/* Manual inputs */}
      <div className="space-y-2">
        <div className="space-y-2 md:grid md:grid-cols-2 md:gap-3 md:space-y-0 lg:block lg:space-y-2">
        <PlaceInput label="Mula" dotColor="#0f766e" value={origin} onSelect={setOrigin}
          placeholder="Saan ka galing?" allowCurrent onUseCurrent={useCurrent} />
        <PlaceInput label="Papunta" dotColor="#dc2626" value={destination} onSelect={setDestination}
          placeholder="Saan ka pupunta? (o i-tap ang mapa)" />
        </div>
        {locNotice && <p className="text-xs text-amber-700">{locNotice}</p>}
        <div className="flex items-center gap-2">
          <div className="flex flex-1 rounded-xl bg-slate-100 p-1">
            {DISCOUNTS.map((d) => (
              <button key={d.value} type="button" onClick={() => setDiscount(d.value)}
                className={`flex-1 min-h-[40px] rounded-lg py-2 text-xs font-semibold transition md:text-sm ${discount === d.value ? 'bg-white text-teal-700 shadow' : 'text-slate-500'}`}>
                {d.label}
              </button>
            ))}
          </div>
        </div>
        <button onClick={onPlan} disabled={!origin || !destination || planning}
          className="w-full rounded-xl bg-teal-700 py-3 text-sm font-bold text-white shadow hover:bg-teal-800 disabled:bg-slate-300">
          {planning ? 'Hinahanap ang ruta…' : 'Hanapin ang ruta 🔎'}
        </button>
        {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      </div>

      {/* Results */}
      {result && (
        <div ref={resultsRef} className="scroll-mt-3 space-y-2 md:grid md:grid-cols-2 md:items-start md:gap-3 md:space-y-0 lg:block lg:space-y-2">
          {result.warnings?.map((w, i) => (
            <div key={i} className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 md:col-span-2">⚠️ {w}</div>
          ))}
          {result.itineraries?.length === 0 && (
            <div className="rounded-xl bg-white p-4 text-sm text-slate-600 shadow-sm md:col-span-2">Walang nahanap na ruta. Subukan ang ibang lugar o mas malapit na landmark.</div>
          )}
          {[...(result.itineraries || [])].sort((a, b) => (b.id === selectedId) - (a.id === selectedId)).map((it) => (
            <ItineraryCard key={it.id} it={it} selected={it.id === selectedId}
              onSelect={() => setSelectedId(it.id)} onStart={() => onStart(it)} onCheckFare={onCheckFare} />
          ))}
          {result.fares_as_of && <p className="px-1 text-[11px] text-slate-400 md:col-span-2">Official LTFRB fares as of {result.fares_as_of}. Routes from DOTC/Sakay.ph GTFS (2015) — maaaring luma na ang ilang ruta.</p>}
        </div>
      )}
    </div>
  )
}

function ItineraryCard({ it, selected, onSelect, onStart, onCheckFare }) {
  const rides = it.legs.filter((l) => l.mode !== 'walk')
  return (
    <div onClick={onSelect}
      className={`cursor-pointer rounded-2xl border bg-white p-3 shadow-sm transition ${selected ? 'border-teal-500 ring-2 ring-teal-100 md:col-span-2 lg:col-span-1' : 'border-slate-200 hover:border-slate-300'}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="mb-1 flex flex-wrap gap-1">
            {(it.label || '').split('·').map((l) => l.trim()).filter(Boolean).map((l) => (
              <span key={l} className="rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-bold text-teal-700">{l}</span>
            ))}
          </div>
          <div className="text-xl font-extrabold">{fmtMin(it.total_minutes)}</div>
          <div className="text-xs text-slate-500">
            {it.transfers} transfer{it.transfers === 1 ? '' : 's'} · {fmtDist(it.walk_meters)} lakad
          </div>
        </div>
        <div className="text-right">
          <div className="text-xl font-extrabold text-teal-700">{peso(it.total_fare)}</div>
          <div className="text-[11px] text-slate-400">total pamasahe</div>
        </div>
      </div>
      {/* mode chain */}
      <div className="mt-2 flex flex-wrap items-center gap-1 text-xs">
        {it.legs.map((l, i) => {
          const m = modeInfo(l.mode)
          return (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="text-slate-300">›</span>}
              <span className="rounded-md px-1.5 py-0.5 font-semibold" style={{ background: m.color + '22', color: l.mode === 'walk' ? '#475569' : m.color }}>
                {m.icon} {l.mode === 'walk' ? `${Math.max(1, Math.round(l.minutes))}m` : m.label}
              </span>
            </span>
          )
        })}
      </div>

      {selected && (
        <div className="mt-3 space-y-0 border-t border-slate-100 pt-3">
          {it.legs.map((l, i) => <LegRow key={i} leg={l} onCheckFare={onCheckFare} />)}
          <button onClick={(e) => { e.stopPropagation(); onStart() }}
            className="mt-3 w-full rounded-xl bg-amber-400 py-3 text-sm font-extrabold text-slate-900 shadow hover:bg-amber-500">
            ▶ Start trip + Para alert
          </button>
        </div>
      )}
      {!selected && rides.length > 0 && (
        <div className="mt-1 truncate text-[11px] text-slate-400">{rides.map((r) => r.route_name).filter(Boolean).join(' → ')}</div>
      )}
    </div>
  )
}

function LegRow({ leg, onCheckFare }) {
  const m = modeInfo(leg.mode)
  const isRide = RIDE_MODES.includes(leg.mode)
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className="flex h-7 w-7 items-center justify-center rounded-full text-sm" style={{ background: m.color + '22' }}>{m.icon}</div>
        <div className="w-0.5 flex-1" style={{ background: leg.mode === 'walk' ? 'repeating-linear-gradient(#cbd5e1 0 4px, transparent 4px 8px)' : m.color }} />
      </div>
      <div className="min-w-0 flex-1 pb-3">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-sm font-semibold" style={{ color: leg.mode === 'walk' ? '#334155' : m.color }}>
            {m.label}{leg.route_name ? <span className="font-normal text-slate-700"> · {leg.route_name}</span> : null}
          </div>
          {isRide && <div className="shrink-0 text-sm font-bold">{peso(leg.fare)}</div>}
        </div>
        <div className="text-xs text-slate-600">{leg.instruction || `${leg.from?.name} → ${leg.to?.name}`}</div>
        <div className="mt-0.5 text-[11px] text-slate-400">
          {fmtMin(leg.minutes)} · {leg.distance_km?.toFixed?.(1) ?? leg.distance_km} km
          {leg.stops_count ? ` · ${leg.stops_count} stops` : ''}
          {leg.fare_note ? ` · ${leg.fare_note}` : ''}
        </div>
        {isRide && (
          <button onClick={(e) => { e.stopPropagation(); onCheckFare(leg) }}
            className="mt-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
            💸 Check fare / overcharge
          </button>
        )}
      </div>
    </div>
  )
}
