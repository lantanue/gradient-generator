import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { MeshCanvas, type MeshPoint } from './components/MeshCanvas'
import { PRESETS, type Preset, type PresetSlot } from './presets'
import { BRAND_PALETTE } from './brand'

/* ─── data model ───────────────────────────────────────────── */

type Slot = { colorIndex: number; x: number; y: number; weight: number }

/** Total color slots. Mirrors MAX_POINTS in the WebGL shader. */
const MAX_SLOTS = 8

// Startup composition — pastel mix: 4 main colours present at gentle
// weights (Y/O/C balanced, Blue as a tiny accent) over a double white
// wash. Two slots intentionally inactive (Cyan/Yellow at 0) to leave
// room for manual additions without losing the brand colour identity.
const DEFAULT_SLOTS: Slot[] = [
  { colorIndex: 0, x: 0.42, y: 0.42, weight: 21 },  // Yellow
  { colorIndex: 1, x: 0.60, y: 0.55, weight: 18 },  // Orange
  { colorIndex: 2, x: 0.50, y: 0.85, weight: 18 },  // Cyan
  { colorIndex: 3, x: 0.92, y: 0.10, weight:  3 },  // Blue — tiny accent
  { colorIndex: 2, x: 0.50, y: 0.50, weight:  0 },  // Cyan slot, inactive
  { colorIndex: 0, x: 0.50, y: 0.50, weight:  0 },  // Yellow slot, inactive
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
  // Trim total to <= 8
  let total = capped.reduce((s, b) => s + b.count, 0)
  while (total > 8) {
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

  const slots: Slot[] = entries.map((e, i) => ({
    colorIndex: e.colorIndex,
    x: Math.max(0.05, Math.min(0.95, positions[i].x)),
    y: Math.max(0.05, Math.min(0.95, positions[i].y)),
    weight: roleToWeight(e.role, rnd),
  }))
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
      <div className="flex flex-col gap-3 min-h-0 flex-1 overflow-y-auto scroll-thin">
        <PanelButton onClick={onRandomize} icon={<Icon.Shuffle />} variant="primary">
          Randomize
        </PanelButton>
        <div className="flex flex-col gap-1.5">
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
