import { EditorContent, useEditor, type JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useState, type MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Page } from '../../lib/types'
import { pagePath } from '../../state/pages'
import { Callout, secretBlock } from './blocks'
import { pageMention } from './mentionExtension'
import { SlashCommand } from './slashCommand'
import Toolbar from './Toolbar'
import { useAutosave } from './useAutosave'
import './editor.css'

interface DocEditorProps {
  page: Page
  canEdit: boolean
}

/**
 * Rich-text body of a 'doc' page. Mount with key={page.id}.
 * Remounts internally when canEdit changes, since the schema/node views depend on it.
 */
export default function DocEditor({ page, canEdit }: DocEditorProps) {
  return <DocEditorInner key={canEdit ? 'edit' : 'view'} page={page} canEdit={canEdit} />
}

function DocEditorInner({ page, canEdit }: DocEditorProps) {
  const navigate = useNavigate()
  const { status, schedule } = useAutosave(page.id)

  // Created once per mount: new option identities on each render would make TipTap reconfigure.
  // StarterKit's Heading already binds Mod-Alt-1..6.
  const [setup] = useState(() => ({
    editable: canEdit,
    extensions: [
      StarterKit,
      pageMention(page.project_id, page.id),
      Callout,
      secretBlock(canEdit),
      ...(canEdit ? [SlashCommand] : []),
    ],
    content: (page.content as JSONContent | null) ?? '',
  }))
  const editor = useEditor({
    ...setup,
    onUpdate: ({ editor }) => { if (canEdit) schedule(editor.getJSON()) },
  })

  function followMention(e: MouseEvent) {
    const id = (e.target as HTMLElement).closest<HTMLElement>('.mention')?.dataset.id
    if (id) navigate(pagePath(page.project_id, id))
  }

  return (
    <div className={`doc-editor${canEdit ? '' : ' doc-readonly'}`}>
      {canEdit && <Toolbar editor={editor} status={status} />}
      <EditorContent editor={editor} className="doc-content" onClick={followMention} />
    </div>
  )
}
