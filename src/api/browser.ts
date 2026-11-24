/*
 * Browser binding of the scripting API: window.archivarius while signed in (API.md).
 * The open world comes from ProjectLayout (useScriptingWorld); after every write this tab's
 * stores are refreshed explicitly — realtime ignores this tab's own broadcasts.
 */
import { useEffect } from 'react'
import { usePages } from '../state/pages'
import { bumpPages } from '../state/realtime'
import { createArchivarius, type ApiChange, type Archivarius } from './archivarius'

export type { Archivarius, ApiChange, CreateNoteOptions, ListNotesOptions, Note, Notes, World, WorldInfo } from './archivarius'

declare global {
  interface Window {
    /** The scripting API (API.md); present while signed in. */
    archivarius?: Archivarius
  }
}

let openWorldId: string | null = null

async function refreshViews(change: ApiChange): Promise<void> {
  const store = usePages.getState()
  if (store.projectId !== change.worldId) return
  if (change.kind === 'content') {
    for (const row of change.pages) store.patchLocal(row.id, row)
  } else {
    // Same project: load() refreshes in place (expanded nodes / preview are kept).
    await store.load(change.worldId)
    for (const row of change.pages) if (row.parent_id) usePages.getState().toggle(row.parent_id, true)
  }
  // The open editor/map/timeline re-reads the page: clean editors swap the new content in,
  // ones with unsaved edits show the "updated by someone else" banner.
  bumpPages(change.pageIds)
}

/** Installs window.archivarius; returns the uninstaller. */
export function installScriptingApi(): () => void {
  const api = createArchivarius({
    currentWorldId: () => openWorldId,
    onChange: refreshViews,
  })
  window.archivarius = api
  return () => {
    if (window.archivarius === api) delete window.archivarius
  }
}

/** window.archivarius while a user is signed in (call from App). */
export function useScriptingApi(userId: string | undefined): void {
  useEffect(() => (userId ? installScriptingApi() : undefined), [userId])
}

/** Marks `projectId` as the world archivarius.notes / world() target (call from ProjectLayout). */
export function useScriptingWorld(projectId: string | undefined): void {
  useEffect(() => {
    openWorldId = projectId || null
    return () => {
      if (openWorldId === projectId) openWorldId = null
    }
  }, [projectId])
}
