import { arrayMove } from '@dnd-kit/sortable'
import type { Page } from '../../lib/types'
import { childrenOf, positionBetween, type FlatNode } from '../../state/pageTree'

export const INDENT = 16

export interface Projection {
  depth: number
  parentId: string | null
}

/**
 * Where the dragged row would land: horizontal drag offset picks the depth,
 * clamped to what is valid between the rows above and below the drop slot.
 */
export function getProjection(
  rows: FlatNode[],
  activeId: string,
  overId: string,
  offsetX: number,
): Projection | null {
  const activeIndex = rows.findIndex((r) => r.id === activeId)
  const overIndex = rows.findIndex((r) => r.id === overId)
  if (activeIndex < 0 || overIndex < 0) return null

  const moved = arrayMove(rows, activeIndex, overIndex)
  const prev = moved[overIndex - 1]
  const next = moved[overIndex + 1]
  const wanted = rows[activeIndex].depth + Math.round(offsetX / INDENT)
  const maxDepth = prev ? prev.depth + 1 : 0
  const minDepth = next ? next.depth : 0
  const depth = Math.min(Math.max(wanted, minDepth), maxDepth)

  if (depth === 0 || !prev) return { depth: 0, parentId: null }
  if (depth > prev.depth) return { depth, parentId: prev.id }
  if (depth === prev.depth) return { depth, parentId: prev.parentId }
  const ancestor = moved.slice(0, overIndex).reverse().find((r) => r.depth === depth)
  return { depth, parentId: ancestor?.parentId ?? null }
}

/** Fractional position for the dropped page among its new siblings. */
export function dropPosition(
  rows: FlatNode[],
  pages: Page[],
  activeId: string,
  overId: string,
  projection: Projection,
): number {
  const moved = arrayMove(
    rows,
    rows.findIndex((r) => r.id === activeId),
    rows.findIndex((r) => r.id === overId),
  )
  const index = moved.findIndex((r) => r.id === activeId)

  // Nearest visible row above at the same depth is the previous sibling.
  let prevSiblingId: string | undefined
  for (let i = index - 1; i >= 0; i--) {
    if (moved[i].depth < projection.depth) break
    if (moved[i].depth === projection.depth) {
      prevSiblingId = moved[i].id
      break
    }
  }

  // Work against the full sibling list: some siblings may be hidden under a collapsed parent.
  const siblings = childrenOf(pages, projection.parentId).filter((p) => p.id !== activeId)
  const at = prevSiblingId ? siblings.findIndex((p) => p.id === prevSiblingId) + 1 : 0
  return positionBetween(siblings[at - 1], siblings[at])
}
