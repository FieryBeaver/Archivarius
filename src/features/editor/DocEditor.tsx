import { EditorContent, useEditor, type JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useState, type MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Page } from '../../lib/types'
import { pagePath } from '../../state/pages'
import { pageMention } from './mentionExtension'
import Toolbar from './Toolbar'
import { useAutosave } from './useAutosave'
import './editor.css'

/** Rich-text body of a 'doc' page. Mount with key={page.id}. */
export default function DocEditor({ page }: { page: Page }) {
  const navigate = useNavigate()
  const { status, schedule } = useAutosave(page.id)

  // Created once per mount: new option identities on each render would make TipTap reconfigure.
  const [setup] = useState(() => ({
    extensions: [StarterKit, pageMention(page.project_id, page.id)],
    content: (page.content as JSONContent | null) ?? '',
  }))
  const editor = useEditor({ ...setup, onUpdate: ({ editor }) => schedule(editor.getJSON()) })

  function followMention(e: MouseEvent) {
    const id = (e.target as HTMLElement).closest<HTMLElement>('.mention')?.dataset.id
    if (id) navigate(pagePath(page.project_id, id))
  }

  return (
    <div className="doc-editor">
      <Toolbar editor={editor} status={status} />
      <EditorContent editor={editor} className="doc-content" onClick={followMention} />
    </div>
  )
}
