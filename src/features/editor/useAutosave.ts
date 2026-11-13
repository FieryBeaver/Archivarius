import type { JSONContent } from '@tiptap/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as db from '../../lib/db'
import { usePages } from '../../state/pages'
import { extractMentionIds } from './mentions'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

const DEBOUNCE_MS = 800

async function persist(pageId: string, content: JSONContent): Promise<void> {
  const { pages, patchLocal } = usePages.getState()
  // Keep the cached page current so re-opening it shows the latest content.
  patchLocal(pageId, { content })
  await db.updatePage(pageId, { content })
  // Skip mentions of pages that no longer exist (would violate the FK).
  const known = new Set(pages.map((p) => p.id))
  await db.replaceMentions(pageId, extractMentionIds(content).filter((id) => known.has(id)))
}

/** Debounced content autosave. Pending changes are flushed on unmount. */
export function useAutosave(pageId: string) {
  const [status, setStatus] = useState<SaveStatus>('idle')
  const pending = useRef<JSONContent | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Saves run one after another so an older write can never land last.
  const queue = useRef<Promise<void>>(Promise.resolve())

  const flush = useCallback(() => {
    clearTimeout(timer.current)
    const content = pending.current
    if (!content) return
    pending.current = null
    queue.current = queue.current
      .then(() => persist(pageId, content))
      .then(
        () => { if (!pending.current) setStatus('saved') },
        () => setStatus('error'),
      )
  }, [pageId])

  const schedule = useCallback((content: JSONContent) => {
    pending.current = content
    setStatus('saving')
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, DEBOUNCE_MS)
  }, [flush])

  useEffect(() => flush, [flush])

  return { status, schedule }
}
