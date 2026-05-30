import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { MeshCanvas, type MeshPoint } from './components/MeshCanvas'
import { PRESETS, type Preset, type PresetSlot } from './presets'
import { BRAND_PALETTE } from './brand'

/* ─── data model ───────────────────────────────────────────── */

type Slot = { colorIndex: number; x: number; y: number; weight: number }

const DEFAULT_SLOTS: Slot[] = [
  { colorIndex: 0, x: 0.18, y: 0.22, weight: 62 },
  { colorIndex: 1, x: 0.22, y: 0.72, weight: 55 },
  { colorIndex: 2, x: 0.80, y: 0.25, weight: 55 },
  { colorIndex: 3, x: 0.76, y: 0.76, weight: 68 },
  { colorIndex: 4, x: 0.50, y: 0.50, weight: 22 },
]

/* ─── helpers ──────────────────────────────────────────────── */

function clamp01(n: number) { return Math.min(1, Math.max(0, n)) }

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ─── randomizer: composition archetypes ───────────────────── */

type Archetype =
  | 'cornerBloom'
  | 'diagonal'
  | 'centerFocus'
  | 'edgeWash'
  | 'layered'
  | 'constellation'

type Role = 'dominant' | 'accent' | 'whisper' | 'none'

function roleToWeight(role: Role, rnd: () => number): number {
  switch (role) {
    case 'dominant': return 82 + Math.round(rnd() * 18)   // 82..100
    case 'accent'  : return 35 + Math.round(rnd() * 25)   // 35..60
    case 'whisper' : return 12 + Math.round(rnd() * 14)   // 12..26
    case 'none'    : return 0
  }
}

function pickColor(rnd: () => number): number {
  return Math.floor(rnd() * BRAND_PALETTE.length)
}

function nearby(cx: number, cy: number, jitter: number, rnd: () => number) {
  return {
    x: cx + (rnd() - 0.5) * 2 * jitter,
    y: cy + (rnd() - 0.5) * 2 * jitter,
  }
}

/** Combine an array of [role, position] pairs into 5 slots, filling the rest with 'none'. */
function buildSlots(
  entries: Array<{ role: Role; x: number; y: number }>,
  rnd: () => number,
): Slot[] {
  const padded: Slot[] = []
  for (let i = 0; i < 5; i++) {
    if (i < entries.length) {
      padded.push({
        colorIndex: pickColor(rnd),
        x: entries[i].x,
        y: entries[i].y,
        weight: roleToWeight(entries[i].role, rnd),
      })
    } else {
      padded.push({ colorIndex: pickColor(rnd), x: 0.5, y: 0.5, weight: 0 })
    }
  }
  return padded
}

function cornerBloomCombo(rnd: () => number): Slot[] {
  const corners = [
    { x: -0.05, y: -0.05 }, { x: 1.05, y: -0.05 },
    { x: -0.05, y: 1.05 }, { x: 1.05, y: 1.05 },
  ]
  const c = corners[Math.floor(rnd() * 4)]
  const opp = { x: 1 - c.x, y: 1 - c.y }
  return buildSlots([
    { role: 'dominant', ...nearby(c.x, c.y, 0.15, rnd) },
    { role: 'accent',   ...nearby(opp.x, opp.y, 0.18, rnd) },
    { role: 'accent',   ...nearby(opp.x, opp.y, 0.25, rnd) },
    { role: 'accent',   x: 0.30 + rnd() * 0.40, y: 0.30 + rnd() * 0.40 },
    { role: rnd() < 0.5 ? 'whisper' : 'none', x: 0.10 + rnd() * 0.80, y: 0.10 + rnd() * 0.80 },
  ], rnd)
}

function diagonalCombo(rnd: () => number): Slot[] {
  // pick one of two diagonals
  const flip = rnd() < 0.5
  const a = flip ? { x: -0.05, y: -0.05 } : { x: 1.05, y: -0.05 }
  const b = flip ? { x: 1.05, y: 1.05 } : { x: -0.05, y: 1.05 }
  return buildSlots([
    { role: 'dominant', ...nearby(a.x, a.y, 0.16, rnd) },
    { role: 'dominant', ...nearby(b.x, b.y, 0.16, rnd) },
    { role: 'accent',   x: 0.4 + rnd() * 0.2, y: 0.4 + rnd() * 0.2 },
    { role: 'accent',   x: 0.3 + rnd() * 0.4, y: 0.3 + rnd() * 0.4 },
    { role: rnd() < 0.6 ? 'whisper' : 'none', x: 0.2 + rnd() * 0.6, y: 0.2 + rnd() * 0.6 },
  ], rnd)
}

function centerFocusCombo(rnd: () => number): Slot[] {
  return buildSlots([
    { role: 'dominant', x: 0.45 + rnd() * 0.10, y: 0.45 + rnd() * 0.10 },
    { role: 'accent',   ...nearby(0.10 + rnd() * 0.15, rnd() < 0.5 ? -0.05 : 1.05, 0.10, rnd) },
    { role: 'accent',   ...nearby(0.75 + rnd() * 0.15, rnd() < 0.5 ? -0.05 : 1.05, 0.10, rnd) },
    { role: 'accent',   ...nearby(rnd() < 0.5 ? -0.05 : 1.05, 0.30 + rnd() * 0.40, 0.10, rnd) },
    { role: rnd() < 0.7 ? 'whisper' : 'none', x: 0.2 + rnd() * 0.6, y: 0.2 + rnd() * 0.6 },
  ], rnd)
}

function edgeWashCombo(rnd: () => number): Slot[] {
  // pick which edge gets the dominant wash
  const edge = Math.floor(rnd() * 4)  // 0=top, 1=right, 2=bottom, 3=left
  const along = rnd()  // position along that edge
  const washPos =
    edge === 0 ? { x: along, y: -0.10 } :
    edge === 1 ? { x: 1.10, y: along } :
    edge === 2 ? { x: along, y: 1.10 } :
                 { x: -0.10, y: along }
  return buildSlots([
    { role: 'dominant', ...washPos },
    { role: 'accent',   x: 0.20 + rnd() * 0.60, y: 0.20 + rnd() * 0.60 },
    { role: 'accent',   x: 0.20 + rnd() * 0.60, y: 0.20 + rnd() * 0.60 },
    { role: 'whisper',  x: 0.15 + rnd() * 0.70, y: 0.15 + rnd() * 0.70 },
    { role: rnd() < 0.4 ? 'accent' : 'none', x: 0.20 + rnd() * 0.60, y: 0.20 + rnd() * 0.60 },
  ], rnd)
}

function layeredCombo(rnd: () => number): Slot[] {
  // two horizontal or vertical bands
  const horizontal = rnd() < 0.5
  const split = 0.35 + rnd() * 0.30
  if (horizontal) {
    return buildSlots([
      { role: 'dominant', x: 0.5 + (rnd() - 0.5) * 0.4, y: split * 0.5 },
      { role: 'dominant', x: 0.5 + (rnd() - 0.5) * 0.4, y: split + (1 - split) * 0.5 },
      { role: 'accent',   x: rnd(), y: split },
      { role: 'whisper',  x: 0.1 + rnd() * 0.8, y: 0.1 + rnd() * 0.8 },
      { role: rnd() < 0.5 ? 'whisper' : 'none', x: 0.1 + rnd() * 0.8, y: 0.1 + rnd() * 0.8 },
    ], rnd)
  } else {
    return buildSlots([
      { role: 'dominant', x: split * 0.5, y: 0.5 + (rnd() - 0.5) * 0.4 },
      { role: 'dominant', x: split + (1 - split) * 0.5, y: 0.5 + (rnd() - 0.5) * 0.4 },
      { role: 'accent',   x: split, y: rnd() },
      { role: 'whisper',  x: 0.1 + rnd() * 0.8, y: 0.1 + rnd() * 0.8 },
      { role: rnd() < 0.5 ? 'whisper' : 'none', x: 0.1 + rnd() * 0.8, y: 0.1 + rnd() * 0.8 },
    ], rnd)
  }
}

function constellationCombo(rnd: () => number): Slot[] {
  // 4-5 medium points scattered widely; one slightly larger
  const anchorIdx = Math.floor(rnd() * 4)
  return buildSlots(Array.from({ length: 4 + (rnd() < 0.5 ? 1 : 0) }, (_, i) => ({
    role: (i === anchorIdx ? 'accent' : 'accent') as Role,
    x: 0.10 + rnd() * 0.80,
    y: 0.10 + rnd() * 0.80,
  })).map((e, i) => (
    i === anchorIdx ? { ...e, role: 'dominant' as Role } : e
  )), rnd)
}

function randomCombo(rnd: () => number): Slot[] {
  const archetypes: Archetype[] = [
    'cornerBloom', 'diagonal', 'centerFocus', 'edgeWash', 'layered', 'constellation',
  ]
  const arch = archetypes[Math.floor(rnd() * archetypes.length)]
  const slots =
    arch === 'cornerBloom'   ? cornerBloomCombo(rnd) :
    arch === 'diagonal'      ? diagonalCombo(rnd) :
    arch === 'centerFocus'   ? centerFocusCombo(rnd) :
    arch === 'edgeWash'      ? edgeWashCombo(rnd) :
    arch === 'layered'       ? layeredCombo(rnd) :
                               constellationCombo(rnd)
  // Keep every point on-canvas. Archetypes use slightly out-of-range
  // anchors for visual freedom; clamping here is the single point of
  // enforcement so all handles remain visible and draggable.
  return slots.map(s => ({
    ...s,
    x: Math.max(0.05, Math.min(0.95, s.x)),
    y: Math.max(0.05, Math.min(0.95, s.y)),
  }))
}

function slotsToMeshPoints(slots: Slot[]): MeshPoint[] {
  return slots.map((s, i) => ({
    id: `slot-${i}`,
    color: BRAND_PALETTE[s.colorIndex].color,
    x: s.x,
    y: s.y,
    size: Math.max(0.05, s.weight / 100),
    enabled: s.weight > 0,
  }))
}

function slotsToCss(slots: Slot[]): string {
  const layers = slots
    .map((s) => {
      if (s.weight === 0) return null
      const color = BRAND_PALETTE[s.colorIndex].color
      const x = (clamp01(s.x) * 100).toFixed(1)
      const y = (clamp01(s.y) * 100).toFixed(1)
      const r = 28 + clamp01(s.weight / 100) * 42
      return `  radial-gradient(circle at ${x}% ${y}%, ${color} 0%, rgba(255,255,255,0) ${r.toFixed(1)}%)`
    })
    .filter(Boolean)
    .join(',\n')
  return `.mesh {\n  background:\n${layers};\n}`
}

function presetThumbCss(slots: PresetSlot[]): string {
  return slots
    .map((s) => {
      if (s.weight === 0) return null
      const color = BRAND_PALETTE[s.colorIndex].color
      const x = (s.x * 100).toFixed(1)
      const y = (s.y * 100).toFixed(1)
      return `radial-gradient(circle at ${x}% ${y}%, ${color} 0%, transparent 60%)`
    })
    .filter(Boolean)
    .join(', ')
}

/* ─── color row ────────────────────────────────────────────── */

function ColorRow({
  colorIndex, weight, share, onColorChange, onWeightChange,
}: {
  colorIndex: number
  weight: number
  share: number
  onColorChange: (idx: number) => void
  onWeightChange: (w: number) => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!pickerOpen) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setPickerOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [pickerOpen])

  const color = BRAND_PALETTE[colorIndex].color
  const name  = BRAND_PALETTE[colorIndex].name

  const sliderStyle: CSSProperties = {
    ['--slider-pct' as never]: `${weight}%`,
    ['--slider-fill' as never]: color,
  }

  return (
    <div className="flex items-center gap-2">
      <div ref={wrapRef} className="relative shrink-0">
        <button
          type="button"
          onClick={() => setPickerOpen(o => !o)}
          className={[
            'w-5 h-5 rounded-md border border-border shadow-[0_1px_3px_rgba(0,0,0,0.35)]',
            'transition hover:scale-110 cursor-pointer',
            pickerOpen ? 'ring-2 ring-foreground/40 ring-offset-1 ring-offset-card' : '',
          ].join(' ')}
          style={{ background: color }}
          title={`Pick brand color (current: ${name})`}
        />
        {pickerOpen && (
          <div
            className={[
              'absolute z-50 left-0 -top-1 -translate-y-full',
              'flex gap-1.5 p-1.5 rounded-lg',
              'border border-border bg-card backdrop-blur-xl',
              'shadow-[0_8px_24px_rgba(0,0,0,0.4)]',
            ].join(' ')}
          >
            {BRAND_PALETTE.map((b, i) => (
              <button
                key={b.color}
                type="button"
                onClick={() => { onColorChange(i); setPickerOpen(false) }}
                title={b.name}
                className={[
                  'w-5 h-5 rounded-md border shadow-[0_1px_2px_rgba(0,0,0,0.3)]',
                  'transition hover:scale-110 cursor-pointer',
                  i === colorIndex
                    ? 'border-foreground/80 ring-2 ring-foreground/30'
                    : 'border-border',
                ].join(' ')}
                style={{ background: b.color }}
              />
            ))}
          </div>
        )}
      </div>
      <span className="w-10 text-[11px] text-foreground/85 shrink-0 select-none">{name}</span>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={weight}
        onChange={(e) => onWeightChange(Number(e.target.value))}
        className="brand-slider flex-1"
        style={sliderStyle}
        aria-label={`${name} weight`}
      />
      <span className="w-8 text-right text-[10.5px] text-muted-foreground tabular-nums shrink-0">
        {share}%
      </span>
    </div>
  )
}

/* ─── preset card ──────────────────────────────────────────── */

function PresetCard({
  preset, active, onClick,
}: {
  preset: Preset
  active: boolean
  onClick: () => void
}) {
  const bg = useMemo(() => presetThumbCss(preset.slots), [preset])
  return (
    <button
      onClick={onClick}
      title={preset.name}
      className={[
        'flex flex-col rounded-xl overflow-hidden text-left',
        'border bg-white/[0.04] backdrop-blur-sm',
        'transition duration-150 ease-out',
        'hover:scale-[1.03] hover:shadow-2xl',
        active
          ? 'border-foreground/70 shadow-[0_0_0_2px_rgba(255,255,255,0.25)]'
          : 'border-border hover:border-foreground/30',
      ].join(' ')}
    >
      <div className="w-full aspect-[4/3]" style={{ background: bg || '#0a0a14' }} />
      <div className="px-3 py-2.5 bg-black/45 border-t border-border flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-foreground/95">{preset.name}</span>
        <div className="flex gap-1">
          {preset.slots.map((s, i) => s.weight > 0 ? (
            <span
              key={i}
              className="w-2.5 h-2.5 rounded-full border border-white/20 shrink-0"
              style={{ background: BRAND_PALETTE[s.colorIndex].color }}
            />
          ) : null)}
        </div>
      </div>
    </button>
  )
}

/* ─── toast ────────────────────────────────────────────────── */

function Toast({ message, visible }: { message: string; visible: boolean }) {
  return (
    <div
      className={[
        'fixed bottom-7 left-1/2 -translate-x-1/2 z-[200] pointer-events-none whitespace-nowrap',
        'px-4 py-2 rounded-full bg-[oklch(0.12_0.012_280/0.9)] border border-border backdrop-blur-md',
        'text-[13px] font-medium text-foreground/95',
        'transition-all duration-200 ease-out',
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3',
      ].join(' ')}
      style={visible ? undefined : { transform: 'translate(-50%, 0.75rem)' }}
    >
      {message}
    </div>
  )
}

/* ─── icons (inline SVG) ───────────────────────────────────── */

const Icon = {
  Presets: () => (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <rect x="1" y="1" width="6" height="6" rx="1.5" fill="currentColor"/>
      <rect x="9" y="1" width="6" height="6" rx="1.5" fill="currentColor"/>
      <rect x="1" y="9" width="6" height="6" rx="1.5" fill="currentColor"/>
      <rect x="9" y="9" width="6" height="6" rx="1.5" fill="currentColor"/>
    </svg>
  ),
  Copy: () => (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <rect x="5" y="1.5" width="9" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
      <rect x="2" y="4.5" width="9" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" fill="rgba(255,255,255,0.08)"/>
    </svg>
  ),
  Export: () => (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <path d="M8 2v8M5 7.5l3 3 3-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M2 13h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  ),
  Shuffle: () => (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <path d="M2 5h8M7 3l3 2-3 2M14 11H6M9 9l3 2-3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  Play: () => (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <path d="M4 2.5v11l10-5.5L4 2.5z" fill="currentColor"/>
    </svg>
  ),
  Pause: () => (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <rect x="3.5" y="2.5" width="3" height="11" rx="0.8" fill="currentColor"/>
      <rect x="9.5" y="2.5" width="3" height="11" rx="0.8" fill="currentColor"/>
    </svg>
  ),
  Close: () => (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
      <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  ),
  Points: () => (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" fill="none"/>
      <circle cx="8" cy="8" r="2.2" fill="currentColor"/>
    </svg>
  ),
  PointsOff: () => (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" fill="none"/>
      <circle cx="8" cy="8" r="2.2" fill="currentColor"/>
      <path d="M3 13L13 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  ),
}

/* ─── drag handles ─────────────────────────────────────────── */

function DragHandles({
  slots, stageRef, onPositionChange, visible, positionsRef,
}: {
  slots: Slot[]
  stageRef: React.RefObject<HTMLDivElement | null>
  onPositionChange: (idx: number, x: number, y: number) => void
  visible: boolean
  positionsRef: React.MutableRefObject<Float32Array | null>
}) {
  const draggingRef = useRef<number | null>(null)
  const buttonRefs  = useRef<Array<HTMLButtonElement | null>>([])

  const onPointerDown = (idx: number) => (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    draggingRef.current = idx
  }

  const onPointerMove = (idx: number) => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (draggingRef.current !== idx) return
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = Math.max(0.02, Math.min(0.98, (e.clientX - rect.left) / rect.width))
    const y = Math.max(0.02, Math.min(0.98, (e.clientY - rect.top) / rect.height))
    onPositionChange(idx, x, y)
  }

  const onPointerUp = () => { draggingRef.current = null }

  // Follow the animated blob centers each frame by reading positionsRef
  // populated by MeshCanvas. Direct DOM updates — no React re-renders.
  useEffect(() => {
    if (!visible) return
    let raf = 0
    const tick = () => {
      const positions = positionsRef.current
      if (positions) {
        for (let i = 0; i < slots.length; i++) {
          const el = buttonRefs.current[i]
          if (!el) continue
          if (draggingRef.current === i) continue   // skip the one being dragged
          if (slots[i].weight <= 0) continue
          const x = positions[i * 2]
          const y = positions[i * 2 + 1]
          el.style.left = `${x * 100}%`
          el.style.top  = `${y * 100}%`
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [slots, visible, positionsRef])

  if (!visible) return null

  return (
    <div className="absolute inset-0 z-10 pointer-events-none">
      {slots.map((slot, i) => {
        if (slot.weight <= 0) return null
        const swatch = BRAND_PALETTE[slot.colorIndex]
        const color  = swatch.color
        return (
          <button
            key={`handle-${i}`}
            ref={(el) => { buttonRefs.current[i] = el }}
            type="button"
            onPointerDown={onPointerDown(i)}
            onPointerMove={onPointerMove(i)}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            aria-label={`Move ${swatch.name}`}
            title={swatch.name}
            className={[
              'absolute pointer-events-auto',
              'w-4 h-4 rounded-full border-[1.5px] border-white/95',
              'cursor-grab active:cursor-grabbing',
              'shadow-[0_0_0_2px_rgba(0,0,0,0.35),0_2px_8px_rgba(0,0,0,0.45)]',
              'transition-transform duration-150 hover:scale-125',
              'touch-none select-none',
            ].join(' ')}
            style={{
              left: `${slot.x * 100}%`,
              top: `${slot.y * 100}%`,
              transform: 'translate(-50%, -50%)',
              background: color,
            }}
          />
        )
      })}
    </div>
  )
}

/* ─── app ──────────────────────────────────────────────────── */

export default function App() {
  const [slots, setSlots] = useState<Slot[]>(DEFAULT_SLOTS)
  const [animate, setAnimate] = useState(true)
  const [showHandles, setShowHandles] = useState(true)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [activePresetId, setActivePresetId] = useState<string | null>(null)
  const [toast, setToast] = useState({ message: '', visible: false })

  const stageRef = useRef<HTMLDivElement | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Shared between MeshCanvas (writer) and DragHandles (reader) so the
  // drag-handles follow the same Lissajous drift as the rendered blobs.
  const animatedPositionsRef = useRef<Float32Array | null>(null)

  /* ── derived ── */
  const meshPoints = useMemo(() => slotsToMeshPoints(slots), [slots])
  const totalWeight = useMemo(
    () => slots.reduce((sum, s) => sum + s.weight, 0),
    [slots],
  )
  const exportCss = useMemo(() => slotsToCss(slots), [slots])

  /* ── toast ── */
  const showToast = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ message: msg, visible: true })
    toastTimer.current = setTimeout(
      () => setToast((t) => ({ ...t, visible: false })),
      2200,
    )
  }, [])

  /* ── actions ── */
  const handleRandomize = useCallback(() => {
    const rnd = mulberry32(Math.floor(Math.random() * 1e9))
    setSlots(randomCombo(rnd))
    setActivePresetId(null)
  }, [])

  const applyPreset = useCallback((preset: Preset) => {
    setSlots(preset.slots.map(s => ({
      colorIndex: s.colorIndex, x: s.x, y: s.y, weight: s.weight,
    })))
    setActivePresetId(preset.id)
    setGalleryOpen(false)
  }, [])

  const updateSlotPosition = useCallback((idx: number, x: number, y: number) => {
    setSlots(prev => prev.map((s, i) => i === idx ? { ...s, x, y } : s))
    setActivePresetId(null)
  }, [])

  const updateColorIndex = useCallback((idx: number, colorIndex: number) => {
    setSlots(prev => prev.map((s, i) => i === idx ? { ...s, colorIndex } : s))
    setActivePresetId(null)
  }, [])

  const updateWeight = useCallback((idx: number, weight: number) => {
    setSlots(prev => prev.map((s, i) => i === idx ? { ...s, weight } : s))
    setActivePresetId(null)
  }, [])

  const handleExport = useCallback(() => {
    const canvas = stageRef.current?.querySelector('canvas')
    if (!canvas) return
    try {
      const url = canvas.toDataURL('image/png')
      const a = document.createElement('a')
      a.download = 'gradient.png'
      a.href = url
      a.click()
      showToast('PNG saved')
    } catch {
      showToast('Export failed')
    }
  }, [showToast])

  const handleCopyCss = useCallback(async () => {
    await navigator.clipboard.writeText(exportCss)
    showToast('CSS copied')
  }, [exportCss, showToast])

  /* ── keyboard ── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setGalleryOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  /* ── ui ── */
  return (
    <div className="w-screen h-screen flex">
      {/* ── stage (gradient lives here) ── */}
      <div
        ref={stageRef}
        className="relative flex-1 min-w-0 overflow-hidden bg-white"
      >
        <MeshCanvas
          className="absolute inset-0 w-full h-full block"
          points={meshPoints}
          animate={animate}
          positionsRef={animatedPositionsRef}
        />
        <DragHandles
          slots={slots}
          stageRef={stageRef}
          onPositionChange={updateSlotPosition}
          visible={showHandles}
          positionsRef={animatedPositionsRef}
        />
      </div>

      {/* ── side panel (controls live here) ── */}
      <SidePanel
        slots={slots}
        totalWeight={totalWeight}
        animate={animate}
        showHandles={showHandles}
        onColorChange={updateColorIndex}
        onWeightChange={updateWeight}
        onRandomize={handleRandomize}
        onToggleAnimate={() => setAnimate(a => !a)}
        onToggleHandles={() => setShowHandles(s => !s)}
        onOpenPresets={() => setGalleryOpen(true)}
        onCopyCss={handleCopyCss}
        onExport={handleExport}
      />

      {/* ── gallery overlay ── */}
      <div
        className={[
          'fixed inset-0 z-[100] flex items-center justify-center',
          'bg-black/65 backdrop-blur-2xl transition-opacity duration-200',
          galleryOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        ].join(' ')}
        onClick={(e) => { if (e.target === e.currentTarget) setGalleryOpen(false) }}
      >
        <div
          className={[
            'w-[min(92vw,860px)] max-h-[85vh] flex flex-col gap-5',
            'transition-transform duration-200',
            galleryOpen ? 'translate-y-0' : 'translate-y-3',
          ].join(' ')}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-[18px] font-semibold text-foreground/95 tracking-tight">Presets</h2>
            <button
              onClick={() => setGalleryOpen(false)}
              className="w-8 h-8 rounded-full border border-border bg-white/10 text-foreground/75 hover:bg-white/20 hover:text-foreground transition flex items-center justify-center"
            >
              <Icon.Close />
            </button>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] auto-rows-[minmax(170px,auto)] gap-3.5 overflow-y-auto min-h-0 pb-1 scroll-thin">
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

      <Toast message={toast.message} visible={toast.visible} />
    </div>
  )
}

/* ─── shared buttons ───────────────────────────────────────── */

/* ─── side panel ───────────────────────────────────────────── */

function SidePanel({
  slots, totalWeight, animate, showHandles,
  onColorChange, onWeightChange,
  onRandomize, onToggleAnimate, onToggleHandles,
  onOpenPresets, onCopyCss, onExport,
}: {
  slots: Slot[]
  totalWeight: number
  animate: boolean
  showHandles: boolean
  onColorChange: (idx: number, ci: number) => void
  onWeightChange: (idx: number, w: number) => void
  onRandomize: () => void
  onToggleAnimate: () => void
  onToggleHandles: () => void
  onOpenPresets: () => void
  onCopyCss: () => void
  onExport: () => void
}) {
  return (
    <aside
      className={[
        'shrink-0 w-[260px] h-full',
        'flex flex-col justify-between p-3.5',
        'border-l border-border bg-card backdrop-blur-xl',
      ].join(' ')}
    >
      {/* top group — Randomize + color rows */}
      <div className="flex flex-col gap-3">
        <PanelButton onClick={onRandomize} icon={<Icon.Shuffle />} variant="primary">
          Randomize
        </PanelButton>
        <div className="flex flex-col gap-2">
          {slots.map((slot, i) => {
            const share = totalWeight > 0
              ? Math.round((slot.weight / totalWeight) * 100)
              : 0
            return (
              <ColorRow
                key={`slot-${i}`}
                colorIndex={slot.colorIndex}
                weight={slot.weight}
                share={share}
                onColorChange={(ci) => onColorChange(i, ci)}
                onWeightChange={(w) => onWeightChange(i, w)}
              />
            )
          })}
        </div>
      </div>

      {/* bottom group — icon-only actions */}
      <div className="grid grid-cols-5 gap-1.5">
        <PanelIconButton
          onClick={onToggleAnimate}
          active={animate}
          icon={animate ? <Icon.Pause /> : <Icon.Play />}
          label={animate ? 'Pause' : 'Play'}
        />
        <PanelIconButton
          onClick={onToggleHandles}
          active={showHandles}
          icon={showHandles ? <Icon.Points /> : <Icon.PointsOff />}
          label="Points"
        />
        <PanelIconButton onClick={onOpenPresets} icon={<Icon.Presets />} label="Presets" />
        <PanelIconButton onClick={onCopyCss}     icon={<Icon.Copy    />} label="Copy CSS" />
        <PanelIconButton onClick={onExport}      icon={<Icon.Export  />} label="Export" />
      </div>
    </aside>
  )
}

function PanelButton({
  children, icon, onClick, variant = 'default',
}: {
  children: React.ReactNode
  icon?: React.ReactNode
  onClick: () => void
  variant?: 'default' | 'primary'
}) {
  return (
    <button
      onClick={onClick}
      className={[
        'inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg w-full',
        'text-[12px] font-medium border transition',
        variant === 'primary'
          ? 'bg-white/15 border-white/25 text-foreground hover:bg-white/22 hover:border-white/35'
          : 'bg-white/[0.06] border-white/10 text-foreground/85 hover:bg-white/15 hover:text-foreground',
      ].join(' ')}
    >
      {icon}
      {children}
    </button>
  )
}

function PanelIconButton({
  onClick, icon, label, active = false,
}: {
  onClick: () => void
  icon: React.ReactNode
  label: string
  active?: boolean
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={[
        'inline-flex items-center justify-center aspect-square rounded-lg',
        'border transition',
        active
          ? 'bg-white/15 border-white/25 text-foreground'
          : 'bg-white/[0.04] border-white/10 text-foreground/70 hover:bg-white/12 hover:text-foreground',
      ].join(' ')}
    >
      {icon}
    </button>
  )
}
