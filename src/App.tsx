import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { MeshCanvas, type MeshPoint } from './components/MeshCanvas'
import { PRESETS, type Preset, type PresetSlot } from './presets'
import { BRAND_PALETTE } from './brand'

/* ─── data model ───────────────────────────────────────────── */

type Slot = { colorIndex: number; x: number; y: number; weight: number }

/** Total color slots. Mirrors MAX_POINTS in the WebGL shader. */
const MAX_SLOTS = 6

/* ─── gradient field sizing ─────────────────────────────────── */

type AspectKey = 'free' | '16:9' | '9:16' | '1:1' | '3:4' | '4:3'

// CSS aspect-ratio per preset (null = free, fills the inset stage).
const ASPECT_RATIO: Record<AspectKey, string | null> = {
  free: null, '16:9': '16 / 9', '9:16': '9 / 16',
  '1:1': '1 / 1', '3:4': '3 / 4', '4:3': '4 / 3',
}

const ASPECT_KEYS: AspectKey[] = ['free', '16:9', '9:16', '1:1', '3:4', '4:3']

// Hi-res export dimensions per preset (free uses the live frame size × 2).
const EXPORT_SIZE: Record<Exclude<AspectKey, 'free'>, [number, number]> = {
  '16:9': [2560, 1440], '9:16': [1440, 2560], '1:1': [2048, 2048],
  '3:4': [1536, 2048], '4:3': [2048, 1536],
}

// Startup composition — pastel mix: 4 main colours present at gentle
// weights (Y/O/C balanced, Blue as a tiny accent) over a double white wash.
const DEFAULT_SLOTS: Slot[] = [
  { colorIndex: 0, x: 0.42, y: 0.42, weight: 21 },  // Yellow
  { colorIndex: 1, x: 0.60, y: 0.55, weight: 18 },  // Orange
  { colorIndex: 2, x: 0.50, y: 0.85, weight: 18 },  // Cyan
  { colorIndex: 3, x: 0.92, y: 0.10, weight:  3 },  // Blue — tiny accent
  { colorIndex: 4, x: 0.20, y: 0.32, weight: 21 },  // White — upper-left wash
  { colorIndex: 4, x: 0.80, y: 0.68, weight: 21 },  // White — lower-right wash
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

/* ─── randomizer: composition schemes × spatial layouts ────── */
// Two-stage random composition:
// 1) pickScheme()  — colour identity (mono / sunrise / ocean / ...)
//    builds 2-5 colour entries with explicit role
// 2) pickArchetype() — where to place those N entries on canvas
// Result is padded to MAX_SLOTS with inactive slots.

type Role = 'dominant' | 'accent' | 'whisper' | 'none'

type Scheme =
  | 'warmTrio' | 'coolTrio' | 'warmCool' | 'quadFlat' | 'quadPlusWhite'
  | 'warmDominant' | 'coolDominant' | 'pentet' | 'pairedAccent'

type Archetype =
  | 'cornerBloom' | 'diagonal' | 'centerFocus' | 'edgeWash' | 'layered' | 'constellation'

interface SchemeEntry { colorIndex: number; role: Role }

type Pos = { x: number; y: number }

// Brand color indices — match src/brand.ts BRAND_PALETTE order
const Y = 0, O = 1, C = 2, B = 3, W = 4

function roleToWeight(role: Role, rnd: () => number): number {
  switch (role) {
    case 'dominant': return 82 + Math.round(rnd() * 18)   // 82..100
    case 'accent'  : return 35 + Math.round(rnd() * 25)   // 35..60
    case 'whisper' : return 12 + Math.round(rnd() * 14)   // 12..26
    case 'none'    : return 0
  }
}

function nearby(cx: number, cy: number, jitter: number, rnd: () => number): Pos {
  return {
    x: cx + (rnd() - 0.5) * 2 * jitter,
    y: cy + (rnd() - 0.5) * 2 * jitter,
  }
}

/* ─── colour schemes ─────────────────────────────────────────
   Each scheme returns a colour budget — a list of (colorIndex, count)
   pairs — converted to SchemeEntry[] with roles. Strict rules:
   - Total active slots: 4..8
   - No single colorIndex repeated more than 3 times
   First entry of first colour: dominant. First entry of subsequent
   colours: accent. Repeated entries of any colour: whisper. */

type ColorBudget = Array<{ colorIndex: number; count: number }>

function safeBudget(budget: ColorBudget): ColorBudget {
  // Cap each color count at 3, drop zeros
  const capped = budget.map(b => ({
    colorIndex: b.colorIndex,
    count: Math.max(0, Math.min(3, Math.round(b.count))),
  })).filter(b => b.count > 0)
  // Trim total to <= MAX_SLOTS
  let total = capped.reduce((s, b) => s + b.count, 0)
  while (total > MAX_SLOTS) {
    let maxIdx = 0
    for (let i = 1; i < capped.length; i++) {
      if (capped[i].count > capped[maxIdx].count) maxIdx = i
    }
    capped[maxIdx].count -= 1
    total -= 1
  }
  return capped.filter(b => b.count > 0)
}

function budgetToEntries(budget: ColorBudget): SchemeEntry[] {
  const safe = safeBudget(budget)
  const out: SchemeEntry[] = []
  safe.forEach((b, colorIdx) => {
    for (let j = 0; j < b.count; j++) {
      const role: Role =
        colorIdx === 0 && j === 0 ? 'dominant' :
        j === 0                   ? 'accent'   :
                                    'whisper'
      out.push({ colorIndex: b.colorIndex, role })
    }
  })
  return out
}

function buildScheme(scheme: Scheme, rnd: () => number): SchemeEntry[] {
  switch (scheme) {
    case 'warmTrio':       return budgetToEntries(warmTrioBudget(rnd))
    case 'coolTrio':       return budgetToEntries(coolTrioBudget(rnd))
    case 'warmCool':       return budgetToEntries(warmCoolBudget(rnd))
    case 'quadFlat':       return budgetToEntries(quadFlatBudget(rnd))
    case 'quadPlusWhite':  return budgetToEntries(quadPlusWhiteBudget(rnd))
    case 'warmDominant':   return budgetToEntries(warmDominantBudget(rnd))
    case 'coolDominant':   return budgetToEntries(coolDominantBudget(rnd))
    case 'pentet':         return budgetToEntries(pentetBudget(rnd))
    case 'pairedAccent':   return budgetToEntries(pairedAccentBudget(rnd))
  }
}

function warmTrioBudget(rnd: () => number): ColorBudget {
  return [
    { colorIndex: Y, count: 2 + Math.floor(rnd() * 2) },  // 2..3
    { colorIndex: O, count: 2 },
    { colorIndex: W, count: 1 + Math.floor(rnd() * 2) },  // 1..2
  ]
}

function coolTrioBudget(rnd: () => number): ColorBudget {
  return [
    { colorIndex: C, count: 2 + Math.floor(rnd() * 2) },
    { colorIndex: B, count: 2 },
    { colorIndex: W, count: 1 + Math.floor(rnd() * 2) },
  ]
}

function warmCoolBudget(_rnd: () => number): ColorBudget {
  // Balanced cross-temperature quartet — total 6
  return [
    { colorIndex: Y, count: 2 },
    { colorIndex: O, count: 1 },
    { colorIndex: C, count: 2 },
    { colorIndex: B, count: 1 },
  ]
}

function quadFlatBudget(_rnd: () => number): ColorBudget {
  return [
    { colorIndex: Y, count: 1 },
    { colorIndex: O, count: 1 },
    { colorIndex: C, count: 1 },
    { colorIndex: B, count: 1 },
  ]
}

function quadPlusWhiteBudget(rnd: () => number): ColorBudget {
  return [
    { colorIndex: Y, count: 1 + Math.floor(rnd() * 2) },  // 1..2
    { colorIndex: O, count: 1 },
    { colorIndex: C, count: 1 + Math.floor(rnd() * 2) },  // 1..2
    { colorIndex: B, count: 1 },
    { colorIndex: W, count: 1 },
  ]
}

function warmDominantBudget(rnd: () => number): ColorBudget {
  const out: ColorBudget = [
    { colorIndex: Y, count: 2 + Math.floor(rnd() * 2) },  // 2..3
    { colorIndex: O, count: 1 + Math.floor(rnd() * 2) },  // 1..2
    { colorIndex: rnd() < 0.5 ? C : B, count: 1 },
  ]
  if (rnd() < 0.5) out.push({ colorIndex: W, count: 1 })
  return out
}

function coolDominantBudget(rnd: () => number): ColorBudget {
  const out: ColorBudget = [
    { colorIndex: C, count: 2 + Math.floor(rnd() * 2) },
    { colorIndex: B, count: 1 + Math.floor(rnd() * 2) },
    { colorIndex: rnd() < 0.5 ? Y : O, count: 1 },
  ]
  if (rnd() < 0.5) out.push({ colorIndex: W, count: 1 })
  return out
}

function pentetBudget(rnd: () => number): ColorBudget {
  // All 5 brand colours present; safeBudget will trim to <=8 total.
  return [
    { colorIndex: Y, count: 1 + Math.floor(rnd() * 2) },
    { colorIndex: O, count: 1 + Math.floor(rnd() * 2) },
    { colorIndex: C, count: 1 + Math.floor(rnd() * 2) },
    { colorIndex: B, count: 1 + Math.floor(rnd() * 2) },
    { colorIndex: W, count: 1 },
  ]
}

function pairedAccentBudget(rnd: () => number): ColorBudget {
  const warm = rnd() < 0.5 ? Y : O
  const cool = rnd() < 0.5 ? C : B
  const out: ColorBudget = [
    { colorIndex: warm, count: 2 },
    { colorIndex: cool, count: 2 },
  ]
  if (rnd() < 0.55) out.push({ colorIndex: W, count: 1 })
  return out
}

function pickScheme(rnd: () => number): Scheme {
  const weights: Array<[Scheme, number]> = [
    ['warmTrio',      14],
    ['coolTrio',      14],
    ['warmCool',      12],
    ['quadFlat',       8],
    ['quadPlusWhite', 11],
    ['warmDominant',  11],
    ['coolDominant',  11],
    ['pentet',         9],
    ['pairedAccent',  10],
  ]
  const total = weights.reduce((s, [, w]) => s + w, 0)
  let r = rnd() * total
  for (const [s, w] of weights) {
    if (r < w) return s
    r -= w
  }
  return 'warmTrio'
}

/* ─── spatial layouts (variable count) ──────────────────────── */

function pickArchetype(rnd: () => number): Archetype {
  const archs: Archetype[] = [
    'cornerBloom', 'diagonal', 'centerFocus', 'edgeWash', 'layered', 'constellation',
  ]
  return archs[Math.floor(rnd() * archs.length)]
}

function layoutPositions(arch: Archetype, count: number, rnd: () => number): Pos[] {
  switch (arch) {
    case 'cornerBloom':   return layoutCornerBloom(count, rnd)
    case 'diagonal':      return layoutDiagonal(count, rnd)
    case 'centerFocus':   return layoutCenterFocus(count, rnd)
    case 'edgeWash':      return layoutEdgeWash(count, rnd)
    case 'layered':       return layoutLayered(count, rnd)
    case 'constellation': return layoutConstellation(count, rnd)
  }
}

function layoutCornerBloom(count: number, rnd: () => number): Pos[] {
  const corners: Array<[number, number]> = [
    [-0.05, -0.05], [1.05, -0.05], [-0.05, 1.05], [1.05, 1.05],
  ]
  const c = corners[Math.floor(rnd() * 4)]
  const opp: [number, number] = [1 - c[0], 1 - c[1]]
  const out: Pos[] = [nearby(c[0], c[1], 0.15, rnd)]
  for (let i = 1; i < count; i++) {
    const j = 0.18 + (i - 1) * 0.05
    out.push(nearby(opp[0], opp[1], j, rnd))
  }
  return out
}

function layoutDiagonal(count: number, rnd: () => number): Pos[] {
  const flip = rnd() < 0.5
  const a: [number, number] = flip ? [-0.05, -0.05] : [1.05, -0.05]
  const b: [number, number] = flip ? [1.05, 1.05]   : [-0.05, 1.05]
  const out: Pos[] = [nearby(a[0], a[1], 0.15, rnd)]
  if (count >= 2) out.push(nearby(b[0], b[1], 0.15, rnd))
  for (let i = 2; i < count; i++) {
    const t = i / (count + 1)
    out.push(nearby(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 0.16, rnd))
  }
  return out
}

function layoutCenterFocus(count: number, rnd: () => number): Pos[] {
  const out: Pos[] = [{ x: 0.45 + rnd() * 0.10, y: 0.45 + rnd() * 0.10 }]
  const startAngle = rnd() * Math.PI * 2
  const ring = Math.max(count - 1, 1)
  for (let i = 1; i < count; i++) {
    const a = startAngle + ((i - 1) / ring) * Math.PI * 2
    const r = 0.38 + rnd() * 0.12
    out.push({ x: 0.5 + Math.cos(a) * r, y: 0.5 + Math.sin(a) * r })
  }
  return out
}

function layoutEdgeWash(count: number, rnd: () => number): Pos[] {
  const edge = Math.floor(rnd() * 4)
  const along = rnd()
  const wash =
    edge === 0 ? { x: along, y: -0.10 } :
    edge === 1 ? { x: 1.10, y: along } :
    edge === 2 ? { x: along, y: 1.10 } :
                 { x: -0.10, y: along }
  const out: Pos[] = [wash]
  for (let i = 1; i < count; i++) {
    out.push({ x: 0.20 + rnd() * 0.60, y: 0.20 + rnd() * 0.60 })
  }
  return out
}

function layoutLayered(count: number, rnd: () => number): Pos[] {
  const horizontal = rnd() < 0.5
  const split = 0.35 + rnd() * 0.30
  const out: Pos[] = []
  for (let i = 0; i < count; i++) {
    const inFirst = i % 2 === 0
    const layer = inFirst ? split * 0.5 : split + (1 - split) * 0.5
    if (horizontal) {
      out.push({ x: 0.15 + rnd() * 0.70, y: layer + (rnd() - 0.5) * 0.18 })
    } else {
      out.push({ x: layer + (rnd() - 0.5) * 0.18, y: 0.15 + rnd() * 0.70 })
    }
  }
  return out
}

function layoutConstellation(count: number, rnd: () => number): Pos[] {
  return Array.from({ length: count }, () => ({
    x: 0.10 + rnd() * 0.80,
    y: 0.10 + rnd() * 0.80,
  }))
}

/* ─── combined randomiser ───────────────────────────────────── */

function randomCombo(rnd: () => number): Slot[] {
  const scheme    = pickScheme(rnd)
  const entries   = buildScheme(scheme, rnd)
  const arch      = pickArchetype(rnd)
  const positions = layoutPositions(arch, entries.length, rnd)

  // Expand the composition outward from the centre so points use more room and
  // spill past the working field for richer edge bleeds (matches the
  // unrestricted manual drag).
  const SPREAD = 1.5
  const slots: Slot[] = entries.map((e, i) => {
    const x = 0.5 + (positions[i].x - 0.5) * SPREAD
    const y = 0.5 + (positions[i].y - 0.5) * SPREAD
    return {
      colorIndex: e.colorIndex,
      x: Math.max(-0.35, Math.min(1.35, x)),
      y: Math.max(-0.35, Math.min(1.35, y)),
      weight: roleToWeight(e.role, rnd),
    }
  })
  while (slots.length < MAX_SLOTS) {
    slots.push({ colorIndex: 0, x: 0.5, y: 0.5, weight: 0 })
  }
  return slots
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
      <span className="w-7 text-right text-muted-foreground tabular-nums shrink-0">
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
        'px-4 py-2 rounded-full bg-card border border-border backdrop-blur-md',
        'text-[12px] font-medium text-foreground',
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
  Sun: () => (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="3.1" fill="currentColor"/>
      <path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3 3l1.1 1.1M11.9 11.9 13 13M13 3l-1.1 1.1M4.1 11.9 3 13"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  ),
  Moon: () => (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M13.2 9.6A5.6 5.6 0 1 1 6.4 2.8a4.4 4.4 0 0 0 6.8 6.8z"
        fill="currentColor"/>
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
  positionsRef: React.RefObject<Float32Array | null>
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
    // No clamp — points may be dragged anywhere, including outside the frame.
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
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

/* ─── lava centre handle ───────────────────────────────────────
   A draggable crosshair on the stage that controls the lava distortion
   centre. Frame-normalised 0.5,0.5 = centred (slider 50); it can be dragged
   into the margin (off-frame) where the swirl cluster is pulled off-canvas. */
function LavaCenterHandle({
  frameRef, x, y, visible, orbit, centerRef, onChange,
}: {
  frameRef: React.RefObject<HTMLDivElement | null>
  x: number   // lavaX 0..100
  y: number   // lavaY 0..100
  visible: boolean
  orbit: boolean
  centerRef: React.RefObject<Float32Array | null>
  onChange: (x: number, y: number) => void
}) {
  const dragging = useRef(false)
  const btnRef = useRef<HTMLButtonElement | null>(null)

  // While orbiting, the centre is animation-driven: follow centerRef each frame
  // (direct DOM updates, no React re-render) and disable dragging.
  useEffect(() => {
    if (!visible || !orbit) return
    let raf = 0
    const tick = () => {
      const c = centerRef.current
      const el = btnRef.current
      if (c && el) {
        el.style.left = `${c[0] * 100}%`
        el.style.top  = `${c[1] * 100}%`
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [visible, orbit, centerRef])

  if (!visible) return null

  // slider (0..100) → frame-normalised position: 50 → 0.5 (centre)
  const px = x / 50 - 0.5
  const py = y / 50 - 0.5

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (orbit) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragging.current = true
  }
  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragging.current) return
    const rect = frameRef.current?.getBoundingClientRect()
    if (!rect) return
    const nx = (e.clientX - rect.left) / rect.width
    const ny = (e.clientY - rect.top) / rect.height
    onChange(
      Math.max(0, Math.min(100, (nx + 0.5) * 50)),
      Math.max(0, Math.min(100, (ny + 0.5) * 50)),
    )
  }
  const onPointerUp = () => { dragging.current = false }

  return (
    <div className="absolute inset-0 z-20 pointer-events-none">
      <button
        ref={btnRef}
        type="button"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        aria-label="Move lava center"
        title={orbit ? 'Lava center (orbiting)' : 'Lava center'}
        className={[
          'absolute touch-none select-none transition-transform duration-150',
          orbit ? 'pointer-events-none' : 'pointer-events-auto cursor-grab active:cursor-grabbing hover:scale-110',
        ].join(' ')}
        style={{ left: `${px * 100}%`, top: `${py * 100}%`, transform: 'translate(-50%, -50%)' }}
      >
        <svg width="30" height="30" viewBox="0 0 30 30" fill="none"
          className="drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]">
          <circle cx="15" cy="15" r="9.5" fill="rgba(0,0,0,0.32)" stroke="#fff" strokeWidth="1.5" />
          <path d="M15 2v8 M15 20v8 M2 15h8 M20 15h8" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="15" cy="15" r="1.6" fill="#fff" />
        </svg>
      </button>
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

  // effect controls + field sizing + ui theme
  const [speed, setSpeed] = useState(50)
  const [lava, setLava] = useState(40)
  const [lavaX, setLavaX] = useState(50)
  const [lavaY, setLavaY] = useState(50)
  const [lavaRot, setLavaRot] = useState(0)
  const [lavaOrbit, setLavaOrbit] = useState(false)
  const [aspect, setAspect] = useState<AspectKey>('16:9')
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  // bumped on randomize/preset to trigger the glide + colour-crossfade transition
  const [transitionKey, setTransitionKey] = useState(0)

  // frameRef points at the aspect-sized working frame (canvas's parent), so
  // drag-handle coordinate math maps to the frame, not the whole stage.
  const frameRef = useRef<HTMLDivElement | null>(null)
  const exportRef = useRef<((w: number, h: number) => string | null) | null>(null)
  // current lava-centre position (frame-normalised), written by MeshCanvas so
  // the crosshair can follow the orbit.
  const lavaCenterRef = useRef<Float32Array | null>(null)
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

  // free → fill the inset stage; fixed → largest centered box of the target
  // ratio that fits the stage's content area (cqw/cqh = the padded stage,
  // since the stage is a size container). min() picks the limiting dimension.
  const frameStyle: CSSProperties = useMemo(() => {
    const ratio = ASPECT_RATIO[aspect]
    if (ratio === null) return { width: '100%', height: '100%' }
    const [w, h] = ratio.split(' / ').map(Number)
    return {
      aspectRatio: ratio,
      width: `min(100cqw, calc(${w / h} * 100cqh))`,
    }
  }, [aspect])

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
    setTransitionKey(k => k + 1)
  }, [])

  const applyPreset = useCallback((preset: Preset) => {
    // Presets historically carry 5 slots; pad with inactive entries
    // so the state always has MAX_SLOTS entries.
    const base: Slot[] = preset.slots.map(s => ({
      colorIndex: s.colorIndex, x: s.x, y: s.y, weight: s.weight,
    }))
    while (base.length < MAX_SLOTS) {
      base.push({ colorIndex: 0, x: 0.5, y: 0.5, weight: 0 })
    }
    setSlots(base.slice(0, MAX_SLOTS))
    setActivePresetId(preset.id)
    setGalleryOpen(false)
    setTransitionKey(k => k + 1)
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
    const fn = exportRef.current
    if (!fn) return
    let tw: number, th: number
    if (aspect === 'free') {
      // base on the live frame size × 2 for retina crispness
      const r = frameRef.current?.getBoundingClientRect()
      tw = Math.round((r?.width ?? 1280) * 2)
      th = Math.round((r?.height ?? 720) * 2)
    } else {
      [tw, th] = EXPORT_SIZE[aspect]
    }
    try {
      const url = fn(tw, th)
      if (!url) { showToast('Export failed'); return }
      const a = document.createElement('a')
      a.download = 'gradient.png'
      a.href = url
      a.click()
      showToast('PNG saved')
    } catch {
      showToast('Export failed')
    }
  }, [aspect, showToast])

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
    <div
      data-theme={theme}
      className="w-screen h-screen flex bg-[var(--color-stage)]"
    >
      {/* ── stage: centers an inset working frame; the margin around it
             gives room to drag points outside the working area. Overflow is
             visible so off-frame handles stay reachable. ── */}
      <div
        className="relative flex-1 min-w-0 flex items-center justify-center p-[6%] bg-[var(--color-stage)]"
        style={{ containerType: 'size' }}
      >
        <div ref={frameRef} className="relative" style={frameStyle}>
          {/* canvas CLIP — gradient is cropped to the working frame */}
          <div className="absolute inset-0 overflow-hidden">
            <MeshCanvas
              className="absolute inset-0 w-full h-full block"
              points={meshPoints}
              animate={animate}
              speed={speed}
              lava={lava}
              lavaX={lavaX}
              lavaY={lavaY}
              lavaRot={lavaRot}
              lavaOrbit={lavaOrbit}
              transitionKey={transitionKey}
              positionsRef={animatedPositionsRef}
              lavaCenterRef={lavaCenterRef}
              exportRef={exportRef}
            />
          </div>
          {/* handle overlay — overflow visible so handles can sit in the margin */}
          <DragHandles
            slots={slots}
            stageRef={frameRef}
            onPositionChange={updateSlotPosition}
            visible={showHandles}
            positionsRef={animatedPositionsRef}
          />
          {/* lava distortion-centre crosshair */}
          <LavaCenterHandle
            frameRef={frameRef}
            x={lavaX}
            y={lavaY}
            visible={showHandles}
            orbit={lavaOrbit}
            centerRef={lavaCenterRef}
            onChange={(lx, ly) => { setLavaX(lx); setLavaY(ly) }}
          />
        </div>
      </div>

      {/* ── side panel (controls live here) ── */}
      <SidePanel
        slots={slots}
        totalWeight={totalWeight}
        animate={animate}
        showHandles={showHandles}
        speed={speed}
        lava={lava}
        lavaRot={lavaRot}
        lavaOrbit={lavaOrbit}
        aspect={aspect}
        theme={theme}
        onColorChange={updateColorIndex}
        onWeightChange={updateWeight}
        onSpeedChange={setSpeed}
        onLavaChange={setLava}
        onLavaRotChange={setLavaRot}
        onToggleOrbit={() => setLavaOrbit(o => !o)}
        onAspectChange={setAspect}
        onRandomize={handleRandomize}
        onToggleAnimate={() => setAnimate(a => !a)}
        onToggleHandles={() => setShowHandles(s => !s)}
        onToggleTheme={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}
        onOpenPresets={() => setGalleryOpen(true)}
        onCopyCss={handleCopyCss}
        onExport={handleExport}
      />

      {/* ── gallery overlay (always dark — a self-contained lightbox) ── */}
      <div
        data-theme="dark"
        className={[
          'fixed inset-0 z-[100] flex items-center justify-center',
          'bg-black/65 backdrop-blur-2xl transition-opacity duration-200 text-foreground',
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

// shared section heading — uniform across the panel
const SECTION_LABEL =
  'font-medium uppercase tracking-[0.12em] text-muted-foreground select-none'

function SidePanel({
  slots, totalWeight, animate, showHandles,
  speed, lava, lavaRot, lavaOrbit, aspect, theme,
  onColorChange, onWeightChange,
  onSpeedChange, onLavaChange, onLavaRotChange, onToggleOrbit,
  onAspectChange,
  onRandomize, onToggleAnimate, onToggleHandles, onToggleTheme,
  onOpenPresets, onCopyCss, onExport,
}: {
  slots: Slot[]
  totalWeight: number
  animate: boolean
  showHandles: boolean
  speed: number
  lava: number
  lavaRot: number
  lavaOrbit: boolean
  aspect: AspectKey
  theme: 'dark' | 'light'
  onColorChange: (idx: number, ci: number) => void
  onWeightChange: (idx: number, w: number) => void
  onSpeedChange: (v: number) => void
  onLavaChange: (v: number) => void
  onLavaRotChange: (v: number) => void
  onToggleOrbit: () => void
  onAspectChange: (a: AspectKey) => void
  onRandomize: () => void
  onToggleAnimate: () => void
  onToggleHandles: () => void
  onToggleTheme: () => void
  onOpenPresets: () => void
  onCopyCss: () => void
  onExport: () => void
}) {
  return (
    <aside
      className={[
        'ui-text shrink-0 w-[236px] h-full',
        'flex flex-col gap-2.5 p-3',
        'border-l border-border bg-card backdrop-blur-xl text-foreground',
      ].join(' ')}
    >
      {/* top — Randomize + Presets side by side */}
      <div className="grid grid-cols-2 gap-1.5 shrink-0">
        <PanelButton onClick={onRandomize} icon={<Icon.Shuffle />}>Randomize</PanelButton>
        <PanelButton onClick={onOpenPresets}>Presets</PanelButton>
      </div>

      {/* color rows — the only scrolling region */}
      <div className="flex flex-col gap-1.5 min-h-0 flex-1 overflow-y-auto scroll-thin">
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

      {/* effects */}
      <div className="flex flex-col gap-1.5 shrink-0 pt-2.5 border-t border-border">
        <span className={SECTION_LABEL}>Effects</span>
        <EffectSlider label="Speed"  value={speed}   onChange={onSpeedChange} />
        <EffectSlider label="Lava"   value={lava}    onChange={onLavaChange} />
        <EffectSlider label="Rotate" value={lavaRot} max={360} suffix="°" onChange={onLavaRotChange} />
        <div className="flex items-center gap-2">
          <span className="w-10 text-foreground/80 shrink-0 select-none">Orbit</span>
          <button
            type="button"
            onClick={onToggleOrbit}
            className={[
              'ml-auto px-2.5 py-0.5 rounded-md font-medium border transition',
              lavaOrbit
                ? 'bg-accent border-border text-foreground'
                : 'bg-muted border-border text-muted-foreground hover:bg-accent hover:text-foreground',
            ].join(' ')}
          >
            {lavaOrbit ? 'On' : 'Off'}
          </button>
        </div>
      </div>

      {/* field size */}
      <div className="flex flex-col gap-1.5 shrink-0">
        <span className={SECTION_LABEL}>Field size</span>
        <div className="grid grid-cols-3 gap-1">
          {ASPECT_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => onAspectChange(key)}
              className={[
                'px-1.5 py-0.5 rounded-md font-medium border transition',
                aspect === key
                  ? 'bg-accent border-border text-foreground'
                  : 'bg-muted border-border text-muted-foreground hover:bg-accent hover:text-foreground',
              ].join(' ')}
            >
              {key === 'free' ? 'Free' : key}
            </button>
          ))}
        </div>
      </div>

      {/* actions */}
      <div className="grid grid-cols-5 gap-1 shrink-0 pt-2.5 border-t border-border">
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
        <PanelIconButton
          onClick={onToggleTheme}
          icon={theme === 'dark' ? <Icon.Sun /> : <Icon.Moon />}
          label={theme === 'dark' ? 'Light theme' : 'Dark theme'}
        />
        <PanelIconButton onClick={onCopyCss} icon={<Icon.Copy   />} label="Copy CSS" />
        <PanelIconButton onClick={onExport}  icon={<Icon.Export />} label="Export" />
      </div>
    </aside>
  )
}

function EffectSlider({
  label, value, onChange, max = 100, suffix = '',
}: {
  label: string
  value: number
  onChange: (v: number) => void
  max?: number
  suffix?: string
}) {
  const sliderStyle: CSSProperties = {
    ['--slider-pct' as never]: `${(value / max) * 100}%`,
    ['--slider-fill' as never]: 'var(--color-muted-foreground)',
  }
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 text-foreground/80 shrink-0 select-none whitespace-nowrap">{label}</span>
      <input
        type="range"
        min={0}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="brand-slider flex-1"
        style={sliderStyle}
        aria-label={label}
      />
      <span className="w-7 text-right text-muted-foreground tabular-nums shrink-0">
        {value}{suffix}
      </span>
    </div>
  )
}

function PanelButton({
  children, icon, onClick,
}: {
  children: React.ReactNode
  icon?: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={[
        'inline-flex items-center justify-center gap-1.5 px-2 py-1 rounded-md w-full',
        'font-medium border transition',
        'bg-muted border-border text-foreground/90 hover:bg-accent hover:text-foreground',
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
        'inline-flex items-center justify-center h-7 rounded-md border transition',
        active
          ? 'bg-accent border-border text-foreground'
          : 'bg-muted border-border text-muted-foreground hover:bg-accent hover:text-foreground',
      ].join(' ')}
    >
      {icon}
    </button>
  )
}
