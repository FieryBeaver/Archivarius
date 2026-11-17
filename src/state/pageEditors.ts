import { useEffect } from 'react'
import { create } from 'zustand'
import * as db from '../lib/db'
import type { Page } from '../lib/types'
import { useAuth } from './auth'
import { effectiveRole, usePages } from './pages'

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

/**
 * Whether the signed-in user may edit this page (client mirror of can_edit_page):
 * owner ⇒ true; viewer ⇒ false; editor ⇒
 *   - secret page: only if they created it;
 *   - edit_access 'inherit' or listed in page_editors;
 *   - v0.10, edit-own-only custom role: additionally created it or listed in page_editors.
 * Fetches/refetches the page's editor list whenever the answer depends on it.
 */
export function useCanEditPage(
  page: Pick<Page, 'id' | 'edit_access' | 'created_by' | 'is_secret'> | undefined,
): boolean {
  const role = usePages(effectiveRole)
  // Only the user's real role carries the custom-role capability; a preview
  // role ("view as …") never does.
  const editOwnOnly = usePages((s) => s.editOwnOnly && s.viewAs === null)
  const userId = useAuth((s) => s.session?.user.id)
  const restricted = page?.edit_access === 'restricted'
  const pageId = page?.id
  const mine = !!userId && page?.created_by === userId
  const editors = usePageEditors((s) => (pageId ? s.byPage[pageId] : undefined))
  const load = usePageEditors((s) => s.load)

  const needsList = role === 'editor' && !!pageId && (restricted || (editOwnOnly && !mine))
  useEffect(() => {
    if (needsList && pageId) void load(pageId)
  }, [needsList, pageId, load])

  if (!page) return false
  if (role === 'owner') return true
  if (role !== 'editor') return false
  if (page.is_secret && !mine) return false
  const listed = !!userId && !!editors?.includes(userId)
  if (restricted && !listed) return false
  if (editOwnOnly && !mine && !listed) return false
  return true
}
