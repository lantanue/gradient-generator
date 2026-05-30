# Gradient Generator — guide for Claude

A designer tool that generates **brand mesh gradients** on WebGL. Read this before touching the renderer or the UI.

## What this is

Single-screen React app. There are exactly **5 fixed brand colors**, each with a weight slider. The user adjusts weights; positions are managed by Randomize and Presets (not user-editable). A fragment shader renders the gradient — smooth flowing color regions blended in OKLab and gently distorted by a low-frequency warp + per-point lens. Output looks like Figma/Adobe mesh gradient — **not** like clouds, smoke, or noise.

## Architecture

- **`src/App.tsx`** — single screen.
  - State: `slots: Slot[]` (always 5 entries, indexed by brand color), `animate: boolean`, `galleryOpen`, `activePresetId`.
  - Color panel: 5 rows, each is one brand color with a weight slider (0–100) and a live share % (`weight / sum(weights) * 100`).
  - Toolbar: **Randomize** (new combo: positions + weights) + **Pause/Animate** toggle.
  - Top bar: **Presets** (modal), **Copy CSS**, **Export** (PNG).
  - **No** add/remove buttons. **No** hex inputs. **No** count display. The 5-color set is the entire palette by design — do not add UI to expand it.
- **`src/components/MeshCanvas.tsx`** — WebGL 1.0 + fragment shader. Pipeline:
  1. `gentleWarp(uv, t)` — low-frequency sine displacement (smooth curves)
  2. `lensWarp(uv, asp)` — per-point Gaussian attraction (the "magnifying glass" feel)
  3. IDW Gaussian blend in **OKLab** — accumulate `oklab(color_i) * exp(-d²/2σ²)`, normalize, convert back to sRGB
  4. Chroma boost (`lab.yz *= 1.55`) — keep colors vivid after averaging
  5. Subtle vignette
- **`src/brand.ts`** — the locked palette. `BRAND_PALETTE` is `[{color, name}, ...]` × 5: Yellow `#FFBC25`, Orange `#FF773D`, Cyan `#3CBBCE`, Blue `#405FF5`, White `#FFFFFF`. **Do not duplicate these hex codes elsewhere.**
- **`src/presets.ts`** — 10 curated brand combos. Each preset has `slots: [{x, y, weight}] × 5` in the same fixed order as `BRAND_PALETTE`. A `weight: 0` means that brand color is absent from that combo.
- **`src/styles.css`** — Tailwind v4 import + `@theme` block with shadcn-style design tokens + custom range-slider styles.
- **`src/components/WaveCanvas.tsx`** — legacy Canvas 2D renderer. Historical reference only, not imported.

## Data flow

```
Slot[5] (state)
   │
   ▼
slotsToMeshPoints()  ──►  MeshPoint[]  ──►  MeshCanvas (WebGL uniforms)
   │                                              │
   └─► slotsToCss() (CSS export)                  └─► canvas.toDataURL (PNG export)
```

`Slot { x, y, weight }` maps to `MeshPoint { id, color, x, y, size: weight/100, enabled: weight > 0 }`. The brand color comes from `BRAND_PALETTE[index].color` — slot index = palette index.

## Conventions and constraints

### Styling
- **Tailwind v4** with `@tailwindcss/vite`. Configure tokens in `@theme` in `styles.css`, not in a separate `tailwind.config.js`.
- Use shadcn-style token classes (`bg-card`, `border-border`, `text-foreground`, `text-muted-foreground`) — do not hardcode RGB values in JSX.
- Brand colors in JSX must come from `BRAND_PALETTE[i].color`, never inlined hex.

### Color blending (shader)
- **Always blend in OKLab.** RGB blending of complementary colors (orange + cyan) produces muddy grays. OKLab keeps perceptual character.
- After blending, boost chroma in OKLab a/b channels (×1.55). Averaging desaturates.

### What NOT to add to the shader
Previously fBm/Perlin domain warp + film grain + brightness ripple were used. They produce cloud/smoke — exactly what the brief rejects. See commit `ab1a6fa` for the old noise-heavy version that was replaced.

Do not reintroduce: `fbm()`, `noise()`, per-pixel film grain, fBm-driven brightness ripple, or aggressive domain warp (amplitude > ~0.05).

If 8-bit banding appears on slow gradients, add **only** a tiny hash-based dither: `(hash21(gl_FragCoord.xy) - 0.5) * 0.003`. No more.

### What NOT to add to the UI
- No add/remove color buttons. The palette is the 5 brand colors, period.
- No hex inputs. Users edit weights, not colors.
- No on/off toggles or count displays. Weight = 0 already disables a color.
- No drag handles on the canvas. Positions are code-driven (presets and Randomize).

### Sizing
The `weight` field (0..100) maps to Gaussian σ via `size = weight / 100`, then σ = `mix(0.18, 0.34, size)` in both `lensWarp` (radius `r0`) and the IDW blend. Keep these in sync — they share the same envelope.

### Animation
- Driven by `u_time` uniform, multiplied by an `animate ? 1 : 0` factor in JS. When paused, time freezes (sines still curve the image — intentional, gives static frames visual interest).
- Control point drift: Lissajous with `f = 0.018 + i * 0.004`, amplitude `DRIFT = 0.06`. Slow breathing; one cycle ~30–60s.
- Toggle via `animate` prop on `<MeshCanvas>`, kept in `animateRef` so the RAF loop reads current state without restarting.

### Randomize
`randomCombo()` picks 3–5 active brand colors at random (so combos vary), assigns each an x/y in `[0.12, 0.88]`, and a weight in `[28, 90]`. Inactive slots get `weight: 0`. The result feels like a fresh "combo" each click, not a small perturbation.

### Export
- PNG: `canvas.toDataURL('image/png')`. WebGL context uses `preserveDrawingBuffer: true`.
- CSS: stack of `radial-gradient(circle at X% Y%, color 0%, transparent R%)` for slots with `weight > 0`. Approximate — does not match canvas output exactly (no warp, no OKLab). That's accepted.

## Adding a preset

Append to `PRESETS` in `src/presets.ts`. The shape:

```ts
{
  id: 'unique-slug',
  name: 'Display Name',
  slots: [
    { x: 0.20, y: 0.30, weight: 70 },  // Yellow
    { x: 0.75, y: 0.20, weight: 45 },  // Orange
    { x: 0.50, y: 0.50, weight: 0  },  // Cyan (absent)
    { x: 0.78, y: 0.78, weight: 60 },  // Blue
    { x: 0.50, y: 0.50, weight: 20 },  // White
  ],
}
```

Order is fixed: Yellow, Orange, Cyan, Blue, White. Use `weight: 0` (and any x/y) for colors absent from the combo.

## Verify changes

```bash
npm run dev
```

Visual checklist (open localhost:5173):

- [ ] 5 fixed color rows, each with name + slider + share %
- [ ] No add/remove/count visible
- [ ] Moving a slider updates the gradient in real time and recomputes all share percentages
- [ ] Setting a weight to 0 removes that color entirely from the gradient
- [ ] Randomize generates a clearly different combo each click (different active colors, different positions)
- [ ] Presets gallery shows 10 brand combos; clicking one applies it
- [ ] Pause/Animate toggle works; paused frame is rock-steady
- [ ] No film-grain shimmer, no cloud texture
- [ ] Resize the window — no artifacts

If a low-weight color looks "spotty" instead of subtle, the σ envelope (`mix(0.18, 0.34, size)`) might need widening to `mix(0.20, 0.38, size)` in both `lensWarp` and the IDW loop.

## Stack

React 19 · TypeScript · Vite · **Tailwind v4** · WebGL 1.0. No state management library, no router, no UI component library (we use shadcn-style design tokens directly through Tailwind utilities).
