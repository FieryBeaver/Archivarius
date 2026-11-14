import { EditorContent, useEditor, type JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as db from '../../lib/db'
import type { Page } from '../../lib/types'
import { useAuth } from '../../state/auth'
import { Callout, SecretBlock } from './blocks'
import { pageMention } from './mentionExtension'
import { MoveBlock } from './moveBlock'
import { PluginBlock } from './pluginBlock'
import ReadOnlyDoc from './ReadOnlyDoc'
import { SlashCommand } from './slashCommand'
import Toolbar from './Toolbar'
import type { SaveStatus } from './useAutosave'

const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }
const DEBOUNCE_MS = 800

/**
 * The pinned "Notes" tab body (v0.7: per-author). Everyone with the tab edits
 * their OWN notes row in page_dm_notes; RLS additionally hands owners every
 * author's row, shown read-only below their own. Viewers get nothing.
 * Mentions here are not synced, so backlinks can't leak a note.
 */
export default function DmNotes({ page, canEdit }: { page: Page; canEdit: boolean }) {
  const myId = useAuth((s) => s.session?.user.id)
  const [loaded, setLoaded] = useState<{ own: unknown; others: db.DmNoteRow[] } | null>(null)
  const [emails, setEmails] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    db.listDmNotes(page.id).then(
      (rows) => {
        if (!live) return
        setLoaded({
          own: rows.find((r) => r.user_id === myId)?.content ?? null,
          others: rows.filter((r) => r.user_id !== myId),
        })
      },
      (e: Error) => live && setError(e.message),
    )
    return () => { live = false }
  }, [page.id, myId])

  // Owners see other authors' notes; put names on them when we can.
  const hasOthers = (loaded?.others.length ?? 0) > 0
  useEffect(() => {
    if (!hasOthers) return
    let live = true
    db.listMembers(page.project_id).then(
      (members) => live && setEmails(Object.fromEntries(members.map((m) => [m.user_id, m.email]))),
      () => { /* names stay generic */ },
    )
    return () => { live = false }
  }, [hasOthers, page.project_id])

  if (error) return <p className="error-text dm-notes-error">Couldn't load notes: {error}</p>
  if (!loaded) return <div className="page-loading">Loading notes…</div>
  return (
    <>
      <DmNotesDoc page={page} canEdit={canEdit} initialContent={loaded.own} />
      {loaded.others.map((row) => (
        <section key={row.user_id} className="dm-notes-other">
          <h3 className="dm-notes-other-head">Notes by {emails[row.user_id] ?? 'another member'}</h3>
          {row.content
            ? <ReadOnlyDoc content={row.content} />
            : <p className="dm-notes-empty">Empty.</p>}
        </section>
      ))}
    </>
  )
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
      ...(canEdit ? [SlashCommand, MoveBlock] : []),
    ],
    content: (initialContent as JSONContent | null) ?? EMPTY_DOC,
  }))

  const flush = useCallback(() => {
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
  }, [page.id, page.project_id])

  const editor = useEditor({
    ...setup,
    onUpdate: ({ editor }) => {
      if (!canEdit) return
      pending.current = editor.getJSON()
      setStatus('saving')
      clearTimeout(timer.current)
      timer.current = setTimeout(flush, DEBOUNCE_MS)
    },
  })

  // Flush pending notes when the tab unmounts (tab switch, page change).
  useEffect(() => flush, [flush])

  return (
    <>
      {canEdit && <Toolbar editor={editor} status={status} />}
      <EditorContent editor={editor} className="doc-content" />
    </>
  )
}
