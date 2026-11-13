import { EditorContent, useEditor, type JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect, useRef, useState } from 'react'
import * as db from '../../lib/db'
import type { Page } from '../../lib/types'
import { Callout, SecretBlock } from './blocks'
import { pageMention } from './mentionExtension'
import { PluginBlock } from './pluginBlock'
import { SlashCommand } from './slashCommand'
import Toolbar from './Toolbar'
import type { SaveStatus } from './useAutosave'

const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }
const DEBOUNCE_MS = 800

/**
 * The pinned "DM notes" tab body: owner/editor-only content stored in
 * page_dm_notes, which RLS withholds from viewers server-side (unlike secret
 * blocks). Mentions here are not synced, so backlinks can't leak the note.
 */
export default function DmNotes({ page, canEdit }: { page: Page; canEdit: boolean }) {
  const [loaded, setLoaded] = useState<{ content: unknown } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    db.getDmNotes(page.id).then(
      (content) => live && setLoaded({ content }),
      (e: Error) => live && setError(e.message),
    )
    return () => { live = false }
  }, [page.id])

  if (error) return <p className="error-text dm-notes-error">Couldn't load DM notes: {error}</p>
  if (!loaded) return <div className="page-loading">Loading DM notes…</div>
  return <DmNotesDoc page={page} canEdit={canEdit} initialContent={loaded.content} />
}

function DmNotesDoc({ page, canEdit, initialContent }: { page: Page; canEdit: boolean; initialContent: unknown }) {
  const [status, setStatus] = useState<SaveStatus>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pending = useRef<JSONContent | null>(null)
  // Saves run one after another so an older write can never land last.
  const queue = useRef<Promise<void>>(Promise.resolve())

  // Same extension set as a regular tab, so the toolbar and / menu just work.
  const [setup] = useState(() => ({
    editable: canEdit,
    extensions: [
      StarterKit,
      pageMention(page.project_id, page.id),
      Callout,
      SecretBlock,
      PluginBlock.configure({ projectId: page.project_id, canEdit }),
      ...(canEdit ? [SlashCommand] : []),
    ],
    content: (initialContent as JSONContent | null) ?? EMPTY_DOC,
  }))

  const flush = () => {
    clearTimeout(timer.current)
    const content = pending.current
    if (!content) return
    pending.current = null
    queue.current = queue.current
      .then(() => db.saveDmNotes(page.id, page.project_id, content))
      .then(
        () => { if (!pending.current) setStatus('saved') },
        () => setStatus('error'),
      )
  }
  const flushRef = useRef(flush)
  flushRef.current = flush

  const editor = useEditor({
    ...setup,
    onUpdate: ({ editor }) => {
      if (!canEdit) return
      pending.current = editor.getJSON()
      setStatus('saving')
      clearTimeout(timer.current)
      timer.current = setTimeout(() => flushRef.current(), DEBOUNCE_MS)
    },
  })

  // Flush pending notes when the tab unmounts (tab switch, page change).
  useEffect(() => () => flushRef.current(), [])

  return (
    <>
      {canEdit && <Toolbar editor={editor} status={status} />}
      <EditorContent editor={editor} className="doc-content" />
    </>
  )
}
