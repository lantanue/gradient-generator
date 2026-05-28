import { useEffect, useRef } from 'react'
import type { MeshPoint } from './MeshCanvas'

export type { MeshPoint }

/* ─── helpers ──────────────────────────────────────────────── */

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i)
  if (!m) return [120, 120, 200]
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgba(hex: string, a: number) {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r},${g},${b},${a})`
}

/* ─── smooth ribbon path ────────────────────────────────────── */
// Quadratic bezier through midpoints → no sharp kinks

function traceEdge(
  ctx: CanvasRenderingContext2D,
  pts: [number, number][],
  move: boolean,
) {
  if (move) ctx.moveTo(pts[0][0], pts[0][1])
  else ctx.lineTo(pts[0][0], pts[0][1])
  for (let i = 0; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2
    const my = (pts[i][1] + pts[i + 1][1]) / 2
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my)
  }
  ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1])
}

function drawRibbon(
  ctx: CanvasRenderingContext2D,
  top: [number, number][],
  bot: [number, number][],
) {
  ctx.beginPath()
  traceEdge(ctx, top, true)                          // left → right on top
  ctx.lineTo(bot[bot.length - 1][0], bot[bot.length - 1][1])
  traceEdge(ctx, [...bot].reverse(), false)          // right → left on bottom
  ctx.closePath()
}

/* ─── single silk band ──────────────────────────────────────── */

function drawSilkBand(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  p: MeshPoint & { x: number; y: number },
  i: number,
  t: number,
) {
  const STEPS     = 72
  const amplitude = 0.068 + p.size * 0.052
  const frequency = 0.82 + (i % 4) * 0.30
  const speed     = 0.09  + i * 0.020
  const phase     = p.x * Math.PI * 2
  const halfH     = (0.10 + p.size * 0.115) * H   // half-thickness in px

  /* centerline */
  const centers: [number, number][] = []
  for (let k = 0; k <= STEPS; k++) {
    const nx = k / STEPS
    const ny =
      p.y +
      amplitude * Math.sin(frequency * nx * Math.PI * 2 + phase + t * speed) +
      amplitude * 0.30 * Math.sin(frequency * 1.87 * nx * Math.PI * 2 + phase * 1.45 + t * speed * 0.62) +
      amplitude * 0.11 * Math.sin(frequency * 2.71 * nx * Math.PI * 2 + phase * 0.77 + t * speed * 1.08)
    centers.push([nx * W, Math.max(-halfH, Math.min(H + halfH, ny * H))])
  }

  const top  = centers.map(([x, y]) => [x, y - halfH]  as [number, number])
  const bot  = centers.map(([x, y]) => [x, y + halfH]  as [number, number])
  const midY = centers[Math.floor(STEPS / 2)][1]

  const [r, g, b] = hexToRgb(p.color)
  const bri = (v: number, d: number) => Math.min(255, v + d)
  const dim = (v: number, d: number) => Math.max(0, v - d)

  /* ── band body: cylindrical shading ── */
  ctx.save()
  ctx.filter = 'blur(2px)'
  drawRibbon(ctx, top, bot)

  const cyl = ctx.createLinearGradient(0, midY - halfH, 0, midY + halfH)
  cyl.addColorStop(0.00, `rgba(${dim(r,65)},${dim(g,65)},${dim(b,65)},0.00)`)
  cyl.addColorStop(0.14, `rgba(${dim(r,35)},${dim(g,35)},${dim(b,35)},0.58)`)
  cyl.addColorStop(0.36, `rgba(${r},${g},${b},0.92)`)
  cyl.addColorStop(0.50, `rgba(${bri(r,55)},${bri(g,50)},${bri(b,45)},1.00)`)
  cyl.addColorStop(0.64, `rgba(${r},${g},${b},0.92)`)
  cyl.addColorStop(0.86, `rgba(${dim(r,35)},${dim(g,35)},${dim(b,35)},0.58)`)
  cyl.addColorStop(1.00, `rgba(${dim(r,65)},${dim(g,65)},${dim(b,65)},0.00)`)

  ctx.fillStyle = cyl
  ctx.fill()
  ctx.restore()

  /* ── specular shimmer — thin bright stripe that sweeps across ── */
  ctx.save()
  ctx.filter = 'blur(1.5px)'

  const specOff  = halfH * -0.22      // slightly above center
  const specHalf = halfH * 0.052      // very thin
  const specTop  = centers.map(([x, y]) => [x, y + specOff - specHalf] as [number, number])
  const specBot  = centers.map(([x, y]) => [x, y + specOff + specHalf] as [number, number])
  drawRibbon(ctx, specTop, specBot)

  // highlight sweep: x position oscillates slowly across width
  const sweepX = ((Math.sin(t * 0.26 + i * 1.571) + 1) * 0.5) * W
  const shimmer = ctx.createLinearGradient(sweepX - W * 0.32, 0, sweepX + W * 0.32, 0)
  shimmer.addColorStop(0,   'rgba(255,255,255,0.00)')
  shimmer.addColorStop(0.45,'rgba(255,255,255,0.75)')
  shimmer.addColorStop(0.55,'rgba(255,255,255,0.85)')
  shimmer.addColorStop(1,   'rgba(255,255,255,0.00)')

  ctx.fillStyle = shimmer
  ctx.globalAlpha = 0.88
  ctx.fill()
  ctx.restore()

  /* ── soft edge glow ── */
  ctx.save()
  ctx.filter = 'blur(18px)'
  drawRibbon(ctx, top, bot)
  ctx.globalAlpha = 0.18
  ctx.fillStyle = rgba(p.color, 1)
  ctx.fill()
  ctx.restore()
}

/* ─── full scene renderer ───────────────────────────────────── */

const PHI   = 1.6180339887
const DRIFT = 0.12

function render(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  points: MeshPoint[],
  t: number,
) {
  /* filter disabled + drift animation */
  const active = points.filter(p => p.enabled !== false)

  /* near-black background — lets colors read as metal/silk */
  ctx.fillStyle = '#07070e'
  ctx.fillRect(0, 0, W, H)

  if (!active.length) return

  const pts = active.map((p, i) => {
    const f  = 0.05 + i * 0.011
    const ax = p.x + Math.sin(Math.PI * 2 * f       * t + i * 2.4) * DRIFT
    const ay = p.y + Math.cos(Math.PI * 2 * f * PHI * t + i * 1.6) * DRIFT
    return { ...p, x: Math.max(0.04, Math.min(0.96, ax)), y: Math.max(0.04, Math.min(0.96, ay)) }
  })

  /* deep ambient glow — color fog far behind the bands */
  ctx.save()
  ctx.filter = 'blur(100px)'
  pts.forEach((p, i) => {
    ctx.globalAlpha = 0.22
    ctx.beginPath()
    ctx.ellipse(p.x * W, p.y * H, W * 0.48, H * 0.40, i * 0.5, 0, Math.PI * 2)
    ctx.fillStyle = rgba(p.color, 1)
    ctx.fill()
  })
  ctx.restore()

  /* silk bands — drawn back to front */
  pts.forEach((p, i) => drawSilkBand(ctx, W, H, p, i, t))

  /* vignette — darkens edges slightly for depth */
  const vig = ctx.createRadialGradient(
    W * 0.5, H * 0.48, Math.min(W, H) * 0.18,
    W * 0.5, H * 0.48, Math.max(W, H) * 0.92,
  )
  vig.addColorStop(0, 'rgba(0,0,0,0.00)')
  vig.addColorStop(0.65, 'rgba(0,0,0,0.00)')
  vig.addColorStop(1, 'rgba(0,0,0,0.52)')
  ctx.fillStyle = vig
  ctx.fillRect(0, 0, W, H)
}

/* ─── component ─────────────────────────────────────────────── */

export function WaveCanvas({
  points,
  className,
}: {
  points: MeshPoint[]
  className?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pointsRef = useRef(points)
  const rafRef    = useRef<number | null>(null)

  useEffect(() => { pointsRef.current = points }, [points])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    function resize() {
      if (!canvas) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w   = canvas.clientWidth
      const h   = canvas.clientHeight
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width  = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
        ctx!.scale(dpr, dpr)
      }
    }

    const start = performance.now()
    window.addEventListener('resize', resize)

    const frame = () => {
      resize()
      const t = (performance.now() - start) / 1000
      render(ctx!, canvas.clientWidth, canvas.clientHeight, pointsRef.current, t)
      rafRef.current = requestAnimationFrame(frame)
    }
    rafRef.current = requestAnimationFrame(frame)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return <canvas ref={canvasRef} className={className} />
}
