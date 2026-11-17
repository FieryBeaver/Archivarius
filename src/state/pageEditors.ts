import { useEffect } from 'react'
import { create } from 'zustand'
import * as db from '../lib/db'
import type { Page } from '../lib/types'
import { useAuth } from './auth'
import { effectiveRole, usePages } from './pages'
import { ancestorIds } from './pageTree'

/** Cache of explicit editors (user ids) per restricted page. */
interface PageEditorsState {
  byPage: Record<string, string[]>
  /** Fetch (or refetch) a page's editor list. Concurrent calls for one page share a request. */
  load(pageId: string): Promise<string[]>
  /** Replace the cached list (after the owner edits it). */
  set(pageId: string, userIds: string[]): void
}

const inflight = new Map<string, Promise<string[]>>()

export const usePageEditors = create<PageEditorsState>((set) => ({
  byPage: {},

  load(pageId) {
    const pending = inflight.get(pageId)
    if (pending) return pending
    const req = db.listPageEditors(pageId)
      .catch(() => [] as string[])
      .then((ids) => {
        set((s) => ({ byPage: { ...s.byPage, [pageId]: ids } }))
        return ids
      })
      .finally(() => inflight.delete(pageId))
    inflight.set(pageId, req)
    return req
  },

  set(pageId, userIds) {
    set((s) => ({ byPage: { ...s.byPage, [pageId]: userIds } }))
  },
}))

/** "id,parentId,grandparentId,…" for a page in the loaded tree ('' when none). A string so selectors stay stable. */
function chainKeyOf(pages: Page[], pageId: string | undefined): string {
  return pageId ? [pageId, ...ancestorIds(pages, pageId)].join(',') : ''
}

/**
 * Whether the signed-in user may edit this page (client mirror of can_edit_page):
 * owner ⇒ true; viewer ⇒ false; editor ⇒ all of
 *   - secret page: they created it, or hold a grant on it;
 *   - edit_access 'inherit', or they hold a grant on it;
 *   - v0.10 edit-own-only custom role: they created it, or hold a grant on it.
 * "Grant" = listed in page_editors for this page OR ANY ANCESTOR (v0.10 subtree grants).
 *
 * Hook discipline: the same six hooks run on every render, in the same order;
 * all branching happens in plain expressions or inside the effect.
 */
export function useCanEditPage(
  page: Pick<Page, 'id' | 'edit_access' | 'created_by' | 'is_secret'> | undefined,
): boolean {
  const pageId = page?.id
  const role = usePages(effectiveRole)
  // Only the user's real role carries the custom-role capability; a preview
  // role ("view as …") never does.
  const editOwnOnly = usePages((s) => s.editOwnOnly && s.viewAs === null)
  const chainKey = usePages((s) => chainKeyOf(s.pages, pageId))
  const userId = useAuth((s) => s.session?.user.id)
  const granted = usePageEditors((s) =>
    !!userId && chainKey !== '' && chainKey.split(',').some((id) => !!s.byPage[id]?.includes(userId)))

  const restricted = page?.edit_access === 'restricted'
  const mine = !!userId && page?.created_by === userId
  const needsList = role === 'editor' && chainKey !== ''
    && (restricted || (!!page?.is_secret && !mine) || (editOwnOnly && !mine))
  useEffect(() => {
    if (!needsList) return
    const { byPage, load } = usePageEditors.getState()
    chainKey.split(',').forEach((id, i) => {
      // Always refresh the page's own list; ancestors only when not cached yet.
      if (i === 0 || !(id in byPage)) void load(id)
    })
  }, [needsList, chainKey])

  if (!page) return false
  if (role === 'owner') return true
  if (role !== 'editor') return false
  if (page.is_secret && !mine && !granted) return false
  if (restricted && !granted) return false
  if (editOwnOnly && !mine && !granted) return false
  return true
}
