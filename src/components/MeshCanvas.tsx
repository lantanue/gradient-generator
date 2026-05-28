import { useEffect, useMemo, useRef } from 'react'

export type MeshPoint = {
  id: string
  color: string // #rrggbb
  x: number // 0..1
  y: number // 0..1
  size: number // 0..1
}

const MAX_POINTS = 8

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = (a_pos + 1.0) * 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`

// Pastel mesh with gentle domain-warp.
// The goal is to match the “liquid” look from the reference screenshots.
const FRAG = `
#extension GL_OES_standard_derivatives : enable
precision highp float;

varying vec2 v_uv;

uniform vec2 u_resolution;
uniform float u_time;
uniform int u_pointCount;
uniform vec2 u_points[${MAX_POINTS}];
uniform vec3 u_colors[${MAX_POINTS}];
uniform float u_sizes[${MAX_POINTS}];

float hash21(vec2 p) {
  // iq-style hash
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.55;
  mat2 m = mat2(1.6, -1.2, 1.2, 1.6);
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = m * p;
    a *= 0.52;
  }
  return v;
}

vec2 warp(vec2 uv, float t) {
  // two-stage domain warp to get the “ridges” seen on the reference
  float k1 = 1.0;
  float k2 = 2.2;
  vec2 p = uv * 3.1;
  vec2 q = vec2(
    fbm(p + vec2(0.0, 0.0) + t * 0.03),
    fbm(p + vec2(5.2, 1.3) - t * 0.028)
  );
  vec2 r = vec2(
    fbm(p * k2 + q * 2.0 + vec2(1.7, 9.2) + t * 0.02),
    fbm(p * k2 + q * 2.0 + vec2(8.3, 2.8) - t * 0.018)
  );
  // much stronger for visible “liquid” flow
  return uv + (q * 2.0 - 1.0) * 0.12 * k1 + (r * 2.0 - 1.0) * 0.095;
}

void main() {
  vec2 uv = v_uv;
  float t = u_time;

  // keep aspect stable for distance fields
  vec2 asp = vec2(u_resolution.x / u_resolution.y, 1.0);
  vec2 wuv = warp(uv, t);
  // secondary micro-warp to create “refractive” bands
  float micro = fbm(wuv * 10.0 + vec2(t * 0.04, -t * 0.03));
  wuv += (micro * 2.0 - 1.0) * 0.012;

  vec3 col = vec3(0.965, 0.985, 0.995); // airy base
  float wsum = 0.0;
  float field = 0.0;

  for (int i = 0; i < ${MAX_POINTS}; i++) {
    if (i >= u_pointCount) break;
    vec2 p = u_points[i];
    float s = clamp(u_sizes[i], 0.05, 1.0);
    float sigma = mix(0.14, 0.36, s);
    vec2 d = (wuv - p) * asp;
    float dist2 = dot(d, d);
    float w = exp(-dist2 / (2.0 * sigma * sigma));
    col += u_colors[i] * w;
    wsum += w;
    field += w;
  }

  col /= (1.0 + wsum);

  // “liquid” edge definition:
  // - local field gradient creates thin flow lines at boundaries
  // - plus an additional warped ridge layer
  #ifdef GL_OES_standard_derivatives
    float g = length(vec2(dFdx(field), dFdy(field)));
    float edge = smoothstep(0.010, 0.065, g);
    // brighter bands + a tiny shadow for visible “переливы”
    col += edge * 0.12;
    col -= edge * 0.06;
  #endif

  float ridgeN = fbm(wuv * 5.4 + vec2(0.0, t * 0.02));
  float ridge = smoothstep(0.32, 0.92, ridgeN);
  col = mix(col, col + 0.08, ridge * 0.28);

  // very light grain (like screen capture)
  float gn = hash21(gl_FragCoord.xy + vec2(t * 120.0, -t * 90.0));
  col += (gn - 0.5) * 0.012;

  // ultra-soft vignette
  float v = smoothstep(0.95, 0.25, length((uv - 0.5) * vec2(1.05, 0.85)));
  col = mix(col, col * 0.985, v * 0.35);

  gl_FragColor = vec4(col, 1.0);
}
`

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type)
  if (!s) throw new Error('shader create failed')
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const msg = gl.getShaderInfoLog(s) || 'shader compile failed'
    gl.deleteShader(s)
    throw new Error(msg)
  }
  return s
}

function link(gl: WebGLRenderingContext, vs: WebGLShader, fs: WebGLShader) {
  const p = gl.createProgram()
  if (!p) throw new Error('program create failed')
  gl.attachShader(p, vs)
  gl.attachShader(p, fs)
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const msg = gl.getProgramInfoLog(p) || 'program link failed'
    gl.deleteProgram(p)
    throw new Error(msg)
  }
  return p
}

function hexToRgb01(hex: string): [number, number, number] {
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i)
  if (!m) return [0.4, 0.8, 0.7]
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return [r / 255, g / 255, b / 255]
}

export function MeshCanvas({
  points,
  className,
}: {
  points: MeshPoint[]
  className?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number | null>(null)

  const packed = useMemo(() => {
    const pts = points.slice(0, MAX_POINTS)
    const pxy = new Float32Array(MAX_POINTS * 2)
    const col = new Float32Array(MAX_POINTS * 3)
    const siz = new Float32Array(MAX_POINTS)
    for (let i = 0; i < MAX_POINTS; i++) {
      const p = pts[i]
      pxy[i * 2 + 0] = p ? p.x : 0
      pxy[i * 2 + 1] = p ? p.y : 0
      const rgb = p ? hexToRgb01(p.color) : ([0, 0, 0] as const)
      col[i * 3 + 0] = rgb[0]
      col[i * 3 + 1] = rgb[1]
      col[i * 3 + 2] = rgb[2]
      siz[i] = p ? p.size : 0
    }
    return { count: pts.length, pxy, col, siz }
  }, [points])

  useEffect(() => {
    const canvasEl = canvasRef.current
    if (!canvasEl) return
    const glEl = canvasEl.getContext('webgl', {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true,
    })
    if (!glEl) return
    // Enable derivatives for edge lines (best-effort).
    glEl.getExtension('OES_standard_derivatives')
    const canvas = canvasEl
    const gl = glEl

    const vs = compile(gl, gl.VERTEX_SHADER, VERT)
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG)
    const prog = link(gl, vs, fs)

    const posLoc = gl.getAttribLocation(prog, 'a_pos')
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    )

    const uResolution = gl.getUniformLocation(prog, 'u_resolution')
    const uTime = gl.getUniformLocation(prog, 'u_time')
    const uPointCount = gl.getUniformLocation(prog, 'u_pointCount')
    const uPoints = gl.getUniformLocation(prog, 'u_points[0]')
    const uColors = gl.getUniformLocation(prog, 'u_colors[0]')
    const uSizes = gl.getUniformLocation(prog, 'u_sizes[0]')

    function resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr))
      const h = Math.max(1, Math.floor(canvas.clientHeight * dpr))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
        gl.viewport(0, 0, w, h)
      }
    }

    let start = performance.now()
    const onResize = () => resize()
    window.addEventListener('resize', onResize)

    const frame = () => {
      resize()
      gl.useProgram(prog)

      gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      gl.enableVertexAttribArray(posLoc)
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

      const now = performance.now()
      const t = (now - start) / 1000

      gl.uniform2f(uResolution, canvas.width, canvas.height)
      gl.uniform1f(uTime, t)
      gl.uniform1i(uPointCount, packed.count)
      gl.uniform2fv(uPoints, packed.pxy)
      gl.uniform3fv(uColors, packed.col)
      gl.uniform1fv(uSizes, packed.siz)

      gl.drawArrays(gl.TRIANGLES, 0, 6)
      rafRef.current = requestAnimationFrame(frame)
    }

    rafRef.current = requestAnimationFrame(frame)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', onResize)
      gl.deleteProgram(prog)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      gl.deleteBuffer(buf)
    }
  }, [packed])

  return <canvas ref={canvasRef} className={className} />
}

