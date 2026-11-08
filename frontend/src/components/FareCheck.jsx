import { useEffect, useState } from 'react'
import { api, DISCOUNTS, MODES, RIDE_MODES, peso } from '../lib.js'

export default function FareCheck({ prefill, discount, userPos }) {
  const [mode, setMode] = useState('jeep')
  const [km, setKm] = useState('')
  const [disc, setDisc] = useState(discount || 'regular')
  const [paid, setPaid] = useState('')
  const [routeName, setRouteName] = useState('')
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [note, setNote] = useState('')
  const [reported, setReported] = useState(null)
  const [reports, setReports] = useState([])
  const [repErr, setRepErr] = useState(null)

  useEffect(() => {
    if (prefill) {
      setMode(prefill.mode); setKm(String(prefill.distance_km ?? '')); setRouteName(prefill.route_name || '')
      setRes(null); setReported(null)
    }
  }, [prefill])
  useEffect(() => { if (discount) setDisc(discount) }, [discount])
  useEffect(() => { loadReports() }, [])

  async function loadReports() {
    try { setReports((await api.reports()) || []); setRepErr(null) } catch (e) { setRepErr(e.message) }
  }

  async function check(e) {
    e.preventDefault()
    setBusy(true); setErr(null); setRes(null); setReported(null)
    try {
      setRes(await api.fareCheck({ mode, distance_km: parseFloat(km), discount: disc, amount_paid: parseFloat(paid) }))
    } catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }

  async function report() {
    try {
      const r = await api.report({
        mode, route_name: routeName || null, distance_km: parseFloat(km), official_fare: res.official_fare,
        amount_paid: parseFloat(paid), note: note || null, lat: userPos?.[0] ?? null, lon: userPos?.[1] ?? null,
      })
      setReported(r?.id ?? true)
      loadReports()
    } catch (e) { setErr(e.message) }
  }

  const over = res?.verdict === 'overcharged'
  const under = res?.verdict === 'undercharged'

  return (
    <div className="space-y-3 md:grid md:grid-cols-2 md:items-start md:gap-4 md:space-y-0 lg:block lg:space-y-3">
      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <h3 className="font-bold">💸 Overcharge Checker</h3>
        <p className="text-xs text-slate-500">Alamin kung tama ang singil sa'yo base sa official LTFRB fare matrix.</p>
        <form onSubmit={check} className="mt-3 space-y-2.5">
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-3 xl:grid-cols-4">
            {RIDE_MODES.map((m) => (
              <button type="button" key={m} onClick={() => setMode(m)}
                className={`rounded-lg border px-2 py-1.5 text-xs font-semibold ${mode === m ? 'border-teal-500 bg-teal-50 text-teal-800' : 'border-slate-200 text-slate-600'}`}>
                {MODES[m].icon} {MODES[m].label}
              </button>
            ))}
          </div>
          <input className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm" placeholder="Route (optional) e.g. Cubao - Divisoria"
            value={routeName} onChange={(e) => setRouteName(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-slate-500">Layo (km)
              <input required type="number" min="0.1" step="0.1" inputMode="decimal" className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm text-slate-900"
                value={km} onChange={(e) => setKm(e.target.value)} placeholder="7.5" />
            </label>
            <label className="text-xs text-slate-500">Siningil sa'yo (₱)
              <input required type="number" min="0" step="0.25" inputMode="decimal" className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm text-slate-900"
                value={paid} onChange={(e) => setPaid(e.target.value)} placeholder="25" />
            </label>
          </div>
          <div className="flex rounded-xl bg-slate-100 p-1">
            {DISCOUNTS.map((d) => (
              <button key={d.value} type="button" onClick={() => setDisc(d.value)}
                className={`flex-1 rounded-lg py-1.5 text-xs font-semibold ${disc === d.value ? 'bg-white text-teal-700 shadow' : 'text-slate-500'}`}>{d.label}</button>
            ))}
          </div>
          <button disabled={busy} className="w-full rounded-xl bg-teal-700 py-3 text-sm font-bold text-white disabled:opacity-50">
            {busy ? 'Kinukuwenta…' : 'I-check ang pamasahe'}
          </button>
        </form>
        {err && <div className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">{err}</div>}
      </div>

      {res && (
        <div className={`rounded-2xl p-4 text-white shadow ${over ? 'bg-red-600' : under ? 'bg-sky-600' : 'bg-emerald-600'}`}>
          <div className="text-2xl font-black">{over ? '🚨 OVERCHARGED' : under ? '👍 Mas mababa pa' : '✅ TAMA ANG SINGIL'}</div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-lg bg-white/15 p-2"><div className="text-[11px] opacity-80">Official fare</div><div className="text-lg font-bold">{peso(res.official_fare)}</div></div>
            <div className="rounded-lg bg-white/15 p-2"><div className="text-[11px] opacity-80">{over ? 'Sobra' : 'Difference'}</div><div className="text-lg font-bold">{peso(Math.abs(res.difference))}</div></div>
          </div>
          {res.breakdown && <div className="mt-2 rounded-lg bg-black/15 px-2 py-1.5 font-mono text-xs">{res.breakdown}</div>}
          {res.message && <p className="mt-2 text-sm">{res.message}</p>}
          {over && (
            reported
              ? <div className="mt-3 rounded-lg bg-white/20 p-2 text-sm font-semibold">Salamat! Na-report na (#{reported}). Makakatulong ito sa ibang commuters.</div>
              : <div className="mt-3 space-y-2">
                  <input className="w-full rounded-lg px-3 py-3 text-sm text-slate-900" placeholder="Note (optional): plate no., oras, etc."
                    value={note} onChange={(e) => setNote(e.target.value)} />
                  <button onClick={report} className="w-full rounded-lg bg-white py-2 text-sm font-extrabold text-red-700">📣 I-report ang overcharging</button>
                </div>
          )}
        </div>
      )}

      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold">Recent community reports</h3>
          <button onClick={loadReports} className="text-xs text-teal-700">Refresh</button>
        </div>
        {repErr && <p className="mt-2 text-xs text-red-600">{repErr}</p>}
        {!repErr && reports.length === 0 && <p className="mt-2 text-xs text-slate-400">Wala pang reports.</p>}
        <ul className="mt-2 divide-y divide-slate-100">
          {reports.map((r) => (
            <li key={r.id} className="py-2 text-xs">
              <div className="flex justify-between gap-2">
                <span className="font-semibold">{MODES[r.mode]?.icon} {MODES[r.mode]?.label || r.mode}{r.route_name ? ` · ${r.route_name}` : ''}</span>
                <span className="shrink-0 font-bold text-red-600">+{peso(r.amount_paid - r.official_fare)}</span>
              </div>
              <div className="text-slate-500">Siningil {peso(r.amount_paid)} (official {peso(r.official_fare)}){r.note ? ` — ${r.note}` : ''}</div>
              {r.created_at && <div className="text-[10px] text-slate-400">{new Date(r.created_at).toLocaleString('en-PH')}</div>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
