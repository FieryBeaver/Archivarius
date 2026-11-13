import { EditorContent, useEditor, type JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useCallback, useRef, useState, type MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import Popover from '../../components/Popover'
import type { Page, PageTab, Plugin } from '../../lib/types'
import { hidesSecrets, pagePath, usePages, visibilityRole } from '../../state/pages'
import { Callout, secretBlock } from './blocks'
import { BLOCK_ICONS } from './blockIcons'
import DmNotes from './DmNotes'
import { pageMention } from './mentionExtension'
import { MoveBlock } from './moveBlock'
import { PluginBlock } from './pluginBlock'
import { PluginPicker } from './PluginPicker'
import PluginTabView from './PluginTabView'
import { SlashCommand } from './slashCommand'
import TabBar from './TabBar'
import Toolbar from './Toolbar'
import { useAutosave, type SaveStatus } from './useAutosave'
import './editor.css'

interface DocEditorProps {
  page: Page
  canEdit: boolean
}

interface DocEditorInnerProps extends DocEditorProps {
  /** Secret blocks render hidden (view menu / player preview). */
  hideSecrets: boolean
}

const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }

function newTabId(): string {
  return crypto.randomUUID()
}

/**
 * Rich-text body of a 'doc' page. Mount with key={page.id}.
 * Remounts internally when canEdit or the hide-secrets view changes, since the
 * schema/node views depend on them (pending edits flush on unmount).
 */
export default function DocEditor({ page, canEdit }: DocEditorProps) {
  const hideSecrets = usePages(hidesSecrets)
  return <DocEditorInner key={`${canEdit ? 'edit' : 'view'}-${hideSecrets ? 'hidden' : 'shown'}`}
    page={page} canEdit={canEdit} hideSecrets={hideSecrets} />
}

/**
 * Owns the tab list and autosave. Tabs live in a ref (content changes on every keystroke
 * and must not re-render the strip) mirrored into state for structural changes.
 * `null` = legacy single doc in page.content; tabs are only materialized by the first
 * mutating tab action (adding a tab), so untouched pages are never rewritten.
 */
function DocEditorInner({ page, canEdit, hideSecrets }: DocEditorInnerProps) {
  const { status, schedule, flush } = useAutosave(page.id)
  const [tabs, setTabs] = useState<PageTab[] | null>(() => (page.tabs?.length ? page.tabs : null))
  const tabsRef = useRef(tabs)
  const [activeId, setActiveId] = useState<string | null>(() => tabs?.[0].id ?? null)
  const activeRef = useRef(activeId)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  // Latest JSON of the legacy single doc, needed when its tabs get materialized.
  const legacyContent = useRef<unknown>(page.content)
  // Pinned DM-notes tab: owner/editor only; gone while secrets are hidden or previewing
  // (visibilityRole demotes to viewer, and this component remounts on those switches).
  const vRole = usePages(visibilityRole)
  const showDmNotes = vRole === 'owner' || vRole === 'editor'
  const [dmOpen, setDmOpen] = useState(false)
  // The tab strip's "+" menu: pick a document tab or a plugin tab.
  const [addMenu, setAddMenu] = useState<{ anchor: DOMRect; mode: 'menu' | 'plugin' } | null>(null)

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
    if (id === activeRef.current && !dmOpen) return
    // Persist the outgoing tab before its editor unmounts (DM notes flush on their own unmount).
    flush()
    setDmOpen(false)
    setRenamingId(null)
    // Sync the strip state with the ref so the incoming tab mounts with its latest content.
    setTabs(tabsRef.current)
    activate(id)
  }

  function openDmNotes() {
    if (dmOpen) return
    flush()
    setRenamingId(null)
    setTabs(tabsRef.current)
    setDmOpen(true)
  }

  /** Existing tabs, or the materialized legacy doc as tab one. */
  function baseTabs(): PageTab[] {
    return tabsRef.current ?? [{ id: newTabId(), title: 'Main', content: legacyContent.current ?? EMPTY_DOC }]
  }

  function add() {
    const tab: PageTab = { id: newTabId(), title: 'New tab', content: EMPTY_DOC }
    commit([...baseTabs(), tab])
    setDmOpen(false)
    activate(tab.id)
    setRenamingId(tab.id)
  }

  /** v0.7 (2A): a tab hosting a plugin; its data lives in tab.plugin.data. */
  function addPluginTab(plugin: Plugin) {
    const tab: PageTab = {
      id: newTabId(), title: plugin.name, content: EMPTY_DOC,
      plugin: { pluginId: plugin.id, data: null },
    }
    commit([...baseTabs(), tab])
    setDmOpen(false)
    activate(tab.id)
  }

  /** Persist a plugin tab's data (same debounced tabs save as typing). */
  const onPluginData = useCallback((tabId: string, data: unknown) => {
    const current = tabsRef.current
    if (!current) return
    const next = current.map((t) => (t.id === tabId && t.plugin ? { ...t, plugin: { ...t.plugin, data } } : t))
    tabsRef.current = next
    schedule({ kind: 'tabs', tabs: next })
  }, [schedule])

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
  const showBar = canEdit || (tabs?.length ?? 0) > 1 || showDmNotes

  return (
    <div className={`doc-editor${canEdit ? '' : ' doc-readonly'}`}>
      {showBar && (
        <TabBar tabs={tabs ?? []} activeId={dmOpen ? null : activeId} canEdit={canEdit} renamingId={renamingId}
          onSelect={select} onAdd={(anchor) => setAddMenu({ anchor, mode: 'menu' })}
          onStartRename={setRenamingId} onRename={rename} onDelete={remove}
          dmNotes={showDmNotes ? { active: dmOpen, onSelect: openDmNotes } : undefined} />
      )}
      {addMenu && (
        <Popover anchor={addMenu.anchor} onClose={() => setAddMenu(null)}
          width={addMenu.mode === 'plugin' ? 300 : 200}
          className={addMenu.mode === 'plugin' ? 'tab-plugin-pick' : undefined}>
          {addMenu.mode === 'menu' ? (
            <>
              <button className="popover-item" role="menuitem" onClick={() => { setAddMenu(null); add() }}>
                <span>+</span><span>Document tab</span>
              </button>
              <button className="popover-item" role="menuitem"
                onClick={() => setAddMenu({ anchor: addMenu.anchor, mode: 'plugin' })}>
                <span aria-hidden dangerouslySetInnerHTML={{ __html: BLOCK_ICONS.plugin }} /><span>Plugin tab…</span>
              </button>
            </>
          ) : (
            <PluginPicker projectId={page.project_id}
              onPick={(p) => { setAddMenu(null); addPluginTab(p) }}
              onClose={() => setAddMenu(null)} />
          )}
        </Popover>
      )}
      {dmOpen && showDmNotes ? (
        <DmNotes key={`dm-${page.id}`} page={page} canEdit={showDmNotes} />
      ) : activeTab?.plugin ? (
        <PluginTabView key={activeTab.id} page={page} pluginId={activeTab.plugin.pluginId}
          data={activeTab.plugin.data} canEdit={canEdit}
          onData={(data) => onPluginData(activeTab.id, data)} />
      ) : (
        <TabDoc key={activeId ?? 'legacy'} page={page} canEdit={canEdit} hideSecrets={hideSecrets} status={status}
          initialContent={activeTab ? activeTab.content : page.content}
          onChange={onChange} />
      )}
    </div>
  )
}

interface TabDocProps {
  page: Page
  canEdit: boolean
  hideSecrets: boolean
  status: SaveStatus
  initialContent: unknown
  onChange(json: JSONContent): void
}

/**
 * One TipTap instance per tab (keyed by tab id), so each tab gets a fresh undo history —
 * a shared instance with setContent would let undo pull one tab's text into another.
 * `onChange` must be stable (it is captured by the editor's update handler).
 */
function TabDoc({ page, canEdit, hideSecrets, status, initialContent, onChange }: TabDocProps) {
  const navigate = useNavigate()

  // Created once per mount: new option identities on each render would make TipTap reconfigure.
  // StarterKit's Heading already binds Mod-Alt-1..6.
  const [setup] = useState(() => ({
    editable: canEdit,
    extensions: [
      StarterKit,
      pageMention(page.project_id, page.id),
      Callout,
      secretBlock(canEdit && !hideSecrets),
      PluginBlock.configure({ projectId: page.project_id, canEdit }),
      ...(canEdit ? [SlashCommand, MoveBlock] : []),
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
