import type { ReactNode } from 'react'
import { DEFAULT_KIND_ICONS, renderIcon } from '../../lib/icons'
import type { PageKind } from '../../lib/types'
import { iconHtml } from './iconHtml'

/** Preset swatches (user-facing data colors, not theme colors). */
export const PRESET_COLORS = [
  '#d4a953',
  '#c0564f',
  '#e08a3c',
  '#7fb069',
  '#4fa3a5',
  '#6fa8dc',
  '#9b7fd1',
  '#d47fa6',
] as const

/** Kind glyph (shared icon system) for React contexts. */
export function kindIcon(kind: PageKind, size = 16): ReactNode {
  return renderIcon(DEFAULT_KIND_ICONS[kind] ?? DEFAULT_KIND_ICONS.doc, { size })
}

/** Kind glyph as an HTML string, for Leaflet/HTML-string contexts. */
export function kindIconHtml(kind: PageKind, size = 16): string {
  return iconHtml(DEFAULT_KIND_ICONS[kind] ?? DEFAULT_KIND_ICONS.doc, size)
}
