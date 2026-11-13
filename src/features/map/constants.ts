import { KIND_ICONS } from '../../components/pageIcon'
import type { PageKind } from '../../lib/types'

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

/** Kind glyph — single source shared with the tree, mention list and pickers. */
export function kindIcon(kind: PageKind): string {
  return KIND_ICONS[kind] ?? KIND_ICONS.doc
}
