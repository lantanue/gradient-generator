import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { WaveCanvas, type MeshPoint } from './components/WaveCanvas'
import { PRESETS, type Preset } from './presets'

/* ─── default palette ──────────────────────────────────────── */

const DEFAULT_POINTS: MeshPoint[] = [
  { id: 'a', color: '#FFBC25', x: 0.22, y: 0.24, size: 0.60, enabled: true },
  { id: 'b', color: '#FF773D', x: 0.74, y: 0.70, size: 0.55, enabled: true },
  { id: 'c', color: '#3CBBCE', x: 0.76, y: 0.22, size: 0.52, enabled: true },
  { id: 'd', color: '#405FF5', x: 0.24, y: 0.76, size: 0.65, enabled: true },
]

/* ─── color hex input ──────────────────────────────────────── */

function ColorHexInput({
  color,
  disabled,
  onChange,
}: {
  color: string
  disabled?: boolean
  onChange: (c: string) => void
}) {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current) {
      ref.current.value = color.toUpperCase()
    }
  }, [color])

  return (
    <input
      ref={ref}
      className="colorHexInput"
      defaultValue={color.toUpperCase()}
      maxLength={7}
      spellCheck={false}
      tabIndex={disabled ? -1 : 0}
      onChange={(e) => {
        if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) onChange(e.target.value)
      }}
      onBlur={(e) => {
        if (!/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) e.target.value = color.toUpperCase()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}

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
  s /= 100; l /= 100
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0')
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`
}

function randomPastelPalette(rnd: () => number, count: number) {
  const base = rnd() * 360
  const step = 360 / Math.max(3, count)
  return Array.from({ length: count }, (_, i) => {
    const hue = (base + i * step + (rnd() - 0.5) * 28) % 360
    const sat = 62 + rnd() * 18
    const lit = 68 + (rnd() - 0.5) * 12
    return hslToHex(hue, sat, lit)
  })
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
            <span key={i} className="presetDot" style={{ background: p.color }} title={p.color} />
          ))}
        </div>
      </div>
    </button>
  )
}

/* ─── toast ────────────────────────────────────────────────── */

function Toast({ message, visible }: { message: string; visible: boolean }) {
  return <div className={`toast${visible ? ' toast--visible' : ''}`}>{message}</div>
}

/* ─── app ──────────────────────────────────────────────────── */

export default function App() {
  const [points, setPoints] = useState<MeshPoint[]>(DEFAULT_POINTS)
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9))
  const stageRef = useRef<HTMLDivElement | null>(null)
  const colorInputRef = useRef<HTMLInputElement | null>(null)
  const [activeColorId, setActiveColorId] = useState<string | null>(null)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [activePresetId, setActivePresetId] = useState<string | null>(null)
  const [toast, setToast] = useState({ message: '', visible: false })
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /* ─── css export ─── */
  const exportCss = useMemo(() => {
    const layers = points
      .filter(p => p.enabled !== false)
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
    const canvas = stageRef.current?.querySelector('canvas')
    if (!canvas) return
    try {
      const url = canvas.toDataURL('image/png')
      const a = document.createElement('a')
      a.download = 'gradient.png'
      a.href = url
      a.click()
      showToast('PNG saved!')
    } catch {
      showToast('Export failed')
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
      enabled: true,
    }))
    setPoints(newPts)
    setActivePresetId(preset.id)
    setGalleryOpen(false)
  }

  /* ─── point actions ─── */
  function updatePoint(id: string, patch: Partial<MeshPoint>) {
    setPoints((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)))
    setActivePresetId(null)
  }

  function toggleEnabled(id: string) {
    setPoints((prev) =>
      prev.map((p) => p.id === id ? { ...p, enabled: p.enabled === false ? true : false } : p)
    )
    setActivePresetId(null)
  }

  function addPoint() {
    const nextSeed = (seed + 1) | 0
    const rnd = mulberry32(nextSeed)
    setSeed(nextSeed)
    setPoints((prev) => [
      ...prev,
      {
        id: `p_${nextSeed}_${prev.length}`,
        color: hslToHex(rnd() * 360, 64 + rnd() * 16, 68 + (rnd() - 0.5) * 12),
        x: 0.15 + rnd() * 0.7,
        y: 0.15 + rnd() * 0.7,
        size: 0.45,
        enabled: true,
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
    const rnd = mulberry32(nextSeed)
    const colors = randomPastelPalette(rnd, points.length)
    setPoints((prev) =>
      prev.map((p, i) => ({
        ...p,
        color: colors[i],
        x: 0.12 + rnd() * 0.76,
        y: 0.12 + rnd() * 0.76,
      }))
    )
    setActivePresetId(null)
  }

  async function copyCss() {
    await navigator.clipboard.writeText(exportCss)
    showToast('CSS copied!')
  }

  function openColorPicker(id: string) {
    const p = points.find((x) => x.id === id)
    if (!p || p.enabled === false) return
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
      <div className="stage" ref={stageRef}>
        <WaveCanvas className="stageCanvas" points={points} />

        {/* ── top bar ── */}
        <header className="topBar">
          <span className="topBarTitle">Gradient</span>
          <nav className="topBarActions">
            <button className="topBtn" onClick={() => setGalleryOpen(true)}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                <rect x="1" y="1" width="6" height="6" rx="1.5" fill="currentColor"/>
                <rect x="9" y="1" width="6" height="6" rx="1.5" fill="currentColor"/>
                <rect x="1" y="9" width="6" height="6" rx="1.5" fill="currentColor"/>
                <rect x="9" y="9" width="6" height="6" rx="1.5" fill="currentColor"/>
              </svg>
              Presets
            </button>
            <button className="topBtn" onClick={copyCss}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                <rect x="5" y="1.5" width="9" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
                <rect x="2" y="4.5" width="9" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" fill="rgba(255,255,255,0.08)"/>
              </svg>
              Copy CSS
            </button>
            <button className="topBtn topBtn--accent" onClick={handleExport}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                <path d="M8 2v8M5 7.5l3 3 3-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 13h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
              </svg>
              Export
            </button>
          </nav>
        </header>

        {/* ── color palette panel ── */}
        <div className="colorPanel">
          {points.map((p) => {
            const off = p.enabled === false
            return (
              <div key={p.id} className={`colorItem${off ? ' colorItem--off' : ''}`}>
                <button
                  className="colorSwatch"
                  style={{ background: p.color }}
                  onClick={() => openColorPicker(p.id)}
                  title={off ? 'Disabled' : p.color}
                />
                <ColorHexInput
                  color={p.color}
                  disabled={off}
                  onChange={(c) => updatePoint(p.id, { color: c })}
                />
                {/* on/off toggle dot */}
                <button
                  className={`colorDot${off ? '' : ' colorDot--on'}`}
                  onClick={() => toggleEnabled(p.id)}
                  title={off ? 'Enable' : 'Disable'}
                />
              </div>
            )
          })}
        </div>

        {/* ── bottom toolbar ── */}
        <footer className="toolbar">
          <button className="toolBtn" onClick={randomize}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path d="M2 5h8M7 3l3 2-3 2M14 11H6M9 9l3 2-3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Randomize
          </button>
          <span className="toolSep" />
          <button className="toolBtn" onClick={addPoint} disabled={points.length >= 8}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M8 5v6M5 8h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            Add
          </button>
          <button className="toolBtn toolBtn--ghost" onClick={removeLastPoint} disabled={points.length <= 2}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M5 8h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
          <span className="toolSep" />
          <span className="toolCount">{points.filter(p => p.enabled !== false).length} / {points.length}</span>
        </footer>
      </div>

      {/* ── gallery overlay ── */}
      <div
        className={`galleryOverlay${galleryOpen ? ' galleryOverlay--open' : ''}`}
        onClick={(e) => { if (e.target === e.currentTarget) setGalleryOpen(false) }}
      >
        <div className="galleryPanel">
          <div className="galleryHeader">
            <h2 className="galleryTitle">Presets</h2>
            <button className="galleryClose" onClick={() => setGalleryOpen(false)}>
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
          <div className="galleryGrid">
            {PRESETS.map((p) => (
              <PresetCard key={p.id} preset={p} active={activePresetId === p.id} onClick={() => applyPreset(p)} />
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

      <Toast message={toast.message} visible={toast.visible} />
    </div>
  )
}
