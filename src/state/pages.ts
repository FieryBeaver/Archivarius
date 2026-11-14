import { useMemo } from 'react'
import { create } from 'zustand'
import * as db from '../lib/db'
import type { Page, PageKind, Role } from '../lib/types'
import { ancestorIds, childrenOf, positionBetween } from './pageTree'

type Status = 'idle' | 'loading' | 'ready' | 'error'

interface PagesState {
  projectId: string | null
  pages: Page[]
  status: Status
  error: string | null
  /** Expanded tree nodes, keyed by page id. */
  expanded: Record<string, boolean>
  /** The signed-in user's role in the loaded project (null = unknown / not a member). */
  role: Role | null
  /**
   * Preview role (v0.7): owners/editors can temporarily see the world as a lower
   * role. null = off. Client-side only — it hides what the client knows is
   * role-gated (secret pages/blocks, editing UI); RLS stays the real boundary.
   */
  viewAs: Role | null
  /**
   * v0.7: owners/editors can hide secret & role-gated content while keeping
   * their edit rights (e.g. screensharing with players). Client-side only.
   */
  hideSecrets: boolean

  load(projectId: string): Promise<void>
  setViewAs(role: Role | null): void
  setHideSecrets(hide: boolean): void
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
  role: null,
  viewAs: null,
  hideSecrets: false,

  async load(projectId) {
    if (get().projectId !== projectId) {
      set({
        projectId, pages: [], expanded: {}, role: null, viewAs: null, hideSecrets: false,
        status: 'loading', error: null,
      })
    }
    try {
      const [pages, role] = await Promise.all([
        db.listPages(projectId),
        db.getMyRole(projectId).catch(() => null),
      ])
      if (get().projectId === projectId) set({ pages, role, status: 'ready' })
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

  setViewAs(role) {
    set({ viewAs: role })
  },

  setHideSecrets(hide) {
    set({ hideSecrets: hide })
  },
}))

export function pagePath(projectId: string, pageId: string): string {
  return `/project/${projectId}/page/${pageId}`
}

/** Owners and editors can change content; viewers only read. */
export function canEditRole(role: Role | null): boolean {
  return role === 'owner' || role === 'editor'
}

/** The role every capability check should use: the preview role while previewing. */
export function effectiveRole(s: Pick<PagesState, 'role' | 'viewAs'>): Role | null {
  return s.viewAs ?? s.role
}

/** The effective role in the loaded project (the preview role while previewing). */
export function useRole(): Role | null {
  return usePages(effectiveRole)
}

/** Whether a role preview ("view as player") is active. */
export function useIsPreviewingRole(): boolean {
  return usePages((s) => s.viewAs !== null)
}

/** Whether the signed-in user may edit the loaded project (false while previewing a lower role). */
export function useCanEdit(): boolean {
  return usePages((s) => canEditRole(effectiveRole(s)))
}

/**
 * v0.7: only OWNERS see secrets (LegendKeeper-style GM/player split). Editors
 * edit regular pages — their own PC pages included — without GM visibility.
 * Matches RLS, where secret rows never reach non-owners.
 */
export function canSeeSecretsRole(role: Role | null): boolean {
  return role === 'owner'
}

/**
 * Whether secret pages/content are hidden right now: for every non-owner
 * (mirroring RLS), while previewing a lower role, or while the owner's
 * hide-secrets toggle is on.
 */
export function hidesSecrets(s: Pick<PagesState, 'role' | 'viewAs' | 'hideSecrets'>): boolean {
  return !canSeeSecretsRole(effectiveRole(s)) || s.hideSecrets
}

/**
 * The role content gating should check (plugin block visibility, gated tabs):
 * the effective role, demoted to viewer while secrets are hidden.
 */
export function visibilityRole(s: Pick<PagesState, 'role' | 'viewAs' | 'hideSecrets'>): Role | null {
  return s.hideSecrets ? 'viewer' : effectiveRole(s)
}

/** The loaded pages, minus secret ones while previewing as a viewer. */
export function useVisiblePages(): Page[] {
  const pages = usePages((s) => s.pages)
  const hide = usePages(hidesSecrets)
  return useMemo(() => (hide ? pages.filter((p) => !p.is_secret) : pages), [pages, hide])
}
