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

function blendColors(colors: string[]): string {
  if (!colors.length) return '#0a0a1a'
  const rgb = colors.map(hexToRgb)
  const r = rgb.reduce((s, c) => s + c[0], 0) / rgb.length
  const g = rgb.reduce((s, c) => s + c[1], 0) / rgb.length
  const b = rgb.reduce((s, c) => s + c[2], 0) / rgb.length
  // darken the blend so it reads as a deep background
  return `rgb(${Math.round(r * 0.45)},${Math.round(g * 0.45)},${Math.round(b * 0.45)})`
}

/* ─── wave path ────────────────────────────────────────────── */

function buildWavePath(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  yOffset: number,
  amplitude: number,
  frequency: number,
  phase: number,
  thickness: number,
  t: number,
  speed: number,
) {
  const steps = 120
  const top: [number, number][] = []
  const bot: [number, number][] = []

  for (let i = 0; i <= steps; i++) {
    const nx = i / steps
    const x = nx * W
    const baseY =
      yOffset +
      amplitude * Math.sin(frequency * nx * Math.PI * 2 + phase + t * speed) +
      amplitude * 0.35 * Math.sin(frequency * 1.7 * nx * Math.PI * 2 + phase * 1.4 + t * speed * 0.6)
    const half = (thickness * 0.5) * H
    top.push([x, baseY * H - half])
    bot.push([x, baseY * H + half])
  }

  ctx.beginPath()
  ctx.moveTo(top[0][0], top[0][1])
  for (let i = 1; i < top.length; i++) ctx.lineTo(top[i][0], top[i][1])
  for (let i = bot.length - 1; i >= 0; i--) ctx.lineTo(bot[i][0], bot[i][1])
  ctx.closePath()
}

/* ─── renderer ─────────────────────────────────────────────── */

const PHI = 1.6180339887   // golden ratio — keeps x/y frequencies incommensurable
const DRIFT = 0.13          // max drift radius as fraction of canvas

function render(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  points: MeshPoint[],
  t: number,
) {
  /* ── filter disabled + animate positions ── */
  const active = points.filter(p => p.enabled !== false)
  if (!active.length) {
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = '#0a0a1a'
    ctx.fillRect(0, 0, W, H)
    return
  }

  // Each point drifts around its home (x, y) using two sine waves with
  // incommensurable frequencies so the path never exactly repeats.
  const pts = active.map((p, i) => {
    const f  = 0.05 + i * 0.011                      // Hz, ~18-12 s period
    const ax = p.x + Math.sin(Math.PI * 2 * f       * t + i * 2.4) * DRIFT
    const ay = p.y + Math.cos(Math.PI * 2 * f * PHI * t + i * 1.6) * DRIFT
    return {
      ...p,
      x: Math.max(0.04, Math.min(0.96, ax)),
      y: Math.max(0.04, Math.min(0.96, ay)),
    }
  })

  ctx.clearRect(0, 0, W, H)
  const colors = pts.map(p => p.color)

  /* ── 1. Background ── */
  ctx.fillStyle = blendColors(colors)
  ctx.fillRect(0, 0, W, H)

  /* ── 2. Glow blobs (behind waves) ── */
  ctx.save()
  ctx.filter = 'blur(60px)'
  pts.forEach((p, i) => {
    const phase = i * 1.2 + t * 0.15
    const bx = (p.x + Math.sin(phase) * 0.05) * W
    const by = (p.y + Math.cos(phase * 0.8) * 0.04) * H
    const rx = (0.25 + p.size * 0.2) * W
    const ry = (0.18 + p.size * 0.15) * H

    ctx.globalAlpha = 0.70
    ctx.beginPath()
    ctx.ellipse(bx, by, rx, ry, i * 0.4, 0, Math.PI * 2)
    ctx.fillStyle = rgba(p.color, 1)
    ctx.fill()
  })
  ctx.restore()

  /* ── 3. Wave ribbons ── */
  pts.forEach((p, i) => {
    const phase     = p.x * Math.PI * 2
    const yOffset   = p.y
    const amplitude = 0.06 + p.size * 0.07
    const thickness = 0.08 + p.size * 0.10
    const frequency = 1.2 + (i % 3) * 0.4
    const speed     = 0.18 + i * 0.03

    ctx.save()
    ctx.filter = 'blur(6px)'
    buildWavePath(ctx, W, H, yOffset, amplitude, frequency, phase, thickness, t, speed)

    const cy = yOffset * H
    const grad = ctx.createLinearGradient(0, cy - thickness * H * 0.55, 0, cy + thickness * H * 0.55)
    grad.addColorStop(0,   rgba(p.color, 0))
    grad.addColorStop(0.3, rgba(p.color, 0.55))
    grad.addColorStop(0.5, rgba(p.color, 0.85))
    grad.addColorStop(0.7, rgba(p.color, 0.55))
    grad.addColorStop(1,   rgba(p.color, 0))
    ctx.fillStyle = grad
    ctx.globalAlpha = 0.9
    ctx.fill()
    ctx.restore()
  })

  /* ── 4. Atmospheric overlays ── */
  ctx.save()
  ctx.filter = 'blur(45px)'
  ctx.globalAlpha = 0.28
  pts.forEach((p, i) => {
    if (i % 2 !== 0) return
    const ox = (p.x + Math.cos(t * 0.1 + i) * 0.08) * W
    const oy = (p.y + Math.sin(t * 0.12 + i) * 0.08) * H
    ctx.beginPath()
    ctx.ellipse(ox, oy, W * 0.35, H * 0.28, i * 0.6, 0, Math.PI * 2)
    ctx.fillStyle = rgba(p.color, 1)
    ctx.fill()
  })
  ctx.restore()
}

/* ─── component ────────────────────────────────────────────── */

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
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width  = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
        ctx!.scale(dpr, dpr)
      }
    }

    const start = performance.now()
    const onResize = () => resize()
    window.addEventListener('resize', onResize)

    const frame = () => {
      resize()
      const t = (performance.now() - start) / 1000
      const W = canvas.clientWidth
      const H = canvas.clientHeight
      render(ctx!, W, H, pointsRef.current, t)
      rafRef.current = requestAnimationFrame(frame)
    }

    rafRef.current = requestAnimationFrame(frame)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return <canvas ref={canvasRef} className={className} />
}
