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

async function persist(pageId: string, payload: SavePayload): Promise<void> {
  if (payload.kind === 'tabs') {
    // Also syncs page.content (= tabs[0]) and mentions across every tab.
    await db.savePageTabs(pageId, payload.tabs)
    return
  }
  const { pages } = usePages.getState()
  await db.updatePage(pageId, { content: payload.content })
  // Skip mentions of pages that no longer exist (would violate the FK).
  const known = new Set(pages.map((p) => p.id))
  await db.replaceMentions(pageId, extractMentionIds(payload.content).filter((id) => known.has(id)))
}

/** Debounced autosave. Pending changes are flushed on unmount and on demand via `flush`. */
export function useAutosave(pageId: string) {
  const [status, setStatus] = useState<SaveStatus>('idle')
  const pending = useRef<SavePayload | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Saves run one after another so an older write can never land last.
  const queue = useRef<Promise<void>>(Promise.resolve())

  const flush = useCallback(() => {
    clearTimeout(timer.current)
    const payload = pending.current
    if (!payload) return
    pending.current = null
    patchCache(pageId, payload)
    queue.current = queue.current
      .then(() => persist(pageId, payload))
      .then(
        () => { if (!pending.current) setStatus('saved') },
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

  return { status, schedule, flush }
}
