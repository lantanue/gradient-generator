/* Brand-color combos.
 * Each preset has 5 slots. Each slot picks a brand color via `colorIndex`
 * (0 = Yellow, 1 = Orange, 2 = Cyan, 3 = Blue, 4 = White). Colors can
 * repeat — e.g. a sunny preset can use [Yellow, Yellow, Orange, Yellow, White].
 * weight = 0 means that slot is inactive (skip it). */

export type PresetSlot = {
  colorIndex: number
  x: number
  y: number
  weight: number
}

export type Preset = {
  id: string
  name: string
  slots: [PresetSlot, PresetSlot, PresetSlot, PresetSlot, PresetSlot]
}

export const PRESETS: Preset[] = [
  {
    id: 'sunrise',
    name: 'Sunrise',
    slots: [
      { colorIndex: 0, x: 0.20, y: 0.30, weight: 78 },
      { colorIndex: 1, x: 0.72, y: 0.20, weight: 62 },
      { colorIndex: 0, x: 0.50, y: 0.55, weight: 35 },
      { colorIndex: 3, x: 0.85, y: 0.78, weight: 22 },
      { colorIndex: 4, x: 0.18, y: 0.78, weight: 38 },
    ],
  },
  {
    id: 'sunset',
    name: 'Sunset',
    slots: [
      { colorIndex: 0, x: 0.75, y: 0.18, weight: 55 },
      { colorIndex: 1, x: 0.22, y: 0.55, weight: 84 },
      { colorIndex: 2, x: 0.50, y: 0.50, weight: 18 },
      { colorIndex: 3, x: 0.82, y: 0.75, weight: 42 },
      { colorIndex: 4, x: 0.50, y: 0.50, weight: 0  },
    ],
  },
  {
    id: 'ocean',
    name: 'Ocean',
    slots: [
      { colorIndex: 2, x: 0.20, y: 0.30, weight: 70 },
      { colorIndex: 3, x: 0.78, y: 0.72, weight: 86 },
      { colorIndex: 2, x: 0.50, y: 0.78, weight: 40 },
      { colorIndex: 3, x: 0.82, y: 0.22, weight: 30 },
      { colorIndex: 4, x: 0.40, y: 0.40, weight: 28 },
    ],
  },
  {
    id: 'sky',
    name: 'Sky',
    slots: [
      { colorIndex: 3, x: 0.78, y: 0.30, weight: 70 },
      { colorIndex: 4, x: 0.50, y: 0.18, weight: 56 },
      { colorIndex: 2, x: 0.25, y: 0.70, weight: 48 },
      { colorIndex: 3, x: 0.20, y: 0.30, weight: 32 },
      { colorIndex: 4, x: 0.80, y: 0.80, weight: 38 },
    ],
  },
  {
    id: 'citrus',
    name: 'Citrus',
    slots: [
      { colorIndex: 0, x: 0.22, y: 0.25, weight: 80 },
      { colorIndex: 1, x: 0.78, y: 0.72, weight: 78 },
      { colorIndex: 0, x: 0.55, y: 0.20, weight: 35 },
      { colorIndex: 1, x: 0.18, y: 0.80, weight: 38 },
      { colorIndex: 4, x: 0.85, y: 0.30, weight: 26 },
    ],
  },
  {
    id: 'frost',
    name: 'Frost',
    slots: [
      { colorIndex: 2, x: 0.30, y: 0.30, weight: 72 },
      { colorIndex: 3, x: 0.78, y: 0.40, weight: 64 },
      { colorIndex: 4, x: 0.20, y: 0.78, weight: 50 },
      { colorIndex: 2, x: 0.75, y: 0.78, weight: 38 },
      { colorIndex: 4, x: 0.50, y: 0.20, weight: 32 },
    ],
  },
  {
    id: 'spectrum',
    name: 'Spectrum',
    slots: [
      { colorIndex: 0, x: 0.18, y: 0.22, weight: 58 },
      { colorIndex: 1, x: 0.20, y: 0.78, weight: 58 },
      { colorIndex: 2, x: 0.82, y: 0.22, weight: 58 },
      { colorIndex: 3, x: 0.80, y: 0.80, weight: 58 },
      { colorIndex: 4, x: 0.50, y: 0.50, weight: 30 },
    ],
  },
  {
    id: 'bolt',
    name: 'Bolt',
    slots: [
      { colorIndex: 0, x: 0.25, y: 0.22, weight: 72 },
      { colorIndex: 3, x: 0.78, y: 0.74, weight: 82 },
      { colorIndex: 0, x: 0.78, y: 0.22, weight: 32 },
      { colorIndex: 3, x: 0.30, y: 0.78, weight: 30 },
      { colorIndex: 4, x: 0.50, y: 0.50, weight: 18 },
    ],
  },
  {
    id: 'mango',
    name: 'Mango',
    slots: [
      { colorIndex: 0, x: 0.20, y: 0.30, weight: 82 },
      { colorIndex: 0, x: 0.72, y: 0.25, weight: 64 },
      { colorIndex: 1, x: 0.55, y: 0.65, weight: 88 },
      { colorIndex: 0, x: 0.18, y: 0.78, weight: 48 },
      { colorIndex: 4, x: 0.85, y: 0.80, weight: 30 },
    ],
  },
  {
    id: 'parade',
    name: 'Parade',
    slots: [
      { colorIndex: 0, x: 0.15, y: 0.55, weight: 70 },
      { colorIndex: 1, x: 0.40, y: 0.25, weight: 70 },
      { colorIndex: 2, x: 0.65, y: 0.70, weight: 70 },
      { colorIndex: 3, x: 0.88, y: 0.40, weight: 70 },
      { colorIndex: 4, x: 0.50, y: 0.50, weight: 28 },
    ],
  },
  {
    id: 'lagoon',
    name: 'Lagoon',
    slots: [
      { colorIndex: 2, x: 0.18, y: 0.30, weight: 78 },
      { colorIndex: 2, x: 0.78, y: 0.40, weight: 60 },
      { colorIndex: 3, x: 0.50, y: 0.75, weight: 72 },
      { colorIndex: 4, x: 0.25, y: 0.80, weight: 42 },
      { colorIndex: 2, x: 0.70, y: 0.18, weight: 36 },
    ],
  },
  {
    id: 'butter',
    name: 'Butter',
    slots: [
      { colorIndex: 0, x: 0.30, y: 0.30, weight: 88 },
      { colorIndex: 4, x: 0.78, y: 0.25, weight: 56 },
      { colorIndex: 0, x: 0.20, y: 0.78, weight: 60 },
      { colorIndex: 0, x: 0.80, y: 0.75, weight: 50 },
      { colorIndex: 4, x: 0.50, y: 0.50, weight: 30 },
    ],
  },
]
