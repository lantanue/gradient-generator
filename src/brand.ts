export const BRAND_PALETTE = [
  { color: '#FFBC25', name: 'Yellow' },
  { color: '#FF773D', name: 'Orange' },
  { color: '#3CBBCE', name: 'Cyan'   },
  { color: '#405FF5', name: 'Blue'   },
  { color: '#FFFFFF', name: 'White'  },
] as const

export type BrandColor = typeof BRAND_PALETTE[number]['color']
export type BrandSwatch = typeof BRAND_PALETTE[number]

export const BRAND_COLORS = BRAND_PALETTE.map(b => b.color) as readonly BrandColor[]
