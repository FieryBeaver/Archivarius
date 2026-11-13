import { create } from 'zustand'
import * as db from '../lib/db'
import type { Page, PageKind } from '../lib/types'
import { ancestorIds, childrenOf, positionBetween } from './pageTree'

type Status = 'idle' | 'loading' | 'ready' | 'error'

interface PagesState {
  projectId: string | null
  pages: Page[]
  status: Status
  error: string | null
  /** Expanded tree nodes, keyed by page id. */
  expanded: Record<string, boolean>

  load(projectId: string): Promise<void>
  create(parentId: string | null, kind: PageKind): Promise<Page>
  /** Optimistic update; reverts and rethrows on failure. */
  update(id: string, attrs: Partial<Page>): Promise<void>
  /** Local-only patch, for state already persisted elsewhere (e.g. editor autosave). */
  patchLocal(id: string, attrs: Partial<Page>): void
  remove(id: string): Promise<void>
  toggle(id: string, open?: boolean): void
  expandTo(id: string): void
}

export const usePages = create<PagesState>((set, get) => ({
  projectId: null,
  pages: [],
  status: 'idle',
  error: null,
  expanded: {},

  async load(projectId) {
    if (get().projectId !== projectId) {
      set({ projectId, pages: [], expanded: {}, status: 'loading', error: null })
    }
    try {
      const pages = await db.listPages(projectId)
      if (get().projectId === projectId) set({ pages, status: 'ready' })
    } catch (e) {
      if (get().projectId === projectId) set({ status: 'error', error: (e as Error).message })
    }
  },

  async create(parentId, kind) {
    const projectId = get().projectId
    if (!projectId) throw new Error('no project loaded')
    const siblings = childrenOf(get().pages, parentId)
    const page = await db.createPage(projectId, {
      parent_id: parentId,
      kind,
      position: positionBetween(siblings.at(-1)),
    })
    set((s) => ({
      pages: [...s.pages, page],
      expanded: parentId ? { ...s.expanded, [parentId]: true } : s.expanded,
    }))
    return page
  },

  async update(id, attrs) {
    const prev = get().pages.find((p) => p.id === id)
    if (!prev) return
    get().patchLocal(id, attrs)
    try {
      await db.updatePage(id, attrs)
    } catch (e) {
      get().patchLocal(id, prev)
      throw e
    }
  },

  patchLocal(id, attrs) {
    set((s) => ({ pages: s.pages.map((p) => (p.id === id ? { ...p, ...attrs } : p)) }))
  },

  async remove(id) {
    await db.deletePage(id)
    // Children are removed by ON DELETE CASCADE; reload to mirror that.
    const projectId = get().projectId
    if (projectId) await get().load(projectId)
  },

  toggle(id, open) {
    set((s) => ({ expanded: { ...s.expanded, [id]: open ?? !s.expanded[id] } }))
  },

  expandTo(id) {
    const ids = ancestorIds(get().pages, id)
    if (ids.every((a) => get().expanded[a])) return
    set((s) => ({ expanded: { ...s.expanded, ...Object.fromEntries(ids.map((a) => [a, true])) } }))
  },
}))

export function pagePath(projectId: string, pageId: string): string {
  return `/project/${projectId}/page/${pageId}`
}
