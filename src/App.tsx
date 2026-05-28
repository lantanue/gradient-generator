import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MeshCanvas, type MeshPoint } from './components/MeshCanvas'
import { PRESETS, type Preset } from './presets'

/* ─── helpers ──────────────────────────────────────────────── */

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n))
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hslToHex(h: number, s: number, l: number) {
  s /= 100
  l /= 100
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) =>
    l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0')
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`
}

function randomPastelPalette(rnd: () => number, count: number) {
  const base = rnd() * 360
  const step = 360 / Math.max(3, count)
  return Array.from({ length: count }, (_, i) => {
    const hue = (base + i * step + (rnd() - 0.5) * 28) % 360
    const sat = 60 + rnd() * 18
    const lit = 72 + (rnd() - 0.5) * 10
    return hslToHex(hue, sat, lit)
  })
}

function newPoints(seed: number, count: number): MeshPoint[] {
  const rnd = mulberry32(seed)
  const colors = randomPastelPalette(rnd, count)
  return Array.from({ length: count }, (_, i) => ({
    id: `p_${seed}_${i}_${Math.round(rnd() * 1e9)}`,
    color: colors[i] ?? '#77eab5',
    x: 0.1 + rnd() * 0.8,
    y: 0.1 + rnd() * 0.8,
    size: 0.35 + rnd() * 0.55,
  }))
}

function presetToCss(points: Array<{ color: string; x: number; y: number }>): string {
  return points
    .map((p) => {
      const x = (p.x * 100).toFixed(1)
      const y = (p.y * 100).toFixed(1)
      return `radial-gradient(circle at ${x}% ${y}%, ${p.color} 0%, transparent 65%)`
    })
    .join(', ')
}

/* ─── preset card ──────────────────────────────────────────── */

function PresetCard({
  preset,
  active,
  onClick,
}: {
  preset: Preset
  active: boolean
  onClick: () => void
}) {
  const bg = useMemo(() => presetToCss(preset.points), [preset])

  return (
    <button
      className={`presetCard${active ? ' presetCard--active' : ''}`}
      onClick={onClick}
      title={preset.name}
    >
      <div className="presetThumb" style={{ background: bg }} />
      <div className="presetInfo">
        <span className="presetName">{preset.name}</span>
        <div className="presetDots">
          {preset.points.map((p, i) => (
            <span
              key={i}
              className="presetDot"
              style={{ background: p.color }}
              title={p.color}
            />
          ))}
        </div>
      </div>
    </button>
  )
}

/* ─── toast ────────────────────────────────────────────────── */

function Toast({ message, visible }: { message: string; visible: boolean }) {
  return (
    <div className={`toast${visible ? ' toast--visible' : ''}`}>{message}</div>
  )
}

/* ─── app ──────────────────────────────────────────────────── */

export default function App() {
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9))
  const [points, setPoints] = useState<MeshPoint[]>(() => newPoints(seed, 5))
  const stageRef = useRef<HTMLDivElement | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const colorInputRef = useRef<HTMLInputElement | null>(null)
  const [activeColorId, setActiveColorId] = useState<string | null>(null)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [activePresetId, setActivePresetId] = useState<string | null>(null)
  const [toast, setToast] = useState({ message: '', visible: false })
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /* ─── css export ─── */
  const exportCss = useMemo(() => {
    const layers = points
      .map((p) => {
        const x = clamp01(p.x) * 100
        const y = clamp01(p.y) * 100
        const r = 28 + clamp01(p.size) * 42
        return `  radial-gradient(circle at ${x.toFixed(1)}% ${y.toFixed(1)}%, ${p.color} 0%, rgba(255,255,255,0) ${r.toFixed(1)}%)`
      })
      .join(',\n')
    return `.mesh {\n  background:\n${layers};\n}`
  }, [points])

  /* ─── toast ─── */
  function showToast(msg: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ message: msg, visible: true })
    toastTimer.current = setTimeout(
      () => setToast((t) => ({ ...t, visible: false })),
      2200,
    )
  }

  /* ─── export PNG ─── */
  const handleExport = useCallback(() => {
    const gl = stageRef.current?.querySelector('canvas')
    if (!gl) return
    // WebGL canvas needs preserveDrawingBuffer=true to read pixels.
    // We fall back to a screenshot approach using toDataURL.
    try {
      const url = gl.toDataURL('image/png')
      const a = document.createElement('a')
      a.download = 'gradient.png'
      a.href = url
      a.click()
      showToast('PNG saved!')
    } catch {
      showToast('Enable "preserveDrawingBuffer" to export')
    }
  }, [])

  /* ─── preset apply ─── */
  function applyPreset(preset: Preset) {
    const newPts: MeshPoint[] = preset.points.map((p, i) => ({
      id: `preset_${preset.id}_${i}`,
      color: p.color,
      x: p.x,
      y: p.y,
      size: p.size,
    }))
    setPoints(newPts)
    setActivePresetId(preset.id)
    setGalleryOpen(false)
  }

  /* ─── drag ─── */
  function onPointerDown(id: string) {
    setDragId(id)
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragId) return
    const el = stageRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = clamp01((e.clientX - rect.left) / rect.width)
    const y = clamp01((e.clientY - rect.top) / rect.height)
    setPoints((prev) =>
      prev.map((p) => (p.id === dragId ? { ...p, x, y } : p)),
    )
    setActivePresetId(null)
  }

  function onPointerUp() {
    setDragId(null)
  }

  /* ─── point actions ─── */
  function updatePoint(id: string, patch: Partial<MeshPoint>) {
    setPoints((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)))
    setActivePresetId(null)
  }

  function addPoint() {
    const nextSeed = (seed + 1) | 0
    const rnd = mulberry32(nextSeed)
    setSeed(nextSeed)
    setPoints((prev) => [
      ...prev,
      {
        id: `p_${nextSeed}_${prev.length}_${Math.round(rnd() * 1e9)}`,
        color: hslToHex(rnd() * 360, 66 + rnd() * 14, 72 + (rnd() - 0.5) * 10),
        x: 0.15 + rnd() * 0.7,
        y: 0.15 + rnd() * 0.7,
        size: 0.45,
      },
    ])
    setActivePresetId(null)
  }

  function removeLastPoint() {
    setPoints((prev) => (prev.length <= 2 ? prev : prev.slice(0, -1)))
    setActivePresetId(null)
  }

  function randomize() {
    const nextSeed = Math.floor(Math.random() * 1e9)
    setSeed(nextSeed)
    setPoints(newPoints(nextSeed, points.length))
    setActivePresetId(null)
  }

  async function copyCss() {
    await navigator.clipboard.writeText(exportCss)
    showToast('CSS copied to clipboard!')
  }

  function openColorPicker(id: string) {
    const p = points.find((x) => x.id === id)
    if (!p) return
    setActiveColorId(id)
    const input = colorInputRef.current
    if (!input) return
    input.value = p.color
    input.click()
  }

  /* ─── keyboard ─── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setGalleryOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <div className="app">
      {/* ── gradient stage ── */}
      <div
        className="stage"
        ref={stageRef}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <MeshCanvas className="stageCanvas" points={points} />

        {/* draggable color handles */}
        <div className="handles" aria-hidden="true">
          {points.map((p) => (
            <div
              key={p.id}
              className="handleWrap"
              style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
            >
              <button
                className="handle"
                onPointerDown={() => onPointerDown(p.id)}
                onClick={() => openColorPicker(p.id)}
                title={`${p.color} — drag to move, click to change color`}
              />
              <button
                className="handleLabel"
                onClick={() => openColorPicker(p.id)}
              >
                {p.color.toUpperCase()}
              </button>
            </div>
          ))}
        </div>

        {/* ── top bar ── */}
        <header className="topBar">
          <span className="topBarTitle">Gradient</span>
          <nav className="topBarActions">
            <button
              className="topBtn"
              onClick={() => setGalleryOpen(true)}
              title="Open presets gallery"
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                <rect x="1" y="1" width="6" height="6" rx="1.5" fill="currentColor"/>
                <rect x="9" y="1" width="6" height="6" rx="1.5" fill="currentColor"/>
                <rect x="1" y="9" width="6" height="6" rx="1.5" fill="currentColor"/>
                <rect x="9" y="9" width="6" height="6" rx="1.5" fill="currentColor"/>
              </svg>
              Presets
            </button>
            <button className="topBtn" onClick={copyCss} title="Copy gradient CSS">
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                <rect x="5" y="1.5" width="9" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
                <rect x="2" y="4.5" width="9" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" fill="rgba(255,255,255,0.08)"/>
              </svg>
              Copy CSS
            </button>
            <button
              className="topBtn topBtn--accent"
              onClick={handleExport}
              title="Download as PNG"
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                <path d="M8 2v8M5 7.5l3 3 3-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 13h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
              </svg>
              Export
            </button>
          </nav>
        </header>

        {/* ── bottom toolbar ── */}
        <footer className="toolbar">
          <button className="toolBtn" onClick={randomize}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path d="M2 5h8M7 3l3 2-3 2M14 11H6M9 9l3 2-3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Randomize
          </button>
          <span className="toolSep" />
          <button
            className="toolBtn"
            onClick={addPoint}
            disabled={points.length >= 8}
            title="Add color point"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M8 5v6M5 8h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            Add point
          </button>
          <button
            className="toolBtn toolBtn--ghost"
            onClick={removeLastPoint}
            disabled={points.length <= 2}
            title="Remove last point"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M5 8h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
          <span className="toolSep" />
          <span className="toolCount">{points.length} pts</span>
        </footer>
      </div>

      {/* ── gallery overlay ── */}
      <div
        className={`galleryOverlay${galleryOpen ? ' galleryOverlay--open' : ''}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) setGalleryOpen(false)
        }}
      >
        <div className="galleryPanel">
          <div className="galleryHeader">
            <h2 className="galleryTitle">Presets</h2>
            <button
              className="galleryClose"
              onClick={() => setGalleryOpen(false)}
              title="Close"
            >
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                <path
                  d="M1 1l12 12M13 1L1 13"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
          <div className="galleryGrid">
            {PRESETS.map((p) => (
              <PresetCard
                key={p.id}
                preset={p}
                active={activePresetId === p.id}
                onClick={() => applyPreset(p)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* ── hidden color input ── */}
      <input
        ref={colorInputRef}
        className="hiddenInput"
        type="color"
        onChange={(e) => {
          if (!activeColorId) return
          updatePoint(activeColorId, { color: e.target.value })
        }}
        onBlur={() => setActiveColorId(null)}
      />

      {/* ── toast ── */}
      <Toast message={toast.message} visible={toast.visible} />
    </div>
  )
}
