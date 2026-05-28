import { useEffect, useRef } from 'react'

export type MeshPoint = {
  id: string
  color: string  // #rrggbb
  x: number      // 0..1
  y: number      // 0..1
  size: number   // 0..1
  enabled?: boolean
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

const FRAG = `
precision highp float;

varying vec2 v_uv;

uniform vec2  u_resolution;
uniform float u_time;
uniform int   u_pointCount;
uniform vec2  u_points[${MAX_POINTS}];
uniform vec3  u_colors[${MAX_POINTS}];
uniform float u_sizes[${MAX_POINTS}];

/* ── noise / fbm ── */
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  float a = hash21(i), b = hash21(i+vec2(1,0)), c = hash21(i+vec2(0,1)), d = hash21(i+vec2(1,1));
  vec2 u = f*f*(3.0-2.0*f);
  return mix(a,b,u.x)+(c-a)*u.y*(1.0-u.x)+(d-b)*u.x*u.y;
}
float fbm(vec2 p) {
  float v=0.0, a=0.55;
  mat2 m = mat2(1.6,-1.2,1.2,1.6);
  for (int i=0;i<5;i++) { v+=a*noise(p); p=m*p; a*=0.52; }
  return v;
}

/* ── OKLab colour space ── (functions must be outside main in GLSL ES 1.0) */
vec3 lin_to_oklab(vec3 c) {
  float l = 0.4122214708*c.r + 0.5363325363*c.g + 0.0514459929*c.b;
  float m = 0.2119034982*c.r + 0.6806995451*c.g + 0.1073969566*c.b;
  float s = 0.0883024619*c.r + 0.2817188376*c.g + 0.6299787005*c.b;
  l = sign(l)*pow(abs(l),0.33333); m = sign(m)*pow(abs(m),0.33333); s = sign(s)*pow(abs(s),0.33333);
  return vec3(
    0.2104542553*l + 0.7936177850*m - 0.0040720468*s,
    1.9779984951*l - 2.4285922050*m + 0.4505937099*s,
    0.0259040371*l + 0.7827717662*m - 0.8086757660*s);
}
vec3 oklab_to_lin(vec3 lab) {
  float l = lab.x+0.3963377774*lab.y+0.2158037573*lab.z;
  float m = lab.x-0.1055613458*lab.y-0.0638541728*lab.z;
  float s = lab.x-0.0894841775*lab.y-1.2914855480*lab.z;
  l=l*l*l; m=m*m*m; s=s*s*s;
  return vec3(
     4.0767416621*l-3.3077115913*m+0.2309699292*s,
    -1.2684380046*l+2.6097574011*m-0.3413193965*s,
    -0.0041960863*l-0.7034186147*m+1.7076147010*s);
}
/* sRGB ↔ linear (γ = 2.2 approximation) */
vec3 srgb_to_lin(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }
vec3 lin_to_srgb(vec3 c) { return pow(clamp(c,0.0,1.0), vec3(0.45455)); }

/* ── domain warp ── */
vec2 domainWarp(vec2 uv, float t) {
  vec2 p = uv * 2.4;
  vec2 q = vec2(fbm(p + t*0.030), fbm(p + vec2(5.2,1.3) - t*0.028));
  vec2 r = vec2(fbm(p*2.2 + q*2.0 + vec2(1.7,9.2) + t*0.020),
                fbm(p*2.2 + q*2.0 + vec2(8.3,2.8) - t*0.018));
  return uv + (q*2.0-1.0)*0.24 + (r*2.0-1.0)*0.18;
}

void main() {
  vec2  uv  = v_uv;
  float t   = u_time;
  vec2  asp = vec2(u_resolution.x / u_resolution.y, 1.0);

  vec2 wuv = domainWarp(uv, t);
  float micro = fbm(wuv * 8.0 + vec2(t*0.035, -t*0.028));
  wuv += (micro*2.0-1.0) * 0.018;

  /* IDW blend in OKLab — avoids muddy brown from complementary colours */
  vec3  labSum = vec3(0.0);
  float wsum   = 0.0;

  for (int i = 0; i < ${MAX_POINTS}; i++) {
    if (i >= u_pointCount) break;
    float sz    = clamp(u_sizes[i], 0.05, 1.0);
    float sigma = mix(0.28, 0.52, sz);
    vec2  d     = (wuv - u_points[i]) * asp;
    float w     = exp(-dot(d,d) / (2.0*sigma*sigma));
    labSum += lin_to_oklab(srgb_to_lin(u_colors[i])) * w;
    wsum   += w;
  }

  vec3 col = lin_to_srgb(oklab_to_lin(labSum / max(wsum, 0.0001)));

  /* chroma boost — keep vivid colours vivid after blending */
  vec3 lab2 = lin_to_oklab(srgb_to_lin(col));
  lab2.yz  *= 1.55;
  col       = lin_to_srgb(oklab_to_lin(lab2));
  col       = clamp(col, 0.0, 1.0);

  /* soft brightness ripple */
  float ripple = fbm(wuv*4.8 + vec2(t*0.018, t*0.012));
  col = mix(col, col*1.05, smoothstep(0.38, 0.78, ripple)*0.18);

  /* film grain */
  float gn = hash21(gl_FragCoord.xy + vec2(t*110.0, -t*80.0));
  col += (gn-0.5)*0.010;

  /* vignette */
  float vig = smoothstep(1.0, 0.3, length((uv-0.5)*vec2(1.0,0.85)));
  col *= mix(0.96, 1.0, vig);

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`

/* ── WebGL helpers ── */

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const msg = gl.getShaderInfoLog(s) || 'shader error'
    gl.deleteShader(s)
    throw new Error(msg)
  }
  return s
}

function link(gl: WebGLRenderingContext, vs: WebGLShader, fs: WebGLShader) {
  const p = gl.createProgram()!
  gl.attachShader(p, vs); gl.attachShader(p, fs)
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const msg = gl.getProgramInfoLog(p) || 'link error'
    gl.deleteProgram(p)
    throw new Error(msg)
  }
  return p
}

function hexToRgb01(hex: string): [number, number, number] {
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i)
  if (!m) return [0.5, 0.5, 0.8]
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => v / 255) as [number, number, number]
}

/* ── component ── */

const PHI   = 1.6180339887
const DRIFT = 0.10

export function MeshCanvas({
  points,
  className,
}: {
  points: MeshPoint[]
  className?: string
}) {
  const canvasRef  = useRef<HTMLCanvasElement | null>(null)
  const pointsRef  = useRef(points)
  const rafRef     = useRef<number | null>(null)

  // keep latest points accessible in the RAF without restarting it
  useEffect(() => { pointsRef.current = points }, [points])

  useEffect(() => {
    const canvasEl = canvasRef.current
    if (!canvasEl) return

    const gl = canvasEl.getContext('webgl', {
      antialias: false, alpha: false, depth: false, stencil: false,
      preserveDrawingBuffer: true,
    })
    if (!gl) return

    const canvas = canvasEl

    const vs   = compile(gl, gl.VERTEX_SHADER,   VERT)
    const fs   = compile(gl, gl.FRAGMENT_SHADER,  FRAG)
    const prog = link(gl, vs, fs)

    const posLoc = gl.getAttribLocation(prog, 'a_pos')
    const buf    = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER,
      new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]),
      gl.STATIC_DRAW)

    const uRes   = gl.getUniformLocation(prog, 'u_resolution')
    const uTime  = gl.getUniformLocation(prog, 'u_time')
    const uCount = gl.getUniformLocation(prog, 'u_pointCount')
    const uPts   = gl.getUniformLocation(prog, 'u_points[0]')
    const uCols  = gl.getUniformLocation(prog, 'u_colors[0]')
    const uSizes = gl.getUniformLocation(prog, 'u_sizes[0]')

    // pre-allocate — avoids GC churn at 60 fps
    const pxy = new Float32Array(MAX_POINTS * 2)
    const col = new Float32Array(MAX_POINTS * 3)
    const siz = new Float32Array(MAX_POINTS)

    function resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w   = Math.max(1, Math.floor(canvas.clientWidth  * dpr))
      const h   = Math.max(1, Math.floor(canvas.clientHeight * dpr))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h
        gl.viewport(0, 0, w, h)
      }
    }

    const start = performance.now()
    window.addEventListener('resize', resize)

    const frame = () => {
      resize()

      const t      = (performance.now() - start) / 1000
      const active = pointsRef.current.filter(p => p.enabled !== false).slice(0, MAX_POINTS)

      // pack uniforms with animated positions (drift around home coords)
      pxy.fill(0); col.fill(0); siz.fill(0)
      for (let i = 0; i < active.length; i++) {
        const p = active[i]
        const f  = 0.05 + i * 0.011
        pxy[i*2]   = Math.max(0.01, Math.min(0.99, p.x + Math.sin(2*Math.PI*f      *t + i*2.4) * DRIFT))
        pxy[i*2+1] = Math.max(0.01, Math.min(0.99, p.y + Math.cos(2*Math.PI*f*PHI  *t + i*1.6) * DRIFT))
        const [r, g, b] = hexToRgb01(p.color)
        col[i*3] = r; col[i*3+1] = g; col[i*3+2] = b
        siz[i] = p.size
      }

      gl.useProgram(prog)
      gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      gl.enableVertexAttribArray(posLoc)
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

      gl.uniform2f(uRes,   canvas.width, canvas.height)
      gl.uniform1f(uTime,  t)
      gl.uniform1i(uCount, active.length)
      gl.uniform2fv(uPts,  pxy)
      gl.uniform3fv(uCols, col)
      gl.uniform1fv(uSizes, siz)

      gl.drawArrays(gl.TRIANGLES, 0, 6)
      rafRef.current = requestAnimationFrame(frame)
    }

    rafRef.current = requestAnimationFrame(frame)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', resize)
      gl.deleteProgram(prog)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      gl.deleteBuffer(buf)
    }
  }, []) // runs once — points are read via ref

  return <canvas ref={canvasRef} className={className} />
}
