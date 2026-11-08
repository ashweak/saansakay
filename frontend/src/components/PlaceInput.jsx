import { useEffect, useRef, useState } from 'react'
import { api, nominatim } from '../lib.js'

// Autocomplete input: merges local transit stops (/api/places) with Nominatim (debounced ≥1s)
export default function PlaceInput({ label, value, onSelect, placeholder, allowCurrent, onUseCurrent, dotColor }) {
  const [text, setText] = useState(value?.name || '')
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const localTimer = useRef(null)
  const osmTimer = useRef(null)
  const abortRef = useRef(null)
  const lastOsm = useRef(0)

  useEffect(() => { setText(value?.name || '') }, [value])

  function search(q) {
    clearTimeout(localTimer.current)
    clearTimeout(osmTimer.current)
    if (abortRef.current) abortRef.current.abort()
    if (q.trim().length < 2) { setItems([]); return }
    setLoading(true)
    localTimer.current = setTimeout(async () => {
      try {
        const local = await api.places(q, 6)
        setItems((prev) => merge(local || [], prev.filter((p) => p.source === 'osm')))
      } catch { /* ignore */ }
    }, 250)
    // Nominatim usage policy: max 1 req/s
    const wait = Math.max(1000, 1100 - (Date.now() - lastOsm.current))
    osmTimer.current = setTimeout(async () => {
      lastOsm.current = Date.now()
      const ctrl = new AbortController()
      abortRef.current = ctrl
      try {
        const osm = await nominatim(q, ctrl.signal)
        setItems((prev) => merge(prev.filter((p) => p.source !== 'osm'), osm))
      } catch { /* ignore */ } finally { setLoading(false) }
    }, wait)
  }

  function merge(a, b) {
    const seen = new Set()
    return [...a, ...b].filter((p) => {
      const k = p.name.toLowerCase() + Math.round(p.lat * 1000) + Math.round(p.lon * 1000)
      if (seen.has(k)) return false
      seen.add(k)
      return true
    }).slice(0, 10)
  }

  return (
    <div className="relative">
      <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-100">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: dotColor }} />
        <span className="w-16 shrink-0 text-xs font-semibold uppercase text-slate-400">{label}</span>
        <input
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          value={text}
          placeholder={placeholder}
          onChange={(e) => { setText(e.target.value); setOpen(true); search(e.target.value) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
        />
        {text && (
          <button type="button" className="text-slate-400 hover:text-slate-600" onClick={() => { setText(''); setItems([]); onSelect(null) }} aria-label="Clear">✕</button>
        )}
      </label>
      {open && (allowCurrent || items.length > 0 || loading) && (
        <ul className="absolute z-[1100] mt-1 max-h-72 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {allowCurrent && (
            <li>
              <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-teal-50" onMouseDown={(e) => e.preventDefault()} onClick={() => { onUseCurrent(); setOpen(false) }}>
                📍 <span className="font-medium text-teal-700">Current location ko</span>
              </button>
            </li>
          )}
          {items.map((p, i) => (
            <li key={i}>
              <button type="button" className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onSelect(p); setText(p.name); setOpen(false) }}>
                <span>{p.source === 'stop' ? '🚏' : '📌'}</span>
                <span className="min-w-0">
                  <span className="block truncate">{p.name}</span>
                  <span className="text-xs text-slate-400">{p.source === 'stop' ? 'Transit stop' : 'OpenStreetMap'}</span>
                </span>
              </button>
            </li>
          ))}
          {loading && <li className="px-3 py-2 text-xs text-slate-400">Naghahanap…</li>}
        </ul>
      )}
    </div>
  )
}
