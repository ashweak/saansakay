import ParaCountdown from './ParaCountdown.jsx'
import { modeInfo, peso, fmtMin, fmtDist } from '../lib.js'

// "Quirino Highway / Mindanao Avenue Intersection, Quezon City" -> "Quirino Highway / Mindanao Avenue Intersection"
const shortPlace = (n) => (n || '').split(',')[0].trim()
const clock = (min) => new Date(Date.now() + min * 60000).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })

function stepTitle(leg) {
  const m = modeInfo(leg.mode)
  if (leg.mode === 'walk') return `Maglakad ${fmtDist(leg.distance_km * 1000)}`
  return `${m.label}`
}

export default function TrackPanel({ t, onGoPlan, destName }) {
  if (!t.itin) {
    return (
      <div className="rounded-2xl bg-white p-6 text-center shadow-sm">
        <div className="text-4xl">🧭</div>
        <h3 className="mt-2 font-bold">Wala pang active na biyahe</h3>
        <p className="mt-1 text-sm text-slate-500">Pumili ng ruta sa Plan tab, tapos i-tap ang <b>Start trip</b>. Gagabayan ka namin hakbang-hakbang at aalertuhan bago ka bumaba.</p>
        <button onClick={onGoPlan} className="mt-4 rounded-xl bg-teal-700 px-5 py-3 text-sm font-bold text-white">Mag-plan ng biyahe</button>
      </div>
    )
  }

  const legs = t.itin.legs
  const li = Math.min(t.legIdx, legs.length - 1)
  const leg = legs[li]
  const m = modeInfo(leg.mode)
  const ends = t.track?.legEnds || []
  const legStart = li ? ends[li - 1] : 0
  const legLeft = Math.max(0, (ends[li] ?? 0) - t.along)
  const legLen = Math.max(1, (ends[li] ?? 1) - legStart)
  const dest = destName || shortPlace(legs[legs.length - 1].to.name)
  const totalFare = legs.reduce((s, l) => s + (l.fare || 0), 0)
  const next = legs.slice(li + 1).find((l) => l.mode !== 'walk' || l.distance_km > 0.05)
  const showCountdown = t.countdown && !(t.para && t.countdown.meters <= t.countdown.paraAt)
  
  return (
    <div className="space-y-3">
      {/* ── Trip summary ─────────────────────────────── */}
      <section className="rounded-2xl bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Papunta sa</div>
            <div className="truncate text-lg font-extrabold leading-tight">{t.arrived ? '🎉 ' : '📍 '}{dest}</div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-2xl font-black leading-none text-teal-700">{t.arrived ? 'Dumating' : fmtMin(t.etaMin)}</div>
            {!t.arrived && t.etaMin != null && <div className="mt-1 text-[11px] text-slate-500">Darating ~{clock(t.etaMin)}</div>}
          </div>
        </div>

        {/* progress, one segment per step, colored by vehicle */}
        <div className="mt-3 flex h-2.5 gap-0.5 overflow-hidden rounded-full">
          {legs.map((l, i) => {
            const s = i ? ends[i - 1] : 0
            const len = Math.max(1, (ends[i] ?? 0) - s)
            const fill = Math.min(1, Math.max(0, (t.along - s) / len))
            const c = l.mode === 'walk' ? '#94a3b8' : modeInfo(l.mode).line || modeInfo(l.mode).color
            return (
              <div key={i} className="relative h-full bg-slate-100" style={{ flexGrow: len, flexBasis: 0 }}>
                <div className="absolute inset-y-0 left-0 transition-[width] duration-300 ease-linear" style={{ width: `${fill * 100}%`, background: c }} />
              </div>
            )
          })}
        </div>
        <div className="mt-2 grid grid-cols-3 text-center text-xs">
          <div><div className="font-bold text-slate-800">{fmtDist(t.remaining)}</div><div className="text-slate-400">layo pa</div></div>
          <div className="border-x border-slate-100"><div className="font-bold text-slate-800">{Math.round(t.progress * 100)}%</div><div className="text-slate-400">tapos na</div></div>
          <div><div className="font-bold text-slate-800">{peso(totalFare)}</div><div className="text-slate-400">kabuuang bayad</div></div>
        </div>
      </section>

      {/* ── Alerts ───────────────────────────────────── */}
      {showCountdown && <ParaCountdown c={t.countdown} />}
      {t.para && (
        <section className="para-pulse rounded-2xl bg-red-600 p-4 text-white shadow-lg" role="alert">
          <div className="text-2xl font-black tracking-tight">🛑 PARA NA!</div>
          <div className="mt-1 text-sm">Bumaba sa <b>{shortPlace(t.para.name)}</b>{t.para.final ? ' — malapit na ang destinasyon mo.' : '.'}</div>
          <div className="mt-2 rounded-lg bg-white/15 px-3 py-2 text-sm">Sabihin: <b>"Para po!"</b> o pumara sa tabi.</div>
          <button onClick={t.dismissPara} className="mt-3 rounded-lg bg-white/20 px-3 py-1.5 text-xs font-bold hover:bg-white/30">Okay, salamat!</button>
        </section>
      )}
      {t.arrived && (
        <section className="rounded-2xl bg-emerald-600 p-4 text-white shadow">
          <div className="text-xl font-black">🎉 Nakarating ka na!</div>
          <div className="mt-1 text-sm">Nasa {dest} ka na. Ingat!</div>
          <div className="mt-1 text-xs text-emerald-100">
            {t.arrived.sim
              ? 'Demo lang ito — hindi isinama sa pag-aaral ng ETA.'
              : <>Aktwal: {fmtMin(t.arrived.actual)} · Tantiya: {fmtMin(t.arrived.predicted)}.{t.arrived.sent ? ' Salamat — natuto ang ETA model.' : ''}</>}
          </div>
        </section>
      )}

      {/* ── Current step ─────────────────────────────── */}
      {!t.arrived && (
        <section className="overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="flex items-center justify-between px-4 pt-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">
            <span>Ngayon · Hakbang {li + 1} ng {legs.length}</span>
            <span className="tabular-nums">{fmtDist(legLeft)} pa</span>
          </div>

          {leg.mode === 'walk' ? (
            <div className="px-4 pb-4 pt-2">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-2xl">🚶</div>
                <div className="min-w-0">
                  <div className="text-lg font-extrabold leading-tight">Maglakad</div>
                  <div className="text-sm text-slate-600">papunta sa <b>{shortPlace(leg.to.name === 'Destination' ? dest : leg.to.name)}</b></div>
                </div>
              </div>
              {next && next.mode !== 'walk' && (
                <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  Doon, sumakay ng <b>{modeInfo(next.mode).label}</b> na may karatulang <b>"{next.route_name}"</b>.
                </div>
              )}
            </div>
          ) : (
            <div className="px-4 pb-4 pt-2">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-2xl text-white" style={{ background: m.line || m.color }}>{m.icon}</div>
                <div className="min-w-0">
                  <div className="text-lg font-extrabold leading-tight">Sakay ng {m.label}</div>
                  <div className="text-xs text-slate-500">{leg.stops_count} stops · {fmtDist(leg.distance_km * 1000)}</div>
                </div>
              </div>
              {/* route signboard, like the sign on the jeep's windshield */}
              <div className="mt-3 rounded-lg border-2 px-3 py-2 text-center text-sm font-black uppercase tracking-wide"
                style={{ borderColor: m.line || m.color, color: m.line || m.color, background: `${m.color}14` }}>
                {leg.route_name}
              </div>
              <dl className="mt-3 space-y-2 text-sm">
                <Row icon="🟢" label="Sakay sa" value={shortPlace(leg.from.name)} />
                <Row icon="🔴" label="Baba sa" value={shortPlace(leg.to.name)} strong />
                <Row icon="💸" label="Ihanda" value={<>{peso(leg.fare)} <span className="text-xs font-normal text-slate-400">pamasahe</span></>} />
              </dl>
              {/* progress within this ride */}
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full transition-[width] duration-300 ease-linear" style={{ width: `${(1 - legLeft / legLen) * 100}%`, background: m.line || m.color }} />
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── All steps ────────────────────────────────── */}
      <section className="rounded-2xl bg-white p-4 shadow-sm">
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Mga hakbang</div>
        <ol className="relative">
          {legs.map((l, i) => {
            const st = t.arrived || i < li ? 'done' : i === li ? 'now' : 'next'
            const mi = modeInfo(l.mode)
            const color = l.mode === 'walk' ? '#94a3b8' : mi.line || mi.color
            const last = i === legs.length - 1
            return (
              <li key={i} className="relative flex gap-3 pb-3 last:pb-0">
                {!last && <span className="absolute left-[13px] top-7 bottom-0 w-0.5" style={{ background: st === 'done' ? '#cbd5e1' : color, opacity: st === 'next' ? 0.35 : 1 }} />}
                <span className={`relative z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm ${st === 'now' ? 'ring-4 ring-teal-100' : ''}`}
                  style={{ background: st === 'done' ? '#e2e8f0' : st === 'now' ? color : '#fff', border: `2px solid ${st === 'done' ? '#e2e8f0' : color}`, color: st === 'now' ? '#fff' : '#334155' }}>
                  {st === 'done' ? '✓' : mi.icon}
                </span>
                <div className={`min-w-0 flex-1 ${st === 'done' ? 'text-slate-400' : ''}`}>
                  <div className={`text-sm ${st === 'now' ? 'font-extrabold' : 'font-semibold'}`}>
                    {stepTitle(l)}{l.mode !== 'walk' && <span className="font-normal"> · {l.route_name}</span>}
                  </div>
                  <div className="text-xs text-slate-500">
                    {l.mode === 'walk'
                      ? `papunta sa ${shortPlace(l.to.name === 'Destination' ? dest : l.to.name)} · ~${Math.max(1, Math.round(l.minutes))} min`
                      : `Baba sa ${shortPlace(l.to.name)} · ${peso(l.fare)} · ~${Math.round(l.minutes)} min`}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      </section>

      {/* ── Status (one plain notice at a time, most important first) ── */}
      {(() => {
        if (t.simulating) return <StatusLine dot="bg-indigo-500" text="Demo mode — simulated na biyahe" />
        if (t.gpsError) return <Notice tone="red" title="Walang location" text={t.gpsError} />
        if (t.gpsWeak) return <Notice tone="slate" title="Hindi tumpak ang location ng device na ito"
          text={`Hula lang mula sa internet (±${t.accuracy >= 1000 ? Math.round(t.accuracy / 1000) + " km" : Math.round(t.accuracy) + " m"}), kaya hindi muna gagalaw ang posisyon mo. Buksan sa phone na may GPS, o i-try ang Simulate.`} />
        if (t.farAway) return <Notice tone="slate" title={`Malayo ka sa rutang ito (~${t.farAway} km)`}
          text="Gagalaw ang posisyon mo kapag nasa ruta ka na. Puwede ring mag-plan mula sa kinaroroonan mo." />
        if (t.offRoute) return <Notice tone="amber" title="Lumayo ka sa ruta"
          text="Bumalik sa ruta na nasa mapa, o mag-plan ulit mula sa kinaroroonan mo." />
        if (t.accuracy != null) return <StatusLine dot="bg-emerald-500" text={`Live GPS · ±${Math.round(t.accuracy)} m`} />
        return <StatusLine dot="bg-slate-300 animate-pulse" text="Hinahanap ang GPS signal…" />
      })()}

      {/* ── Controls ─────────────────────────────────── */}
      <div className="flex gap-2">
        {t.simulating
          ? <button onClick={t.pauseSim} className="flex-1 rounded-xl bg-slate-800 py-3 text-sm font-bold text-white">⏸ I-pause ang demo</button>
          : <button onClick={t.simulate} className="flex-1 rounded-xl bg-slate-800 py-3 text-sm font-bold text-white">▶ Simulate ride (demo)</button>}
        <button onClick={t.stop} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-bold text-slate-700">Tapusin</button>
      </div>
      <p className="text-center text-[11px] text-slate-400">Panatilihing bukas ang app para gumana ang live location at Para alert.</p>
    </div>
  )
}

function Row({ icon, label, value, strong }) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-5 shrink-0 text-center text-xs leading-5">{icon}</span>
      <dt className="w-16 shrink-0 text-slate-500">{label}</dt>
      <dd className={`min-w-0 flex-1 ${strong ? 'font-bold text-slate-900' : 'text-slate-800'}`}>{value}</dd>
    </div>
  )
}

const TONES = {
  amber: { bar: 'bg-amber-400', icon: '⚠️' },
  red: { bar: 'bg-red-500', icon: '⛔' },
  slate: { bar: 'bg-slate-400', icon: 'ℹ️' },
}

// Plain but noticeable: white card, colored edge, one-line title + one helpful line
function Notice({ tone = 'slate', title, text }) {
  const t = TONES[tone]
  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white py-2.5 pl-4 pr-3 shadow-sm" role="status">
      <span className={`absolute inset-y-0 left-0 w-1 ${t.bar}`} />
      <div className="flex gap-2">
        <span className="text-sm leading-5">{t.icon}</span>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-800">{title}</div>
          <div className="text-xs leading-relaxed text-slate-500">{text}</div>
        </div>
      </div>
    </div>
  )
}

function StatusLine({ dot, text }) {
  return (
    <div className="flex items-center gap-2 px-1 text-xs text-slate-500">
      <span className={`h-2 w-2 rounded-full ${dot}`} />{text}
    </div>
  )
}
