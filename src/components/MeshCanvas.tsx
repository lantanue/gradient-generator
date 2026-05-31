import { useEffect, useRef } from 'react'

export type MeshPoint = {
  id: string
  color: string  // #rrggbb
  x: number      // 0..1
  y: number      // 0..1
  size: number   // 0..1
  enabled?: boolean
}

const MAX_POINTS = 6

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  // Flip Y so v_uv matches CSS coords (y=0 at top, y=1 at bottom).
  // Point positions (u_points) use CSS coords, so they line up directly.
  v_uv = vec2((a_pos.x + 1.0) * 0.5, 1.0 - (a_pos.y + 1.0) * 0.5);
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
uniform float u_lava;       // lava-lamp twist intensity (0 = clean gradient)
uniform float u_lavaScale;  // swirl radius scale (1 = default size)
uniform vec2  u_lavaCenter; // distortion-centre offset (0 = centred; may be off-frame)
uniform float u_lavaRot;    // rotation of the swirl cluster, radians (0..2π)

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

/* ── gentle global warp ── smooth low-frequency sines, NOT noise.
   Bends the IDW field into flowing S-curves; a cross-axis layer (depends
   on both uv.x and uv.y) yields diagonal ribbons so the curves do not all
   align with a single axis. */
vec2 gentleWarp(vec2 uv, float t, float lava) {
  float wx = sin(uv.y * 3.1 + t * 0.25) * 0.45
           + sin(uv.y * 1.7 - t * 0.18 + 1.3) * 0.40
           + sin((uv.x + uv.y) * 2.3 + t * 0.20 + 0.6) * 0.30;
  float wy = sin(uv.x * 2.7 - t * 0.22 + 0.7) * 0.45
           + sin(uv.x * 1.9 + t * 0.14 + 2.1) * 0.40
           + sin((uv.x - uv.y) * 2.6 - t * 0.17 + 1.9) * 0.30;
  return uv + vec2(wx, wy) * 0.095 * lava;
}

/* ── swirl ── rotate UV around a centre, strength fades to 0 at radius.
   Two of these stacked give abstract, twisted color patterns. */
vec2 swirl(vec2 uv, vec2 c, float strength, float radius) {
  vec2 d  = uv - c;
  float r = length(d);
  float w = smoothstep(radius, 0.0, r);     // 1 at centre → 0 at edge
  float a = strength * w * w;                 // squared falloff
  float ca = cos(a), sa = sin(a);
  return c + mat2(ca, -sa, sa, ca) * d;
}

/* ── per-point lens warp ── each control point gently pulls nearby UVs.
   Tiny amplitude — keeps blob centres locked to their handle position. */
vec2 lensWarp(vec2 uv, vec2 asp) {
  vec2 disp = vec2(0.0);
  for (int i = 0; i < ${MAX_POINTS}; i++) {
    if (i >= u_pointCount) break;
    float sz = clamp(u_sizes[i], 0.05, 1.0);
    float r0 = mix(0.16, 0.65, sz);
    vec2  d  = (uv - u_points[i]) * asp;
    float f  = exp(-dot(d, d) / (2.0 * r0 * r0));
    disp += -d * f * 0.015;
  }
  return uv + disp;
}

/* Shepard's IDW field sample. Returns colour at the given (already
   warped) UV plus two out params for the edge effect:
   - dominance: maxW / sumW (1.0 in colour core, lower at boundaries)
   - colourSpread: weighted variance of OKLab chroma (a, b). Near 0
     when contributing points share a colour (same cyan overlapping)
     and rises as different colours compete. The edge effect uses
     this to skip "fake" boundaries between same-colour points. */
vec3 idwField(vec2 sampleUv, vec2 asp, out float dominance, out float colourSpread) {
  vec3  labSum   = vec3(0.0);
  vec3  labSqSum = vec3(0.0);
  float wsum     = 0.0;
  float maxW     = 0.0;
  for (int i = 0; i < ${MAX_POINTS}; i++) {
    if (i >= u_pointCount) break;
    float sz = clamp(u_sizes[i], 0.05, 1.0);
    sz *= 1.0 + 0.10 * sin(u_time * 0.42 + float(i) * 1.37);
    vec2  d_vec = (sampleUv - u_points[i]) * asp;
    float d     = length(d_vec);
    float wRaw  = (pow(sz, 1.4) + 0.05) / (pow(d, 2.5) + 0.005);
    vec3  lab   = lin_to_oklab(srgb_to_lin(u_colors[i]));
    // Low-chroma colours (white) would otherwise read as "translucent"
    // because they contribute no a/b to the OKLab mean. Boost their
    // weight so white claims its own region as confidently as vivid hues.
    float chroma = length(vec2(lab.y, lab.z));
    float chromaBoost = mix(1.55, 1.0, smoothstep(0.0, 0.10, chroma));
    float w = wRaw * chromaBoost;
    if (w > maxW) maxW = w;
    labSum   += lab * w;
    labSqSum += lab * lab * w;
    wsum     += w;
  }
  dominance = maxW / wsum;
  vec3 mean     = labSum   / wsum;
  vec3 variance = labSqSum / wsum - mean * mean;
  colourSpread  = length(vec2(variance.y, variance.z));   // a/b chroma spread
  return lin_to_srgb(oklab_to_lin(mean));
}

/* Apply the full UV warp pipeline used by both passes.
   Three swirls drifting along independent Lissajous orbits + the
   sine warp give the lava-lamp feel: large slow bends of the field. */
vec2 fullWarp(vec2 uv, vec2 asp, float t, float lava) {
  // u_lavaCenter shifts the whole swirl cluster (may go off-frame).
  vec2 ctr = u_lavaCenter;
  vec2 sc1 = vec2(0.32 + 0.13 * sin(t * 0.07),
                  0.66 + 0.11 * cos(t * 0.09 + 1.2)) + ctr;
  vec2 sc2 = vec2(0.72 + 0.12 * cos(t * 0.08 + 2.4),
                  0.30 + 0.13 * sin(t * 0.11)) + ctr;
  vec2 sc3 = vec2(0.50 + 0.18 * sin(t * 0.05 + 0.8),
                  0.50 + 0.16 * cos(t * 0.06 + 2.0)) + ctr;
  // u_lavaRot spins the whole swirl cluster around its centre.
  float cr = cos(u_lavaRot), sr = sin(u_lavaRot);
  mat2  Rl = mat2(cr, -sr, sr, cr);
  vec2  cc = vec2(0.5) + ctr;
  sc1 = cc + Rl * (sc1 - cc);
  sc2 = cc + Rl * (sc2 - cc);
  sc3 = cc + Rl * (sc3 - cc);
  // u_lavaScale enlarges/tightens the swirl radius ("скругление").
  float sc = max(0.08, u_lavaScale);
  // Swirl strengths scale with lava: 0 → identity (clean gradient),
  // higher → watercolor-in-water churn. lensWarp stays unscaled so the
  // blob centres keep anchoring to their handle positions.
  vec2 wuv = swirl(uv,  sc1,  0.75 * lava, 0.48 * sc);
       wuv = swirl(wuv, sc2, -0.65 * lava, 0.52 * sc);
       wuv = swirl(wuv, sc3,  0.40 * lava, 0.55 * sc);
  // gentleWarp is the secondary flow — cap its lava factor so high twist
  // stays rotational (swirl) instead of degrading into chaotic domain warp.
  wuv = gentleWarp(wuv, t, min(lava, 2.0));
  wuv = lensWarp(wuv, asp);
  return wuv;
}

void main() {
  vec2  uv  = v_uv;
  float t   = u_time;
  vec2  asp = vec2(u_resolution.x / u_resolution.y, 1.0);

  // Primary IDW pass with dominance + colour-spread tracking.
  vec2  wuv1 = fullWarp(uv, asp, t, u_lava);
  float dominance, colourSpread;
  vec3  col1 = idwField(wuv1, asp, dominance, colourSpread);

  // Ghost pass: same mesh sampled through a rotated/scaled UV. Layered
  // on top via multiply blend to produce an X-ray-style "second slide
  // peeking through". Rotation 0.6 rad ≈ 34°, slight inward shrink so
  // the ghost stays mostly on-canvas.
  vec2 ghostUv = uv - vec2(0.5);
  float ga = 0.6;
  ghostUv = mat2(cos(ga), -sin(ga), sin(ga), cos(ga)) * ghostUv;
  ghostUv = ghostUv * 0.92 + vec2(0.5);
  vec2  wuv2 = fullWarp(ghostUv, asp, t, u_lava);
  float ghostDominance, ghostSpread;   // unused
  vec3  col2 = idwField(wuv2, asp, ghostDominance, ghostSpread);

  // Same-colour gate: 0 when contributing points share a colour
  // (e.g. white over white), 1 when their colours genuinely differ.
  // Used to suppress both the ghost overlay and the edge effect so
  // same-colour overlaps stay clean.
  float colorMix = smoothstep(0.005, 0.05, colourSpread);

  // Multiply-style overlay — gated by dominance AND colorMix so the
  // ghost only affects boundary regions where colours genuinely meet.
  // Pure colour centres (and same-colour overlaps) keep the brand hex.
  // Also gated by lava so a fully-clean look (lava→0) drops the ghost too.
  float ghostStrength = 0.30 * smoothstep(0.65, 0.30, dominance) * colorMix * clamp(u_lava, 0.0, 1.0);
  vec3  col = mix(col1, col1 * col2 * 1.5, ghostStrength);

  // Chroma boost — very mild, just to compensate for OKLab averaging.
  vec3 lab2 = lin_to_oklab(srgb_to_lin(col));
  lab2.yz  *= 1.15;
  col       = lin_to_srgb(oklab_to_lin(lab2));
  col       = clamp(col, 0.0, 1.0);

  // Edge transitions: where two DIFFERENT-colour points compete we
  // lift chroma + tiny L glow + micro hue rotation. Suppressed when
  // the competing contributors share a colour (colourSpread ~ 0), so
  // same-colour overlaps merge seamlessly instead of growing a seam.
  float edgeRaw  = smoothstep(0.55, 0.22, dominance);
  float edge     = edgeRaw * colorMix;
  vec3  labE = lin_to_oklab(srgb_to_lin(col));
  labE.x  += edge * 0.02;                    // subtle glow lift
  labE.yz *= 1.0 + edge * 0.22;              // mild chroma lift at edges
  float ha = edge * 0.10;                    // hue micro-shift (~6° max)
  float hc = cos(ha), hs = sin(ha);
  labE.yz  = mat2(hc, -hs, hs, hc) * labE.yz;
  col      = lin_to_srgb(oklab_to_lin(labE));

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

export const PHI   = 1.6180339887
export const DRIFT = 0.04   // amplitude of Lissajous orbit per point (~4% of canvas)

// shared formula so DragHandles can mirror the exact same animated position
export function driftedPosition(
  baseX: number, baseY: number, i: number, t: number, intensity: number = 1,
): { x: number; y: number } {
  const f = 0.018 + i * 0.004
  const dx = Math.sin(2 * Math.PI * f       * t + i * 2.4) * DRIFT * intensity
  const dy = Math.cos(2 * Math.PI * f * PHI * t + i * 1.6) * DRIFT * intensity
  // No clamp — points may live anywhere, including well outside the frame.
  return { x: baseX + dx, y: baseY + dy }
}

export function MeshCanvas({
  points,
  className,
  animate = true,
  speed = 50,
  lava = 40,
  lavaX = 50,
  lavaY = 50,
  lavaRot = 0,
  lavaOrbit = false,
  transitionKey = 0,
  positionsRef,
  lavaCenterRef,
  exportRef,
}: {
  points: MeshPoint[]
  className?: string
  animate?: boolean
  /** 0..100 — animation speed; 50 = 1.0× (current). */
  speed?: number
  /** 0..100 — lava intensity; drives both twist strength and swirl size. 40 ≈ current look, 0 = clean. */
  lava?: number
  /** 0..100 — distortion-centre X; 50 = centred, 0/100 push off-frame. */
  lavaX?: number
  /** 0..100 — distortion-centre Y; 50 = centred, 0/100 push off-frame. */
  lavaY?: number
  /** 0..360 — rotation of the swirl cluster, degrees. */
  lavaRot?: number
  /** When true the distortion centre orbits a large ring outside the frame. */
  lavaOrbit?: boolean
  /** Bump this to animate a transition (points glide + crossfade) to the new points. */
  transitionKey?: number
  /** Optional. Receives [x0, y0, x1, y1, ...] of animated point positions each frame. */
  positionsRef?: React.RefObject<Float32Array | null>
  /** Optional. Receives the current [x, y] of the lava centre (frame-normalised) each frame. */
  lavaCenterRef?: React.RefObject<Float32Array | null>
  /** Optional. Populated with a hi-res export fn `(w,h) => pngDataUrl`. */
  exportRef?: React.RefObject<((w: number, h: number) => string | null) | null>
}) {
  const canvasRef  = useRef<HTMLCanvasElement | null>(null)
  const pointsRef  = useRef(points)
  const animateRef = useRef(animate)
  const speedRef   = useRef(speed)
  const lavaRef    = useRef(lava)
  const lavaXRef   = useRef(lavaX)
  const lavaYRef   = useRef(lavaY)
  const lavaRotRef = useRef(lavaRot)
  const lavaOrbitRef = useRef(lavaOrbit)
  const transKeyRef = useRef(transitionKey)
  const rafRef     = useRef<number | null>(null)

  // keep latest values accessible in the RAF without restarting it
  useEffect(() => { pointsRef.current = points }, [points])
  useEffect(() => { animateRef.current = animate }, [animate])
  useEffect(() => { speedRef.current = speed }, [speed])
  useEffect(() => { lavaRef.current = lava }, [lava])
  useEffect(() => { lavaXRef.current = lavaX }, [lavaX])
  useEffect(() => { lavaYRef.current = lavaY }, [lavaY])
  useEffect(() => { lavaRotRef.current = lavaRot }, [lavaRot])
  useEffect(() => { lavaOrbitRef.current = lavaOrbit }, [lavaOrbit])
  useEffect(() => { transKeyRef.current = transitionKey }, [transitionKey])

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
    const uLava       = gl.getUniformLocation(prog, 'u_lava')
    const uLavaScale  = gl.getUniformLocation(prog, 'u_lavaScale')
    const uLavaCenter = gl.getUniformLocation(prog, 'u_lavaCenter')
    const uLavaRot    = gl.getUniformLocation(prog, 'u_lavaRot')

    // pre-allocate — avoids GC churn at 60 fps
    // pxy / col / siz are packed by ACTIVE index (compact, for shader uniforms)
    // slotPositions is keyed by SLOT index (sparse, for DragHandles consumption)
    const pxy           = new Float32Array(MAX_POINTS * 2)
    const col           = new Float32Array(MAX_POINTS * 3)
    const siz           = new Float32Array(MAX_POINTS)
    const slotPositions = new Float32Array(MAX_POINTS * 2)
    const lavaCenterXY  = new Float32Array(2)   // current lava centre (frame-normalised)

    // Orbit: a ring big enough to always sit outside the [0,1] work field
    // (corner distance is ~0.707) — the centre never enters the gradient.
    const ORBIT_R = 0.82
    const ORBIT_W = 0.25   // rad per (speed-scaled) second → ~25s per lap at 1×

    // ── randomize/preset transition state ── points glide from their previous
    // base position + colour to the new ones, eased over TRANS_MS. Slot-indexed.
    const TRANS_MS = 700
    const fromX = new Float32Array(MAX_POINTS)
    const fromY = new Float32Array(MAX_POINTS)
    const fromR = new Float32Array(MAX_POINTS)
    const fromG = new Float32Array(MAX_POINTS)
    const fromB = new Float32Array(MAX_POINTS)
    const prevX = new Float32Array(MAX_POINTS)
    const prevY = new Float32Array(MAX_POINTS)
    const prevR = new Float32Array(MAX_POINTS)
    const prevG = new Float32Array(MAX_POINTS)
    const prevB = new Float32Array(MAX_POINTS)
    let havePrev = false
    let lastTransKey = transKeyRef.current
    let transStart = -1            // -1 = settled; else performance.now() at start
    let transP = 1                 // eased progress 0..1 (1 = settled on target)
    const easeInOutCubic = (x: number) =>
      x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2

    function resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w   = Math.max(1, Math.floor(canvas.clientWidth  * dpr))
      const h   = Math.max(1, Math.floor(canvas.clientHeight * dpr))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h
        gl!.viewport(0, 0, w, h)
      }
    }

    // Time accumulator — increments only while animating, so pause truly freezes.
    let t = 0
    let lastMs = performance.now()
    // Drift intensity smoothly fades to 0 on pause (so blobs settle exactly
    // at slot.x/y with no orbit offset) and back to 1 on resume.
    let driftIntensity = animateRef.current ? 1 : 0
    window.addEventListener('resize', resize)

    // Pack the current points/time into uniforms and draw at backing size
    // (w,h). Shared by the RAF loop and the hi-res export so both render the
    // exact same instant. Reads closure `t`/`driftIntensity` live.
    function drawScene(w: number, h: number) {
      // Walk by SLOT index so animated positions remain stable per slot
      // even when middle slots are disabled. Drag handles read by slot
      // index from slotPositions; shader uniforms are packed compactly
      // by active index (skipping disabled slots).
      pxy.fill(0); col.fill(0); siz.fill(0); slotPositions.fill(0)
      const allPoints = pointsRef.current.slice(0, MAX_POINTS)
      // During a transition, blend each slot's base position + colour from the
      // captured `from` snapshot toward the new target. Size/enabled come from
      // the target so the active set updates immediately.
      const blending = transP < 1
      let activeCount = 0
      for (let slotIdx = 0; slotIdx < allPoints.length; slotIdx++) {
        const p = allPoints[slotIdx]
        const [tr, tg, tb] = hexToRgb01(p.color)
        let bx = p.x, by = p.y, r = tr, g = tg, b = tb
        if (blending) {
          bx = fromX[slotIdx] + (p.x - fromX[slotIdx]) * transP
          by = fromY[slotIdx] + (p.y - fromY[slotIdx]) * transP
          r  = fromR[slotIdx] + (tr  - fromR[slotIdx]) * transP
          g  = fromG[slotIdx] + (tg  - fromG[slotIdx]) * transP
          b  = fromB[slotIdx] + (tb  - fromB[slotIdx]) * transP
        }
        const pos = driftedPosition(bx, by, slotIdx, t, driftIntensity)
        slotPositions[slotIdx*2]   = pos.x
        slotPositions[slotIdx*2+1] = pos.y
        if (p.enabled === false) continue
        pxy[activeCount*2]   = pos.x
        pxy[activeCount*2+1] = pos.y
        col[activeCount*3] = r; col[activeCount*3+1] = g; col[activeCount*3+2] = b
        siz[activeCount] = p.size
        activeCount++
      }

      // mirror slot-indexed positions for external consumers (drag handles)
      if (positionsRef) positionsRef.current = slotPositions

      gl.useProgram(prog)
      gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      gl.enableVertexAttribArray(posLoc)
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

      gl.uniform2f(uRes,   w, h)
      gl.uniform1f(uTime,  t)
      gl.uniform1i(uCount, activeCount)
      gl.uniform2fv(uPts,  pxy)
      gl.uniform3fv(uCols, col)
      gl.uniform1fv(uSizes, siz)
      // One Lava knob drives BOTH twist strength and swirl size.
      // Twist: piecewise so 40 ≈ the original look (1.0) while 100 now reaches a
      // doubled 9× churn. Size grows with it (40 → 1.0×, 100 → 2.0×).
      const lv = lavaRef.current
      const lavaTwist = lv <= 40 ? lv / 40 : 1.0 + ((lv - 40) / 60) * 8.0
      const lavaScale = lv <= 40 ? 0.6 + (lv / 40) * 0.4 : 1.0 + ((lv - 40) / 60) * 1.0
      gl.uniform1f(uLava, lavaTwist)
      gl.uniform1f(uLavaScale, lavaScale)                          // 40 → 1.0×, 100 → 2.0×
      // Lava centre: orbit a large outside-the-frame ring, or the static
      // crosshair position. Offset is relative to frame centre (0.5).
      let offX: number, offY: number
      if (lavaOrbitRef.current) {
        const a = t * ORBIT_W
        offX = ORBIT_R * Math.cos(a)
        offY = ORBIT_R * Math.sin(a)
      } else {
        offX = (lavaXRef.current / 100) * 2 - 1                     // 50 → 0 offset
        offY = (lavaYRef.current / 100) * 2 - 1
      }
      gl.uniform2f(uLavaCenter, offX, offY)
      gl.uniform1f(uLavaRot, (lavaRotRef.current * Math.PI) / 180)  // deg → rad
      // mirror the centre (frame-normalised) for the crosshair to follow
      lavaCenterXY[0] = 0.5 + offX
      lavaCenterXY[1] = 0.5 + offY
      if (lavaCenterRef) lavaCenterRef.current = lavaCenterXY

      gl.drawArrays(gl.TRIANGLES, 0, 6)
    }

    const frame = () => {
      resize()

      const now = performance.now()
      // Speed slider scales the time delta. Piecewise so 50 ≈ 1.0× (default)
      // while 100 reaches a much faster 4× (0 = frozen).
      const sp = speedRef.current
      const speedFactor = sp <= 50 ? sp / 50 : 1.0 + ((sp - 50) / 50) * 3.0
      if (animateRef.current) t += ((now - lastMs) / 1000) * speedFactor
      lastMs = now

      // Smooth fade toward target intensity (~0.2s transition)
      const target = animateRef.current ? 1 : 0
      driftIntensity += (target - driftIntensity) * 0.12
      if (Math.abs(driftIntensity - target) < 0.001) driftIntensity = target

      // ── transition bookkeeping ── a new transitionKey means randomize/preset
      // fired: capture the previous frame's target as the `from` snapshot and
      // ease toward the new target (already in pointsRef).
      const key = transKeyRef.current
      if (havePrev && key !== lastTransKey) {
        fromX.set(prevX); fromY.set(prevY)
        fromR.set(prevR); fromG.set(prevG); fromB.set(prevB)
        transStart = now
      }
      lastTransKey = key
      if (transStart >= 0) {
        const raw = Math.min(1, (now - transStart) / TRANS_MS)
        transP = easeInOutCubic(raw)
        if (raw >= 1) { transP = 1; transStart = -1 }
      } else {
        transP = 1
      }

      drawScene(canvas.width, canvas.height)

      // Remember this frame's target as the previous for next-frame `from` capture.
      const pts = pointsRef.current
      for (let i = 0; i < MAX_POINTS; i++) {
        const p = pts[i]
        if (!p) { prevX[i] = 0; prevY[i] = 0; prevR[i] = prevG[i] = prevB[i] = 0; continue }
        prevX[i] = p.x; prevY[i] = p.y
        const [r, g, b] = hexToRgb01(p.color)
        prevR[i] = r; prevG[i] = g; prevB[i] = b
      }
      havePrev = true

      rafRef.current = requestAnimationFrame(frame)
    }

    // Hi-res PNG export: render one frame at the requested size (capped to
    // the GPU's renderbuffer limit), capture, then restore the display size.
    if (exportRef) {
      exportRef.current = (targetW: number, targetH: number) => {
        const maxDim = (gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number) || 4096
        const cap    = Math.min(4096, maxDim)
        const scale  = Math.min(1, cap / Math.max(targetW, targetH))
        const w = Math.max(1, Math.round(targetW * scale))
        const h = Math.max(1, Math.round(targetH * scale))
        const savedW = canvas.width, savedH = canvas.height
        canvas.width = w; canvas.height = h
        gl.viewport(0, 0, w, h)
        drawScene(w, h)
        const url = canvas.toDataURL('image/png')   // preserveDrawingBuffer = true
        // Restore display size and redraw so the visible canvas isn't left hi-res.
        canvas.width = savedW; canvas.height = savedH
        gl.viewport(0, 0, savedW, savedH)
        drawScene(savedW, savedH)
        return url
      }
    }

    rafRef.current = requestAnimationFrame(frame)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', resize)
      if (exportRef) exportRef.current = null
      gl.deleteProgram(prog)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      gl.deleteBuffer(buf)
    }
  }, []) // runs once — points are read via ref

  return <canvas ref={canvasRef} className={className} />
}
