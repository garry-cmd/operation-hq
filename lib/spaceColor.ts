import type { Space } from '@/lib/types'

/**
 * Interim space display colors for the Home deck's "color = space" model.
 *
 * The stored `space.color` values are muted/dark (three near-identical blues
 * plus Keeply's near-black #0B1E3F) — fine as accent tints but not legible or
 * distinct as status dots on the dark Home board. This maps the five known
 * spaces to distinct, legible object-palette hues, with a palette-by-sort_order
 * fallback for any space added later.
 *
 * This is deliberately local and additive — it does NOT touch globals.css or the
 * DB. The post-deck global color pass supersedes it; when real display colors
 * land on `spaces`, delete this map and read the column directly.
 */

// Object palette (legible on dark). Fallback order for unknown spaces.
const PALETTE = ['#5b8def', '#14b87f', '#c8a040', '#c44a7c', '#0ea5b8', '#8b5cf6', '#d4885a', '#6b8caa']

// Known spaces → object-palette display hues (matches the approved mockup).
const DISPLAY_BY_ID: Record<string, string> = {
  'f7f2fdd9-bbf6-4f30-ac1f-bd06b81d7d99': '#5b8def', // Stellar — blue
  '572f74de-d3bf-4aec-831b-c8c2dfb57225': '#c8a040', // VidScrip — gold
  '535fb6bd-9a9e-4cdc-8574-ebf61e43e13d': '#c44a7c', // USPSA — magenta
  'd759151f-8a6c-4c28-9fe1-db303f4ecf3a': '#14b87f', // My OKRs — green
  '39450371-6432-4700-8f15-20fcd9ca2068': '#0ea5b8', // Keeply — teal
}

export function spaceDisplayColor(space: Pick<Space, 'id' | 'sort_order'>): string {
  const known = DISPLAY_BY_ID[space.id]
  if (known) return known
  const i = ((space.sort_order % PALETTE.length) + PALETTE.length) % PALETTE.length
  return PALETTE[i]
}

/** Display color for a space id, given the spaces list. Falls back to a neutral. */
export function spaceDisplayColorById(spaceId: string | null, spaces: Space[]): string {
  if (!spaceId) return 'var(--navy-500)'
  const sp = spaces.find(s => s.id === spaceId)
  return sp ? spaceDisplayColor(sp) : 'var(--navy-500)'
}
