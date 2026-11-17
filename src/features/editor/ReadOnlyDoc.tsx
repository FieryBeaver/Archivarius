import { EditorContent, useEditor, type JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect, useState, type MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { pagePath, usePages } from '../../state/pages'
import { Callout, secretBlock } from './blocks'
import { pageMention } from './mentionExtension'
import { ImageBlock } from './imageBlock'
import { LINK_OPTIONS, openLinkFromClick } from './linkUi'
import { PluginBlock } from './pluginBlock'
import './editor.css'

/**
 * Read-only render of TipTap JSON with the same schema as DocEditor (contract, v0.5).
 * Secret blocks are hidden as for viewers; plugin and image blocks render read-only. Clicking a mention navigates to that page.
 * Compact typography for narrow side panels.
 */
export default function ReadOnlyDoc({ content }: { content: unknown }) {
  const navigate = useNavigate()
  // Never editable, so the mention suggestion (which needs project/page ids) never fires.
  const [setup] = useState(() => ({
    editable: false,
    extensions: [StarterKit.configure({ link: LINK_OPTIONS }), pageMention('', ''), Callout, secretBlock(false),
      // Plugins resolve against the currently loaded project; always read-only here.
      PluginBlock.configure({ projectId: null, canEdit: false }),
      // Images render read-only (no handles/toolbar); the click-to-zoom lightbox still works.
      ImageBlock.configure({ projectId: null, canEdit: false })],
    content: (content as JSONContent | null) ?? '',
  }))
  const editor = useEditor(setup)

  // Follow content changes without rebuilding the editor.
  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      editor.commands.setContent((content as JSONContent | null) ?? '', { emitUpdate: false })
    }
  }, [editor, content])

  function followMention(e: MouseEvent<HTMLElement>) {
    // Links open in a new tab (never the anchor's own navigation).
    if (openLinkFromClick(e)) return
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
