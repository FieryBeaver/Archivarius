import { EditorContent, useEditor, type JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useCallback, useRef, useState, type MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import Popover from '../../components/Popover'
import type { Page, PageTab, Plugin } from '../../lib/types'
import { hidesSecrets, pagePath, usePages, visibilityRole } from '../../state/pages'
import { Callout, secretBlock } from './blocks'
import { BLOCK_ICONS } from './blockIcons'
import { roleAllows, type Visibility } from '../../lib/visibility'
import { pageMention } from './mentionExtension'
import { ImageBlock, clickBelowLastBlock, imageDropHandler, imagePasteHandler } from './imageBlock'
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


const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }

function newTabId(): string {
  return crypto.randomUUID()
}

/**
 * Rich-text body of a 'doc' page. Mount with key={page.id}.
 * Remounts internally when canEdit or the hide-secrets/preview view changes, since the
 * schema/node views and the visible tab set depend on them (pending edits flush on unmount).
 */
export default function DocEditor({ page, canEdit }: DocEditorProps) {
  const hideSecrets = usePages(hidesSecrets)
  const vRole = usePages(visibilityRole)
  return <DocEditorInner key={`${canEdit ? 'edit' : 'view'}-${hideSecrets ? 'hidden' : 'shown'}-${vRole}`}
    page={page} canEdit={canEdit} />
}

/**
 * Owns the tab list and autosave. Tabs live in a ref (content changes on every keystroke
 * and must not re-render the strip) mirrored into state for structural changes.
 * `null` = legacy single doc in page.content; tabs are only materialized by the first
 * mutating tab action (adding a tab), so untouched pages are never rewritten.
 */
function DocEditorInner({ page, canEdit }: DocEditorProps) {
  const { status, schedule, flush } = useAutosave(page.id)
  // Secret blocks and restricted tabs: gone while secrets are hidden or previewing
  // (visibilityRole demotes; the outer component remounts this on those switches).
  const vRole = usePages(visibilityRole)
  const secretsVisible = vRole === 'owner' || vRole === 'editor'
  const allowed = (t: PageTab) => roleAllows(t.visibleTo, vRole)
  const [tabs, setTabs] = useState<PageTab[] | null>(() => (page.tabs?.length ? page.tabs : null))
  const tabsRef = useRef(tabs)
  const [activeId, setActiveId] = useState<string | null>(() => tabs?.find(allowed)?.id ?? null)
  const activeRef = useRef(activeId)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  // Latest JSON of the legacy single doc, needed when its tabs get materialized.
  const legacyContent = useRef<unknown>(page.content)
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
    if (id === activeRef.current) return
    // Persist the outgoing tab before its editor unmounts.
    flush()
    setRenamingId(null)
    // Sync the strip state with the ref so the incoming tab mounts with its latest content.
    setTabs(tabsRef.current)
    activate(id)
  }

  /** Existing tabs, or the materialized legacy doc as tab one. */
  function baseTabs(): PageTab[] {
    return tabsRef.current ?? [{ id: newTabId(), title: 'Main', content: legacyContent.current ?? EMPTY_DOC }]
  }

  function add() {
    const tab: PageTab = { id: newTabId(), title: 'New tab', content: EMPTY_DOC }
    commit([...baseTabs(), tab])
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

  /** Re-point an orphaned plugin tab at an installed plugin; tab.plugin.data is kept as is. */
  function reconnectPluginTab(tabId: string, plugin: Plugin) {
    const current = tabsRef.current
    if (!current) return
    commit(current.map((t) => (t.id === tabId && t.plugin ? { ...t, plugin: { ...t.plugin, pluginId: plugin.id } } : t)))
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

  function setVisibility(id: string, visibleTo: Visibility) {
    const current = tabsRef.current
    if (!current) return
    const next = current.map((t) => {
      if (t.id !== id) return t
      const updated: PageTab = { ...t, visibleTo }
      if (visibleTo === 'all') delete updated.visibleTo
      return updated
    })
    commit(next)
    // Restricting the open tab above the current view role (e.g. while hiding secrets) hides it here too.
    if (id === activeRef.current && !roleAllows(visibleTo, vRole)) {
      const fallback = next.find(allowed)
      if (fallback) select(fallback.id)
    }
  }

  function remove(id: string) {
    const current = tabsRef.current
    if (!current || current.length <= 1) return
    const index = current.findIndex((t) => t.id === id)
    if (index < 0) return
    const next = current.filter((t) => t.id !== id)
    commit(next)
    if (id === activeRef.current) {
      const shownNext = next.filter(allowed)
      const fallback = shownNext.find((t) => next.indexOf(t) >= index) ?? shownNext[shownNext.length - 1]
      if (fallback) activate(fallback.id)
    }
    if (id === renamingId) setRenamingId(null)
  }

  const shownTabs = tabs?.filter(allowed) ?? null
  const activeTab = shownTabs?.find((t) => t.id === activeId) ?? null
  // Tabs exist but every one is restricted above this role: never fall back to page.content
  // (it mirrors tabs[0], which may be one of the hidden tabs).
  const nothingShown = tabs !== null && !activeTab
  // Viewers only get a strip when there is something to switch between.
  const showBar = canEdit || (shownTabs?.length ?? 0) > 1

  return (
    <div className={`doc-editor${canEdit ? '' : ' doc-readonly'}`}>
      {showBar && (
        <TabBar tabs={shownTabs ?? []} activeId={activeId} canEdit={canEdit} renamingId={renamingId}
          canOwnerOnly={vRole === 'owner'}
          onSelect={select} onAdd={(anchor) => setAddMenu({ anchor, mode: 'menu' })}
          onStartRename={setRenamingId} onRename={rename} onDelete={remove}
          onSetVisibility={setVisibility} />
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
      {nothingShown ? (
        <p className="doc-tabs-none">Nothing on this page is shared with you yet.</p>
      ) : activeTab?.plugin ? (
        <PluginTabView key={`${activeTab.id}:${activeTab.plugin.pluginId}`} page={page}
          pluginId={activeTab.plugin.pluginId} data={activeTab.plugin.data} canEdit={canEdit}
          onData={(data) => onPluginData(activeTab.id, data)}
          onReconnect={(p) => reconnectPluginTab(activeTab.id, p)} />
      ) : (
        <TabDoc key={activeId ?? 'legacy'} page={page} canEdit={canEdit} secretsVisible={secretsVisible} status={status}
          initialContent={activeTab ? activeTab.content : page.content}
          onChange={onChange} />
      )}
    </div>
  )
}

interface TabDocProps {
  page: Page
  canEdit: boolean
  /** false: every secret block renders hidden (viewers, preview, hide toggle). */
  secretsVisible: boolean
  status: SaveStatus
  initialContent: unknown
  onChange(json: JSONContent): void
}

/**
 * One TipTap instance per tab (keyed by tab id), so each tab gets a fresh undo history —
 * a shared instance with setContent would let undo pull one tab's text into another.
 * `onChange` must be stable (it is captured by the editor's update handler).
 */
function TabDoc({ page, canEdit, secretsVisible, status, initialContent, onChange }: TabDocProps) {
  const navigate = useNavigate()

  // Created once per mount: new option identities on each render would make TipTap reconfigure.
  // StarterKit's Heading already binds Mod-Alt-1..6.
  const [setup] = useState(() => ({
    editable: canEdit,
    extensions: [
      StarterKit,
      pageMention(page.project_id, page.id),
      Callout,
      secretBlock(secretsVisible),
      PluginBlock.configure({ projectId: page.project_id, canEdit }),
      ImageBlock.configure({ projectId: page.project_id, canEdit }),
      ...(canEdit ? [SlashCommand, MoveBlock] : []),
    ],
    // Pasted / dropped image files upload to the world's library and become image blocks.
    editorProps: canEdit
      ? {
          handlePaste: imagePasteHandler(page.project_id),
          handleDrop: imageDropHandler(page.project_id),
          // Clicking under a trailing image/plugin block opens a paragraph after it.
          handleDOMEvents: { mousedown: clickBelowLastBlock },
        }
      : {},
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
