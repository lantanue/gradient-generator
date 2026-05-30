# Gradient Generator

Designer tool for crafting **brand mesh gradients** — smooth flowing color regions with gentle lens-like distortions, in the spirit of Figma/Adobe mesh gradients. Renders on WebGL with blending in the perceptually-uniform OKLab color space, so complementary colors meet cleanly instead of turning to mud.

## Brand palette

The locked brand identity (source of truth: [`src/brand.ts`](src/brand.ts)):

| Hex       | Name   |
| --------- | ------ |
| `#FFBC25` | Yellow |
| `#FF773D` | Orange |
| `#3CBBCE` | Cyan   |
| `#405FF5` | Blue   |
| `#FFFFFF` | White  |

These five colors are the entire palette. The control panel exposes one slider per color (its **weight**); the display shows each color's share as a percentage of the total weight. There are no add/remove buttons and no hex inputs — the palette is fixed by design.

## Features

- 5 brand color slots with weight sliders; share % is computed live
- Inverse-distance blending in **OKLab** + chroma boost (no muddy mid-tones)
- Smooth low-frequency global warp + per-point lens distortion — gentle "magnifying glass" curves, no cloud-like texture
- Optional slow breathing animation (Pause/Animate toggle)
- 10 brand-color combos as presets
- **Randomize** generates a new combo (random positions + random weight distribution across 3–5 active colors)
- Export as PNG or copy as CSS `radial-gradient` layers

## Development

```bash
npm install
npm run dev      # Vite dev server, http://localhost:5173
npm run build    # production build to dist/
npm run preview  # preview the built bundle
```

Stack: React 19 · TypeScript · Vite · Tailwind CSS v4 (with shadcn-style design tokens) · WebGL 1.0 fragment shader.

## Design tokens

Tailwind v4 with shadcn-style CSS variables, declared in [`src/styles.css`](src/styles.css) under `@theme`:

- Surfaces: `--color-background`, `--color-card`, `--color-muted`, `--color-accent`
- Foreground: `--color-foreground`, `--color-muted-foreground`
- Border / input / ring tokens
- Brand colors: `--color-brand-yellow`, `--color-brand-orange`, `--color-brand-cyan`, `--color-brand-blue`, `--color-brand-white`
- Radii (`--radius-sm` through `--radius-2xl`) and font stacks

These tokens are used through Tailwind utility classes (e.g. `bg-card`, `border-border`, `text-foreground`). No hex codes outside `brand.ts` and `styles.css`.

## Project structure

```
src/
├── App.tsx                   UI shell — color panel, toolbar, top bar, preset gallery
├── brand.ts                  Locked 5-color brand palette (single source of truth)
├── presets.ts                10 brand-color combo presets
├── styles.css                Tailwind import + @theme tokens + slider styles
├── components/
│   ├── MeshCanvas.tsx        WebGL renderer + fragment shader (the rendering core)
│   └── WaveCanvas.tsx        Legacy Canvas 2D renderer (unused, kept for reference)
└── main.tsx                  React entry point
```

## Render pipeline (high-level)

1. `gentleWarp` — low-frequency sine displacement of UV (smooth curves, no turbulence)
2. `lensWarp` — each control point pulls nearby UVs toward itself with a Gaussian falloff
3. **IDW blend in OKLab** — Gaussian weight per point, accumulated in OKLab, converted back to sRGB
4. **Chroma boost** in OKLab — keeps colors vivid after weighted averaging
5. **Subtle vignette**

There is intentionally **no** Perlin/fBm noise, no film grain, and no ripple — those produce a cloud/smoke look, which is what we explicitly do not want here.
