import { useEditorState, type Editor } from '@tiptap/react'
import type { ReactNode } from 'react'
import { BLOCK_ICONS } from './blockIcons'
import type { SaveStatus } from './useAutosave'

const STATUS_TEXT: Record<SaveStatus, string> = {
  idle: '',
  saving: 'Saving…',
  saved: 'Saved',
  error: "Couldn't save",
}

interface Tool {
  label: ReactNode
  title: string
  isActive: (e: Editor) => boolean
  run: (e: Editor) => void
}

const TOOLS: Tool[] = [
  { label: 'B', title: 'Bold', isActive: (e) => e.isActive('bold'), run: (e) => e.chain().focus().toggleBold().run() },
  { label: 'I', title: 'Italic', isActive: (e) => e.isActive('italic'), run: (e) => e.chain().focus().toggleItalic().run() },
  ...([1, 2, 3] as const).map((level): Tool => ({
    label: `H${level}`,
    title: `Heading ${level}`,
    isActive: (e) => e.isActive('heading', { level }),
    run: (e) => e.chain().focus().toggleHeading({ level }).run(),
  })),
  { label: '•', title: 'Bullet list', isActive: (e) => e.isActive('bulletList'), run: (e) => e.chain().focus().toggleBulletList().run() },
  { label: '1.', title: 'Numbered list', isActive: (e) => e.isActive('orderedList'), run: (e) => e.chain().focus().toggleOrderedList().run() },
  { label: '❝', title: 'Quote', isActive: (e) => e.isActive('blockquote'), run: (e) => e.chain().focus().toggleBlockquote().run() },
  {
    label: <span className="editor-tool-glyph" dangerouslySetInnerHTML={{ __html: BLOCK_ICONS.lock }} />,
    title: 'Secret block (DM only)',
    isActive: (e) => e.isActive('secretBlock'),
    run: (e) => e.chain().focus().toggleWrap('secretBlock').run(),
  },
]

export default function Toolbar({ editor, status }: { editor: Editor; status: SaveStatus }) {
  const active = useEditorState({ editor, selector: ({ editor: e }) => TOOLS.map((t) => t.isActive(e)) })

  return (
    <div className="editor-toolbar" role="toolbar">
      {TOOLS.map((tool, i) => (
        <button key={tool.title} title={tool.title} aria-pressed={active[i]}
          className={`editor-tool tool-${tool.title.split(' ')[0].toLowerCase()}${active[i] ? ' active' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => tool.run(editor)}>
          {tool.label}
        </button>
      ))}
      <span className={`editor-status status-${status}`} aria-live="polite">{STATUS_TEXT[status]}</span>
    </div>
  )
}
