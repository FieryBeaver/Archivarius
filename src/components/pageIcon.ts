import type { Page, PageKind } from '../lib/types'

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

export function pageIcon(page: Pick<Page, 'kind'> & { icon?: string | null }): string {
  return page.icon || KIND_ICONS[page.kind]
}
