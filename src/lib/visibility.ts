import type { Role } from './types'

/**
 * Role gating shared by plugin blocks and page tabs. Client-side only, like
 * secret blocks: the gated data still reaches every member inside the page
 * row. Content players must never receive belongs on a secret page (RLS).
 */
export const VISIBILITIES = ['all', 'editors', 'owners'] as const
export type Visibility = (typeof VISIBILITIES)[number]

export const VISIBILITY_LABELS: Record<Visibility, string> = {
  all: 'Everyone',
  editors: 'Editors & owners',
  owners: 'Owners only',
}

export function asVisibility(v: unknown): Visibility {
  return VISIBILITIES.includes(v as Visibility) ? (v as Visibility) : 'all'
}

export function roleAllows(visibleTo: unknown, role: Role | null): boolean {
  const v = asVisibility(visibleTo)
  if (v === 'owners') return role === 'owner'
  if (v === 'editors') return role === 'owner' || role === 'editor'
  return true
}
