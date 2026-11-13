import type { Page } from '../lib/types'

export interface TreeNode {
  page: Page
  children: TreeNode[]
}

/** A visible row of the tree, in display order. */
export interface FlatNode {
  id: string
  page: Page
  parentId: string | null
  depth: number
  childCount: number
}

const byPosition = (a: Page, b: Page) => a.position - b.position

export function childrenOf(pages: Page[], parentId: string | null): Page[] {
  return pages.filter((p) => p.parent_id === parentId).sort(byPosition)
}

export function buildTree(pages: Page[]): TreeNode[] {
  const ids = new Set(pages.map((p) => p.id))
  const byParent = new Map<string | null, Page[]>()
  for (const p of pages) {
    // Orphans (parent missing from the list) are shown at the root.
    const key = p.parent_id && ids.has(p.parent_id) ? p.parent_id : null
    const list = byParent.get(key) ?? []
    list.push(p)
    byParent.set(key, list)
  }
  const build = (parentId: string | null): TreeNode[] =>
    (byParent.get(parentId) ?? [])
      .sort(byPosition)
      .map((page) => ({ page, children: build(page.id) }))
  return build(null)
}

/** Flatten the tree into visible rows, skipping children of collapsed nodes. */
export function flattenTree(
  nodes: TreeNode[],
  expanded: Record<string, boolean>,
  skipChildrenOf?: string,
  depth = 0,
  parentId: string | null = null,
): FlatNode[] {
  return nodes.flatMap((n) => {
    const row: FlatNode = { id: n.page.id, page: n.page, parentId, depth, childCount: n.children.length }
    const open = expanded[n.page.id] && n.page.id !== skipChildrenOf
    return open ? [row, ...flattenTree(n.children, expanded, skipChildrenOf, depth + 1, n.page.id)] : [row]
  })
}

export function ancestorIds(pages: Page[], id: string): string[] {
  const byId = new Map(pages.map((p) => [p.id, p]))
  const out: string[] = []
  let cur = byId.get(id)?.parent_id ?? null
  while (cur && !out.includes(cur)) {
    out.push(cur)
    cur = byId.get(cur)?.parent_id ?? null
  }
  return out
}

export function descendantIds(pages: Page[], id: string): string[] {
  const out: string[] = []
  const walk = (pid: string) => {
    for (const p of pages) {
      if (p.parent_id === pid) {
        out.push(p.id)
        walk(p.id)
      }
    }
  }
  walk(id)
  return out
}

/** Fractional position for inserting between two siblings (either may be absent). */
export function positionBetween(before?: Page, after?: Page): number {
  if (before && after) return (before.position + after.position) / 2
  if (before) return before.position + 1
  if (after) return after.position - 1
  return 1
}
