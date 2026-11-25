import { useMemo } from 'react'
import { create } from 'zustand'
import * as db from '../lib/db'
import type { Page, PageKind, PageTemplate, Role } from '../lib/types'
import { ancestorIds, childrenOf, positionBetween } from './pageTree'

type Status = 'idle' | 'loading' | 'ready' | 'error'

interface PagesState {
  projectId: string | null
  pages: Page[]
  status: Status
  error: string | null
  /** Expanded tree nodes, keyed by page id. */
  expanded: Record<string, boolean>
  /** The signed-in user's BASE role in the loaded project (null = unknown / not a member). */
  role: Role | null
  /** v0.7: the user's custom-role label, when one is assigned (display + plugins). */
  roleName: string | null
  /**
   * v0.10: the user's custom role is "edit own pages only" — they may write
   * only pages they created or are listed in page_editors for (RLS enforces).
   */
  editOwnOnly: boolean
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
  /** v0.7: with a template, the new page copies its name/icon/content/tabs. */
  create(parentId: string | null, kind: PageKind, template?: PageTemplate, extra?: { title?: string }): Promise<Page>
  /** Optimistic update; reverts and rethrows on failure. */
  update(id: string, attrs: Partial<Page>): Promise<void>
  /** Local-only patch, for state already persisted elsewhere (e.g. editor autosave). */
  patchLocal(id: string, attrs: Partial<Page>): void
  remove(id: string): Promise<void>
  /** Copies the page and its subpages (as a sibling right after it); resolves to the root copy. */
  duplicate(id: string): Promise<Page>
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
  roleName: null,
  editOwnOnly: false,
  viewAs: null,
  hideSecrets: false,

  async load(projectId) {
    if (get().projectId !== projectId) {
      set({
        projectId, pages: [], expanded: {}, role: null, roleName: null, editOwnOnly: false, viewAs: null, hideSecrets: false,
        status: 'loading', error: null,
      })
    }
    try {
      const [pages, membership] = await Promise.all([
        db.listPages(projectId),
        db.getMyMembership(projectId).catch((): db.MyMembership => ({ role: null, roleName: null, editOwnOnly: false })),
      ])
      if (get().projectId === projectId) {
        set({
          pages, role: membership.role, roleName: membership.roleName,
          editOwnOnly: membership.editOwnOnly, status: 'ready',
        })
      }
    } catch (e) {
      if (get().projectId === projectId) set({ status: 'error', error: (e as Error).message })
    }
  },

  async create(parentId, kind, template, extra) {
    const projectId = get().projectId
    if (!projectId) throw new Error('no project loaded')
    const siblings = childrenOf(get().pages, parentId)
    const page = await db.createPage(projectId, {
      parent_id: parentId,
      kind,
      position: positionBetween(siblings.at(-1)),
      ...(template ? {
        title: template.name,
        icon: template.icon,
        content: template.content,
        tabs: template.tabs,
      } : {}),
      // v0.9: e.g. "New subpage from selection" titles the page with the selected text.
      ...(extra?.title ? { title: extra.title } : {}),
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
      // v0.11: a live refresh fetched mid-flight may have put the old values back.
      get().patchLocal(id, attrs)
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

  async duplicate(id) {
    let copies: Page[]
    try {
      copies = await db.duplicatePage(id)
    } catch (e) {
      // the partial copy was rolled back (best-effort): mirror whatever the server has now
      const projectId = get().projectId
      if (projectId) void get().load(projectId)
      throw e
    }
    const root = copies[0]
    set((s) => ({
      pages: [...s.pages.filter((p) => !copies.some((c) => c.id === p.id)), ...copies],
      expanded: root.parent_id ? { ...s.expanded, [root.parent_id]: true } : s.expanded,
    }))
    return root
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
 * v0.7 secrets model (LegendKeeper-style): owners see every secret; an editor
 * sees only secrets THEY created (private to them + the owner); viewers none.
 * Secret PAGES and notes are scoped server-side by RLS, so the loaded page
 * list already matches the signed-in user — client hiding below exists for
 * the owner's preview/hide toggles, and per-creator secret BLOCKS.
 */

/**
 * Whether the owner's "everything secret is hidden" view is on: while
 * previewing as a player or while the hide-secrets toggle is on.
 */
export function hidesSecrets(s: Pick<PagesState, 'viewAs' | 'hideSecrets'>): boolean {
  return s.viewAs === 'viewer' || s.hideSecrets
}

/**
 * Whether the signed-in user may see a secret created by `createdBy`
 * (null = a legacy secret, the owner's). Owners see all; editors their own.
 */
export function canSeeSecret(
  s: Pick<PagesState, 'role' | 'viewAs' | 'hideSecrets'>,
  myUserId: string | undefined,
  createdBy: string | null | undefined,
): boolean {
  if (hidesSecrets(s)) return false
  const role = effectiveRole(s)
  if (role === 'owner') return true
  return role === 'editor' && !!myUserId && createdBy === myUserId
}

/**
 * The role content gating should check (plugin block visibility, gated tabs):
 * the effective role, demoted to viewer while secrets are hidden.
 */
export function visibilityRole(s: Pick<PagesState, 'role' | 'viewAs' | 'hideSecrets'>): Role | null {
  return s.hideSecrets ? 'viewer' : effectiveRole(s)
}

/**
 * v0.10: secrecy is a subtree property — a page is hidden when it or any
 * ancestor is secret (mirrors passes_secret_chain in the DB). Returns, for
 * every effectively-secret page, the page that hides it (itself or the
 * nearest secret ancestor). One pass over the tree.
 */
export function secretSources(pages: Page[]): Map<string, Page> {
  const byId = new Map(pages.map((p) => [p.id, p]))
  const memo = new Map<string, Page | null>()
  const resolve = (p: Page, depth: number): Page | null => {
    const known = memo.get(p.id)
    if (known !== undefined) return known
    memo.set(p.id, null) // cycle guard
    const parent = p.parent_id ? byId.get(p.parent_id) : undefined
    const src = p.is_secret ? p : parent && depth < 50 ? resolve(parent, depth + 1) : null
    memo.set(p.id, src)
    return src
  }
  const out = new Map<string, Page>()
  for (const p of pages) {
    const src = resolve(p, 0)
    if (src) out.set(p.id, src)
  }
  return out
}

/** The nearest secret ANCESTOR (not the page itself) hiding this page, if any. */
export function secretAncestorOf(pages: Page[], pageId: string): Page | undefined {
  const byId = new Map(pages.map((p) => [p.id, p]))
  const seen = new Set<string>()
  let cur = byId.get(pageId)?.parent_id
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    const p = byId.get(cur)
    if (!p) return undefined
    if (p.is_secret) return p
    cur = p.parent_id
  }
  return undefined
}

/**
 * Title of the secret ancestor that hides this page (inherited secrecy), or
 * null when no ancestor is secret. The page's own flag is not considered.
 */
export function useHiddenVia(pageId: string | null | undefined): string | null {
  return usePages((s) => {
    if (!pageId) return null
    const src = secretAncestorOf(s.pages, pageId)
    return src ? src.title || 'Untitled' : null
  })
}

/** The loaded pages, minus effectively-secret ones (self or ancestor) while secrets are hidden. */
export function useVisiblePages(): Page[] {
  const pages = usePages((s) => s.pages)
  const hide = usePages(hidesSecrets)
  return useMemo(() => {
    if (!hide) return pages
    const hidden = secretSources(pages)
    return pages.filter((p) => !hidden.has(p.id))
  }, [pages, hide])
}
