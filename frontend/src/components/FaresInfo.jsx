import { useEffect, useState } from 'react'
import { api, MODES, peso } from '../lib.js'

// Renders whatever shape /api/fares returns, with a friendly table for common fields
export default function FaresInfo() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => { api.fares().then(setData).catch((e) => setErr(e.message)) }, [])

  const modes = data ? normalize(data) : []
  const asOf = data?.fares_as_of || data?.as_of || data?.effective || data?.updated

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <h3 className="font-bold">📋 Official Fares (Metro Manila)</h3>
        {asOf && <p className="text-xs text-slate-500">Fares as of {asOf}</p>}
        {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
        {!data && !err && <p className="mt-2 text-xs text-slate-400">Loading…</p>}
        <div className="mt-3 space-y-2">
          {modes.map((m) => (
            <div key={m.key} className="rounded-xl border border-slate-100 p-3">
              <div className="flex items-center justify-between">
                <div className="font-semibold" style={{ color: MODES[m.key]?.color }}>{MODES[m.key]?.icon || '🚐'} {m.name}</div>
                {m.base != null && <div className="text-sm font-bold">{peso(m.base)}</div>}
              </div>
              <div className="mt-0.5 text-xs text-slate-500">
                {m.base_km != null && <>First {m.base_km} km{m.per_km != null ? ` · +${peso(m.per_km)}/km after` : ''}</>}
                {m.base_km == null && m.per_km != null && <>+{peso(m.per_km)}/km</>}
                {m.min != null && m.max != null && <> · {peso(m.min)}–{peso(m.max)}</>}
              </div>
              {m.note && <div className="mt-1 text-[11px] text-slate-400">{m.note}</div>}
            </div>
          ))}
        </div>
        {data?.discount_note && <p className="mt-3 text-xs text-slate-600">{data.discount_note}</p>}
        {!data?.discount_note && <p className="mt-3 text-xs text-slate-600">20% discount para sa students, seniors, at PWD (ipakita ang ID).</p>}
        {Array.isArray(data?.sources) && data.sources.length > 0 && (
          <div className="mt-3 text-[11px] text-slate-400">
            Sources: {data.sources.map((s, i) => (
              <span key={i}>{i > 0 && ', '}{typeof s === 'string' ? (s.startsWith('http') ? <a className="underline" href={s} target="_blank" rel="noreferrer">{new URL(s).hostname}</a> : s) : <a className="underline" href={s.url} target="_blank" rel="noreferrer">{s.title || s.url}</a>}</span>
            ))}
          </div>
        )}
      </div>
      <div className="rounded-2xl bg-amber-50 p-4 text-xs text-amber-900">
        <b>Paalala:</b> Ang mga ruta ay galing sa 2015 DOTC / Sakay.ph GTFS data, kaya maaaring luma na ang ilang jeep at bus routes (at hindi pa kasama ang mga bagong rail extensions). Ang train fares ay estimates — tingnan ang fare matrix sa istasyon. Laging i-verify sa LTFRB.
      </div>
      <div className="rounded-2xl bg-white p-4 text-xs text-slate-500 shadow-sm">
        <b className="text-slate-700">Tungkol sa SaanSakay</b><br />
        Libreng AI commute guide para sa Metro Manila: ruta, official na pamasahe, overcharge checker, at live tracking na may Para alert.
        Maps © OpenStreetMap contributors. Geocoding by Nominatim.
      </div>
    </div>
  )
}

function normalize(data) {
  // Accept {modes: {jeep: {...}}} or {modes: [{mode:..}]} or top-level {jeep: {...}}
  let src = data.modes || data.fares || data
  let entries = Array.isArray(src) ? src.map((v) => [v.mode || v.key || v.id, v]) : Object.entries(src)
  return entries
    .filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v))
    .map(([k, v]) => ({
      key: k,
      name: v.name || v.label || MODES[k]?.label || k,
      base: v.base ?? v.base_fare ?? v.minimum ?? v.min_fare,
      base_km: v.base_km ?? v.first_km ?? v.included_km,
      per_km: v.per_km ?? v.succeeding_km ?? v.per_succeeding_km,
      min: v.min, max: v.max,
      note: v.note || v.notes,
    }))
}
