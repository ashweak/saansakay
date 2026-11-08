import { modeInfo, peso, fmtMin, fmtDist } from '../lib.js'

export default function TrackPanel({ t, onGoPlan }) {
  if (!t.itin) {
    return (
      <div className="rounded-2xl bg-white p-5 text-center shadow-sm">
        <div className="text-4xl">🧭</div>
        <h3 className="mt-2 font-bold">Wala pang active na biyahe</h3>
        <p className="mt-1 text-sm text-slate-500">Pumili ng ruta sa Plan tab, tapos i-tap ang <b>Start trip</b>. Aalertuhan ka namin bago ka bumaba — "Para alert".</p>
        <button onClick={onGoPlan} className="mt-4 rounded-xl bg-teal-700 px-5 py-3 text-sm font-bold text-white">Mag-plan ng biyahe</button>
      </div>
    )
  }
  const leg = t.itin.legs[t.legIdx] || t.itin.legs[0]
  const next = t.itin.legs[t.legIdx + 1]
  const m = modeInfo(leg.mode)
  const dest = t.itin.legs[t.itin.legs.length - 1].to
  const arrivalTime = t.etaMin != null ? new Date(Date.now() + t.etaMin * 60000).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }) : '—'

  return (
    <div className="space-y-3">
      {t.para && (
        <div className="para-pulse rounded-2xl bg-red-600 p-4 text-white shadow-lg">
          <div className="text-2xl font-black tracking-tight">🛑 PARA NA!</div>
          <div className="mt-1 text-sm">Bababa ka na sa <b>{t.para.name}</b>{t.para.final ? ' — malapit na ang destinasyon mo.' : '.'}</div>
          <button onClick={t.dismissPara} className="mt-3 rounded-lg bg-white/20 px-3 py-1.5 text-xs font-bold hover:bg-white/30">Okay, salamat!</button>
        </div>
      )}

      {t.arrived && (
        <div className="rounded-2xl bg-emerald-600 p-4 text-white shadow">
          <div className="text-xl font-black">🎉 Nakarating ka na!</div>
          <div className="mt-1 text-sm">Nasa {dest.name} ka na.</div>
          {t.arrived.sim
            ? <div className="mt-1 text-xs text-emerald-100">Demo simulation — hindi sinend ang ETA feedback.</div>
            : <div className="mt-1 text-xs text-emerald-100">
                Actual: {fmtMin(t.arrived.actual)} vs predicted {fmtMin(t.arrived.predicted)}.
                {t.arrived.sent ? ` Natuto ang ETA model${t.arrived.factor ? ` (factor ×${Number(t.arrived.factor).toFixed(2)})` : ''}. Salamat!` : ''}
              </div>}
        </div>
      )}

      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-xs font-semibold uppercase text-slate-400">Papunta sa</div>
            <div className="font-bold leading-tight">{dest.name}</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-black text-teal-700">{fmtMin(t.etaMin)}</div>
            <div className="text-[11px] text-slate-400">ETA {arrivalTime}</div>
          </div>
        </div>
        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-gradient-to-r from-teal-500 to-amber-400 transition-all" style={{ width: `${Math.round(t.progress * 100)}%` }} />
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-slate-500">
          <span>{Math.round(t.progress * 100)}% tapos</span>
          <span>{fmtDist(t.remaining)} pa</span>
        </div>
      </div>

      <div className="rounded-2xl border-l-4 bg-white p-4 shadow-sm" style={{ borderColor: m.color }}>
        <div className="text-xs font-semibold uppercase text-slate-400">Ngayon · step {t.legIdx + 1} of {t.itin.legs.length}</div>
        <div className="mt-1 flex items-center gap-2 font-bold" style={{ color: leg.mode === 'walk' ? '#334155' : m.color }}>
          <span className="text-xl">{m.icon}</span> {m.label}{leg.route_name ? ` · ${leg.route_name}` : ''}
        </div>
        <p className="mt-1 text-sm text-slate-700">{leg.instruction || `${leg.from.name} → ${leg.to.name}`}</p>
        {leg.mode !== 'walk' && <p className="mt-1 text-xs text-slate-500">Bababa sa: <b>{leg.to.name}</b> · Pamasahe: <b>{peso(leg.fare)}</b></p>}
        {next && (
          <p className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-500">
            Susunod: {modeInfo(next.mode).icon} {modeInfo(next.mode).label}{next.route_name ? ` · ${next.route_name}` : ''}
          </p>
        )}
      </div>

      {t.offRoute && !t.simulating && <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">⚠️ Mukhang lumayo ka sa ruta. Tingnan ang mapa.</div>}
      {t.gpsError && <div className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{t.gpsError}</div>}
      {t.accuracy != null && !t.simulating && <div className="text-[11px] text-slate-400">GPS accuracy ±{Math.round(t.accuracy)} m</div>}

      <div className="flex gap-2">
        {t.simulating
          ? <button onClick={t.pauseSim} className="flex-1 rounded-xl bg-slate-800 py-2.5 text-sm font-bold text-white">⏸ Pause demo</button>
          : <button onClick={t.simulate} className="flex-1 rounded-xl bg-slate-800 py-2.5 text-sm font-bold text-white">▶ Simulate ride (demo)</button>}
        <button onClick={t.stop} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700">End trip</button>
      </div>
      <p className="text-[11px] text-slate-400">Tip: Panatilihing bukas ang app para gumana ang live location at Para alert.</p>
    </div>
  )
}
