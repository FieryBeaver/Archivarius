import type { JSONContent } from '@tiptap/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as db from '../../lib/db'
import type { PageTab } from '../../lib/types'
import { usePages } from '../../state/pages'
import { extractMentionIds } from './mentions'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

/**
 * What to save: a legacy single document (page.tabs === null) or the full tab array.
 * A later payload always supersedes an earlier one, so a pending legacy save is simply
 * replaced once the page's tabs are materialized.
 */
export type SavePayload =
  | { kind: 'doc'; content: JSONContent }
  | { kind: 'tabs'; tabs: PageTab[] }

const DEBOUNCE_MS = 800

/** Keep the cached page current so re-opening/remounting it shows the latest content. */
function patchCache(pageId: string, payload: SavePayload): void {
  const { patchLocal } = usePages.getState()
  if (payload.kind === 'doc') patchLocal(pageId, { content: payload.content })
  else patchLocal(pageId, { tabs: payload.tabs, content: payload.tabs[0].content })
}

/** Saves the payload; resolves to the saved row's updated_at (v0.11 live updates). */
async function persist(pageId: string, payload: SavePayload): Promise<string> {
  if (payload.kind === 'tabs') {
    // Also syncs page.content (= tabs[0]) and mentions across every tab.
    return (await db.savePageTabs(pageId, payload.tabs)).updated_at
  }
  const { pages } = usePages.getState()
  const saved = await db.updatePage(pageId, { content: payload.content })
  // Skip mentions of pages that no longer exist (would violate the FK).
  const known = new Set(pages.map((p) => p.id))
  await db.replaceMentions(pageId, extractMentionIds(payload.content).filter((id) => known.has(id)))
  return saved.updated_at
}

/**
 * Debounced autosave. Pending changes are flushed on unmount and on demand via `flush`.
 * v0.11: `getSavedAt()` is the updated_at of the newest row this editor knows it matches
 * (seeded with the page's, advanced by every save of ours), so live updates can tell a
 * foreign change from an echo (`setSavedAt` after adopting a newer row); `settled()` waits for in-flight saves, `hasPending()`
 * reports unsaved (debounced) edits and `discard()` drops them.
 */
export function useAutosave(pageId: string, initialSavedAt?: string) {
  const [status, setStatus] = useState<SaveStatus>('idle')
  const pending = useRef<SavePayload | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Saves run one after another so an older write can never land last.
  const queue = useRef<Promise<void>>(Promise.resolve())
  const savedAt = useRef<string | undefined>(initialSavedAt)

  const flush = useCallback(() => {
    clearTimeout(timer.current)
    const payload = pending.current
    if (!payload) return
    pending.current = null
    patchCache(pageId, payload)
    queue.current = queue.current
      .then(() => persist(pageId, payload))
      .then(
        (at) => {
          savedAt.current = at
          if (!pending.current) setStatus('saved')
        },
        () => setStatus('error'),
      )
  }, [pageId])

  const schedule = useCallback((payload: SavePayload) => {
    pending.current = payload
    setStatus('saving')
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, DEBOUNCE_MS)
  }, [flush])

  useEffect(() => flush, [flush])

  const getSavedAt = useCallback(() => savedAt.current, [])
  const setSavedAt = useCallback((at: string) => { savedAt.current = at }, [])
  const settled = useCallback(() => queue.current, [])
  const hasPending = useCallback(() => pending.current !== null, [])
  const discard = useCallback(() => {
    clearTimeout(timer.current)
    pending.current = null
    setStatus('idle')
  }, [])

  return { status, schedule, flush, getSavedAt, setSavedAt, settled, hasPending, discard }
}
