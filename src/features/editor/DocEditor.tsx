import { EditorContent, useEditor, type JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useCallback, useRef, useState, type MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Page, PageTab } from '../../lib/types'
import { pagePath } from '../../state/pages'
import { Callout, secretBlock } from './blocks'
import { pageMention } from './mentionExtension'
import { PluginBlock } from './pluginBlock'
import { SlashCommand } from './slashCommand'
import TabBar from './TabBar'
import Toolbar from './Toolbar'
import { useAutosave, type SaveStatus } from './useAutosave'
import './editor.css'

interface DocEditorProps {
  page: Page
  canEdit: boolean
}

const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }

function newTabId(): string {
  return crypto.randomUUID()
}

/**
 * Rich-text body of a 'doc' page. Mount with key={page.id}.
 * Remounts internally when canEdit changes, since the schema/node views depend on it.
 */
export default function DocEditor({ page, canEdit }: DocEditorProps) {
  return <DocEditorInner key={canEdit ? 'edit' : 'view'} page={page} canEdit={canEdit} />
}

/**
 * Owns the tab list and autosave. Tabs live in a ref (content changes on every keystroke
 * and must not re-render the strip) mirrored into state for structural changes.
 * `null` = legacy single doc in page.content; tabs are only materialized by the first
 * mutating tab action (adding a tab), so untouched pages are never rewritten.
 */
function DocEditorInner({ page, canEdit }: DocEditorProps) {
  const { status, schedule, flush } = useAutosave(page.id)
  const [tabs, setTabs] = useState<PageTab[] | null>(() => (page.tabs?.length ? page.tabs : null))
  const tabsRef = useRef(tabs)
  const [activeId, setActiveId] = useState<string | null>(() => tabs?.[0].id ?? null)
  const activeRef = useRef(activeId)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  // Latest JSON of the legacy single doc, needed when its tabs get materialized.
  const legacyContent = useRef<unknown>(page.content)

  /** Structural change: re-render the strip and save the full array right away. */
  const commit = useCallback((next: PageTab[]) => {
    tabsRef.current = next
    setTabs(next)
    schedule({ kind: 'tabs', tabs: next })
    flush()
  }, [schedule, flush])

  const activate = useCallback((id: string) => {
    activeRef.current = id
    setActiveId(id)
  }, [])

  const onChange = useCallback((json: JSONContent) => {
    const current = tabsRef.current
    if (!current) {
      legacyContent.current = json
      schedule({ kind: 'doc', content: json })
      return
    }
    const next = current.map((t) => (t.id === activeRef.current ? { ...t, content: json } : t))
    tabsRef.current = next
    schedule({ kind: 'tabs', tabs: next })
  }, [schedule])

  function select(id: string) {
    if (id === activeRef.current) return
    // Persist the outgoing tab before its editor unmounts.
    flush()
    setRenamingId(null)
    // Sync the strip state with the ref so the incoming tab mounts with its latest content.
    setTabs(tabsRef.current)
    activate(id)
  }

  function add() {
    const base = tabsRef.current ?? [{ id: newTabId(), title: 'Main', content: legacyContent.current ?? EMPTY_DOC }]
    const tab: PageTab = { id: newTabId(), title: 'New tab', content: EMPTY_DOC }
    commit([...base, tab])
    activate(tab.id)
    setRenamingId(tab.id)
  }

  function rename(id: string, title: string | null) {
    setRenamingId(null)
    const current = tabsRef.current
    const clean = title?.trim()
    if (!current || !clean) return
    const prev = current.find((t) => t.id === id)
    if (!prev || prev.title === clean) return
    commit(current.map((t) => (t.id === id ? { ...t, title: clean } : t)))
  }

  function remove(id: string) {
    const current = tabsRef.current
    if (!current || current.length <= 1) return
    const index = current.findIndex((t) => t.id === id)
    if (index < 0) return
    const next = current.filter((t) => t.id !== id)
    commit(next)
    if (id === activeRef.current) activate(next[Math.min(index, next.length - 1)].id)
    if (id === renamingId) setRenamingId(null)
  }

  const activeTab = tabs?.find((t) => t.id === activeId) ?? null
  // Viewers only get a strip when there is something to switch between.
  const showBar = canEdit || (tabs?.length ?? 0) > 1

  return (
    <div className={`doc-editor${canEdit ? '' : ' doc-readonly'}`}>
      {showBar && (
        <TabBar tabs={tabs ?? []} activeId={activeId} canEdit={canEdit} renamingId={renamingId}
          onSelect={select} onAdd={add} onStartRename={setRenamingId} onRename={rename} onDelete={remove} />
      )}
      <TabDoc key={activeId ?? 'legacy'} page={page} canEdit={canEdit} status={status}
        initialContent={activeTab ? activeTab.content : page.content}
        onChange={onChange} />
    </div>
  )
}

interface TabDocProps {
  page: Page
  canEdit: boolean
  status: SaveStatus
  initialContent: unknown
  onChange(json: JSONContent): void
}

/**
 * One TipTap instance per tab (keyed by tab id), so each tab gets a fresh undo history —
 * a shared instance with setContent would let undo pull one tab's text into another.
 * `onChange` must be stable (it is captured by the editor's update handler).
 */
function TabDoc({ page, canEdit, status, initialContent, onChange }: TabDocProps) {
  const navigate = useNavigate()

  // Created once per mount: new option identities on each render would make TipTap reconfigure.
  // StarterKit's Heading already binds Mod-Alt-1..6.
  const [setup] = useState(() => ({
    editable: canEdit,
    extensions: [
      StarterKit,
      pageMention(page.project_id, page.id),
      Callout,
      secretBlock(canEdit),
      PluginBlock.configure({ projectId: page.project_id, canEdit }),
      ...(canEdit ? [SlashCommand] : []),
    ],
    content: (initialContent as JSONContent | null) ?? '',
  }))
  const editor = useEditor({
    ...setup,
    onUpdate: ({ editor }) => { if (canEdit) onChange(editor.getJSON()) },
  })

  function followMention(e: MouseEvent) {
    const id = (e.target as HTMLElement).closest<HTMLElement>('.mention')?.dataset.id
    if (id) navigate(pagePath(page.project_id, id))
  }

  return (
    <>
      {canEdit && <Toolbar editor={editor} status={status} />}
      <EditorContent editor={editor} className="doc-content" onClick={followMention} />
    </>
  )
}
