import { EditorContent, useEditor, type JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect, useState, type MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { pagePath, usePages } from '../../state/pages'
import { Callout, secretBlock } from './blocks'
import { pageMention } from './mentionExtension'
import './editor.css'

/**
 * Read-only render of TipTap JSON with the same schema as DocEditor (contract, v0.5).
 * Secret blocks are hidden as for viewers. Clicking a mention navigates to that page.
 * Compact typography for narrow side panels.
 */
export default function ReadOnlyDoc({ content }: { content: unknown }) {
  const navigate = useNavigate()
  // Never editable, so the mention suggestion (which needs project/page ids) never fires.
  const [setup] = useState(() => ({
    editable: false,
    extensions: [StarterKit, pageMention('', ''), Callout, secretBlock(false)],
    content: (content as JSONContent | null) ?? '',
  }))
  const editor = useEditor(setup)

  // Follow content changes without rebuilding the editor.
  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      editor.commands.setContent((content as JSONContent | null) ?? '', { emitUpdate: false })
    }
  }, [editor, content])

  function followMention(e: MouseEvent) {
    const id = (e.target as HTMLElement).closest<HTMLElement>('.mention')?.dataset.id
    if (!id) return
    const target = usePages.getState().pages.find((p) => p.id === id)
    if (target) navigate(pagePath(target.project_id, id))
  }

  return (
    <div className="doc-readonly doc-compact">
      <EditorContent editor={editor} className="doc-content" onClick={followMention} />
    </div>
  )
}
