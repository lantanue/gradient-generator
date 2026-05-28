export type PresetPoint = {
  color: string
  x: number
  y: number
  size: number
}

export type Preset = {
  id: string
  name: string
  points: PresetPoint[]
}

export const PRESETS: Preset[] = [
  {
    id: 'aurora',
    name: 'Aurora',
    points: [
      { color: '#FC817E', x: 0.15, y: 0.70, size: 0.65 },
      { color: '#77EAB5', x: 0.75, y: 0.15, size: 0.70 },
      { color: '#BEFFC3', x: 0.50, y: 0.55, size: 0.55 },
      { color: '#E9FED1', x: 0.05, y: 0.20, size: 0.60 },
      { color: '#A5E9FF', x: 0.88, y: 0.72, size: 0.58 },
    ],
  },
  {
    id: 'ocean',
    name: 'Ocean',
    points: [
      { color: '#C51EFF', x: 0.15, y: 0.70, size: 0.60 },
      { color: '#56AEF9', x: 0.82, y: 0.18, size: 0.72 },
      { color: '#F3CAF7', x: 0.40, y: 0.40, size: 0.50 },
      { color: '#6482DC', x: 0.08, y: 0.30, size: 0.58 },
      { color: '#00159A', x: 0.88, y: 0.80, size: 0.65 },
    ],
  },
  {
    id: 'sunset',
    name: 'Sunset',
    points: [
      { color: '#FF5E4D', x: 0.10, y: 0.60, size: 0.68 },
      { color: '#FFC371', x: 0.50, y: 0.18, size: 0.72 },
      { color: '#FF5291', x: 0.85, y: 0.38, size: 0.60 },
      { color: '#FF9348', x: 0.30, y: 0.80, size: 0.65 },
      { color: '#B43278', x: 0.70, y: 0.74, size: 0.55 },
    ],
  },
  {
    id: 'mint',
    name: 'Mint',
    points: [
      { color: '#64DCB4', x: 0.20, y: 0.28, size: 0.65 },
      { color: '#3CBEA0', x: 0.70, y: 0.60, size: 0.70 },
      { color: '#AAF0C8', x: 0.50, y: 0.85, size: 0.55 },
      { color: '#C8FFE6', x: 0.85, y: 0.14, size: 0.60 },
      { color: '#1EA078', x: 0.10, y: 0.70, size: 0.62 },
    ],
  },
  {
    id: 'lavender',
    name: 'Lavender',
    points: [
      { color: '#BE96FF', x: 0.25, y: 0.25, size: 0.68 },
      { color: '#8C64DC', x: 0.70, y: 0.65, size: 0.72 },
      { color: '#DCC8FF', x: 0.50, y: 0.50, size: 0.55 },
      { color: '#643CC8', x: 0.10, y: 0.75, size: 0.60 },
      { color: '#E6BEFF', x: 0.90, y: 0.20, size: 0.58 },
    ],
  },
  {
    id: 'cotton',
    name: 'Cotton Candy',
    points: [
      { color: '#FFB6DA', x: 0.20, y: 0.30, size: 0.65 },
      { color: '#AED6FF', x: 0.75, y: 0.20, size: 0.70 },
      { color: '#FFDAE9', x: 0.50, y: 0.65, size: 0.55 },
      { color: '#D2BEFF', x: 0.10, y: 0.70, size: 0.60 },
      { color: '#B4E6FF', x: 0.88, y: 0.75, size: 0.58 },
    ],
  },
  {
    id: 'golden',
    name: 'Golden Hour',
    points: [
      { color: '#FFD700', x: 0.15, y: 0.50, size: 0.68 },
      { color: '#FFA500', x: 0.75, y: 0.28, size: 0.72 },
      { color: '#FFBE32', x: 0.50, y: 0.75, size: 0.58 },
      { color: '#FFC850', x: 0.85, y: 0.70, size: 0.60 },
      { color: '#FF8C00', x: 0.10, y: 0.20, size: 0.65 },
    ],
  },
  {
    id: 'crimson',
    name: 'Crimson',
    points: [
      { color: '#C8143C', x: 0.20, y: 0.40, size: 0.68 },
      { color: '#FF5064', x: 0.75, y: 0.60, size: 0.72 },
      { color: '#B40028', x: 0.50, y: 0.18, size: 0.58 },
      { color: '#FF7882', x: 0.10, y: 0.75, size: 0.62 },
      { color: '#DC3250', x: 0.88, y: 0.20, size: 0.60 },
    ],
  },
  {
    id: 'electric',
    name: 'Electric',
    points: [
      { color: '#00C8FF', x: 0.15, y: 0.40, size: 0.65 },
      { color: '#B400FF', x: 0.80, y: 0.28, size: 0.70 },
      { color: '#00FFC8', x: 0.50, y: 0.70, size: 0.58 },
      { color: '#6400FF', x: 0.30, y: 0.14, size: 0.62 },
      { color: '#FF00B4', x: 0.75, y: 0.80, size: 0.60 },
    ],
  },
  {
    id: 'forest',
    name: 'Forest',
    points: [
      { color: '#1E783C', x: 0.15, y: 0.20, size: 0.65 },
      { color: '#50B450', x: 0.70, y: 0.50, size: 0.70 },
      { color: '#326428', x: 0.40, y: 0.75, size: 0.58 },
      { color: '#78C864', x: 0.85, y: 0.15, size: 0.60 },
      { color: '#3CA046', x: 0.25, y: 0.60, size: 0.62 },
    ],
  },
  {
    id: 'midnight',
    name: 'Midnight',
    points: [
      { color: '#141E64', x: 0.20, y: 0.30, size: 0.68 },
      { color: '#3250B4', x: 0.75, y: 0.65, size: 0.72 },
      { color: '#1E3296', x: 0.50, y: 0.50, size: 0.58 },
      { color: '#0A1450', x: 0.10, y: 0.70, size: 0.62 },
      { color: '#5078DC', x: 0.88, y: 0.20, size: 0.60 },
    ],
  },
  {
    id: 'peach',
    name: 'Peach Fuzz',
    points: [
      { color: '#FFB482', x: 0.20, y: 0.60, size: 0.68 },
      { color: '#FFD2A0', x: 0.75, y: 0.25, size: 0.72 },
      { color: '#FF9664', x: 0.50, y: 0.80, size: 0.58 },
      { color: '#FFC896', x: 0.85, y: 0.70, size: 0.62 },
      { color: '#F0A06E', x: 0.10, y: 0.20, size: 0.60 },
    ],
  },
]
