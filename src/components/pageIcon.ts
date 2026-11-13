/**
 * @deprecated v0.4 — use `src/lib/icons.tsx` (renderIcon, pageIconOf, PageIcon,
 * DEFAULT_KIND_ICONS). Kept so existing callers don't break; `pageIcon()` now
 * delegates to the shared icon system and returns a ReactNode (renders "gi:"
 * Game Icons as SVG, emoji as text).
 */
import type { ReactNode } from 'react'
import type { Page, PageKind } from '../lib/types'
import { pageIconOf, renderIcon } from '../lib/icons'

/** @deprecated legacy emoji kind glyphs; prefer DEFAULT_KIND_ICONS + renderIcon. */
export const KIND_ICONS: Record<PageKind, string> = {
  doc: '📄',
  map: '🗺',
  timeline: '🕒',
}

export const KIND_LABELS: Record<PageKind, string> = {
  doc: 'Document',
  map: 'Map',
  timeline: 'Timeline',
}

/** @deprecated use `<PageIcon page={...}/>` or `renderIcon(pageIconOf(page))`. */
export function pageIcon(page: Pick<Page, 'kind'> & { icon?: string | null }): ReactNode {
  return renderIcon(pageIconOf({ kind: page.kind, icon: page.icon ?? null }))
}
