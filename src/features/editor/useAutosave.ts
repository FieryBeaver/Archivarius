import type { JSONContent } from '@tiptap/react'
import { useEffect, useState } from 'react'
import * as db from '../../lib/db'
import type { PageTab } from '../../lib/types'
import { usePages } from '../../state/pages'
import { useLive } from '../../state/realtime'
import { createAutosaver, type SaveStatus } from './autosaveCore'
import { extractMentionIds } from './mentions'

export type { SaveStatus }

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
 * Debounced autosave (logic in autosaveCore.ts). Pending changes are flushed on unmount and
 * on demand via `flush`. v0.11: `getSavedAt()` is the updated_at of the newest row this
 * editor knows it matches (seeded with the page's, advanced by every save of ours), so live
 * updates can tell a foreign change from an echo (`setSavedAt` after adopting a newer row);
 * `settled()` waits for in-flight saves, `hasPending()` reports unsaved (debounced) edits and
 * `discard()` drops them. `hold()` / `release(save)` suspend all writes while the
 * "updated by someone else" banner is up; unmounting while held drops the edits (with a notice)
 * instead of overwriting the other member's version.
 * Mount with a stable pageId (DocEditor is keyed by page id).
 */
export function useAutosave(pageId: string, initialSavedAt?: string) {
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [saver] = useState(() => createAutosaver<SavePayload>({
    persist: (payload) => persist(pageId, payload),
    onFlush: (payload) => patchCache(pageId, payload),
    onStatus: setStatus,
    debounceMs: DEBOUNCE_MS,
    initialSavedAt,
  }))

  useEffect(() => () => {
    if (saver.dispose()) {
      useLive.getState().setNotice('Your unsaved edits were discarded: someone else changed the page meanwhile.')
    }
  }, [saver])

  return {
    status,
    schedule: saver.schedule,
    flush: saver.flush,
    getSavedAt: saver.getSavedAt,
    setSavedAt: saver.setSavedAt,
    settled: saver.settled,
    hasPending: saver.hasPending,
    discard: saver.discard,
    pause: saver.pause,
    resume: saver.resume,
    hold: saver.hold,
    release: saver.release,
    isHeld: saver.isHeld,
  }
}
