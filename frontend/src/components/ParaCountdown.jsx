import { modeInfo } from '../lib.js'

// 1 km → "1.0 km", then metres in 10 m steps so the number counts down smoothly
export const fmtCountdown = (m) => (m >= 995 ? `${(m / 1000).toFixed(1)} km` : `${Math.max(0, Math.round(m / 10) * 10)} m`)

function stage(c) {
  if (c.meters <= c.paraAt) return { tone: 'bg-red-600 text-white', bar: 'bg-white', label: 'PARA NA!', pulse: true }
  if (c.meters <= 500) return { tone: 'bg-amber-400 text-slate-900', bar: 'bg-slate-900', label: 'Maghanda nang bumaba', pulse: false }
  return { tone: 'bg-teal-700 text-white', bar: 'bg-white', label: 'Malapit na ang babaan', pulse: false }
}

/** Full card for the Track panel. */
export default function ParaCountdown({ c }) {
  if (!c) return null
  const s = stage(c)
  const pct = Math.min(100, Math.max(0, ((c.from - c.meters) / c.from) * 100))
  return (
    <div className={`overflow-hidden rounded-2xl p-4 shadow-lg transition-colors duration-500 ${s.tone} ${s.pulse ? 'para-pulse' : ''}`}
      role="status" aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-wider opacity-80">🚏 {s.label}</div>
          <div className="mt-0.5 truncate text-sm">Bababa sa <b>{c.name}</b></div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-3xl font-black tabular-nums leading-none">{fmtCountdown(c.meters)}</div>
          <div className="mt-1 text-[11px] opacity-80">{c.meters <= c.paraAt ? 'sabihin: "Para po!"' : 'na lang'}</div>
        </div>
      </div>
      {/* progress from 1 km to the stop, with markers at 500 m and the Para point */}
      <div className="relative mt-3 h-2.5 rounded-full bg-black/15">
        <div className={`absolute inset-y-0 left-0 rounded-full ${s.bar} transition-[width] duration-300 ease-linear`} style={{ width: `${pct}%` }} />
        <span className="absolute top-1/2 h-3.5 w-0.5 -translate-y-1/2 bg-current opacity-50" style={{ left: '50%' }} />
        <span className="absolute top-1/2 h-3.5 w-0.5 -translate-y-1/2 bg-current opacity-50" style={{ left: `${((c.from - c.paraAt) / c.from) * 100}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[10px] font-semibold opacity-75">
        <span>1 km</span><span>500 m</span><span>Para</span>
      </div>
    </div>
  )
}

/** Compact strip shown on top of the map. */
export function ParaCountdownPill({ c, onClick }) {
  if (!c) return null
  const s = stage(c)
  return (
    <button onClick={onClick}
      className={`flex min-w-0 max-w-full items-center gap-2 whitespace-nowrap rounded-full px-3.5 py-2 text-sm font-bold shadow-lg transition-colors duration-500 ${s.tone} ${s.pulse ? 'para-pulse' : ''}`}>
      <span>{c.meters <= c.paraAt ? '🛑' : modeInfo(c.mode).icon}</span>
      <span className="shrink-0 tabular-nums">{c.meters <= c.paraAt ? 'PARA NA!' : `Para sa ${fmtCountdown(c.meters)}`}</span>
      <span className="min-w-0 truncate font-medium opacity-90">· {c.name}</span>
    </button>
  )
}
