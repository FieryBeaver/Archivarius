import { EditorContent, useEditor, type Editor, type JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import Popover from '../../components/Popover'
import * as db from '../../lib/db'
import type { Page, PageTab, Plugin } from '../../lib/types'
import { hidesSecrets, pagePath, usePages, visibilityRole } from '../../state/pages'
import { usePageBump } from '../../state/realtime'
import { Callout, secretBlock } from './blocks'
import { BLOCK_ICONS } from './blockIcons'
import { roleAllows, type Visibility } from '../../lib/visibility'
import { pageMention } from './mentionExtension'
import { ImageBlock, clickBelowLastBlock, imageDropHandler, imagePasteHandler, showImageNote } from './imageBlock'
import { MapTabPicker } from './MapTabPicker'
import MapTabView from './MapTabView'
import { LINK_OPTIONS, linkClickHandler, openLinkFromClick } from './linkUi'
import { MoveBlock } from './moveBlock'
import { PluginBlock } from './pluginBlock'
import { PluginPicker } from './PluginPicker'
import PluginTabView from './PluginTabView'
import { selectionContextMenu } from './SelectionMenu'
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
  /** v0.11: tab to open first after a live-update remount. */
  initialActiveId?: string | null
  /** v0.11: remount with the (already patched) page from the store, keeping this tab open. */
  onReload(activeId: string | null): void
}

/** JSON with sorted object keys: jsonb reorders keys, so plain stringify can't compare docs. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v)
}

/** Everything about the tab strip except tab contents / plugin data (incl. which map a map tab shows). */
function tabShape(tabs: PageTab[]): string {
  return stableJson(tabs.map((t) => [t.id, t.title, t.visibleTo ?? null, t.plugin?.pluginId ?? null, t.map?.mapPageId ?? null]))
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
  // v0.11: bumped to remount with a newer version of the page from another member.
  const [reload, setReload] = useState<{ gen: number; activeId: string | null }>({ gen: 0, activeId: null })
  const onReload = useCallback((activeId: string | null) => setReload((r) => ({ gen: r.gen + 1, activeId })), [])
  return <DocEditorInner key={`${canEdit ? 'edit' : 'view'}-${hideSecrets ? 'hidden' : 'shown'}-${vRole}-${reload.gen}`}
    page={page} canEdit={canEdit} initialActiveId={reload.activeId} onReload={onReload} />
}

/**
 * Owns the tab list and autosave. Tabs live in a ref (content changes on every keystroke
 * and must not re-render the strip) mirrored into state for structural changes.
 * `null` = legacy single doc in page.content; tabs are only materialized by the first
 * mutating tab action (adding a tab), so untouched pages are never rewritten.
 */
function DocEditorInner({ page, canEdit, initialActiveId, onReload }: DocEditorInnerProps) {
  const { status, schedule, flush, getSavedAt, setSavedAt, settled, hasPending, discard } = useAutosave(page.id, page.updated_at)
  // Secret blocks and restricted tabs: gone while secrets are hidden or previewing
  // (visibilityRole demotes; the outer component remounts this on those switches).
  const vRole = usePages(visibilityRole)
  const secretsVisible = vRole === 'owner' || vRole === 'editor'
  const allowed = (t: PageTab) => roleAllows(t.visibleTo, vRole)
  const [tabs, setTabs] = useState<PageTab[] | null>(() => (page.tabs?.length ? page.tabs : null))
  const tabsRef = useRef(tabs)
  const [activeId, setActiveId] = useState<string | null>(() =>
    tabs?.find((t) => t.id === initialActiveId && allowed(t))?.id ?? tabs?.find(allowed)?.id ?? null)
  const activeRef = useRef(activeId)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  // Latest JSON of the legacy single doc, needed when its tabs get materialized.
  const legacyContent = useRef<unknown>(page.content)
  // The tab strip's "+" menu: pick a document tab, a plugin tab or a map tab.
  const [addMenu, setAddMenu] = useState<{ anchor: DOMRect; mode: 'menu' | 'plugin' | 'map' } | null>(null)
  const navigate = useNavigate()
  // addNewMapTab awaits a page insert: don't touch a remounted/closed editor's tabs afterwards.
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  // ---------- v0.11 live updates from other members ----------
  // The open tab's TipTap instance (null while a plugin tab / nothing is shown).
  const editorRef = useRef<Editor | null>(null)
  const onEditor = useCallback((e: Editor | null) => { editorRef.current = e }, [])
  // A newer version arrived while we had unsaved edits: offer it instead of clobbering them.
  const [remote, setRemote] = useState(false)
  const bump = usePageBump(page.id)

  /** Whether the server row holds exactly what this editor shows. */
  function matchesLocal(row: Page): boolean {
    const remoteTabs = row.tabs?.length ? row.tabs : null
    const local = tabsRef.current
    if (!remoteTabs || !local) return !remoteTabs && !local && stableJson(row.content ?? null) === stableJson(legacyContent.current ?? null)
    return stableJson(remoteTabs) === stableJson(local)
  }

  /**
   * Show the server's version. Same tab layout + a document tab open: swap the content in
   * place (no remount, plugin iframes survive; the caret is clamped to the new document, so
   * it can jump). Anything else (tabs added/renamed/removed, plugin tab open): remount.
   */
  function applyRemote(row: Page) {
    setRemote(false)
    setSavedAt(row.updated_at)
    usePages.getState().patchLocal(page.id, { content: row.content, tabs: row.tabs, updated_at: row.updated_at })
    const remoteTabs = row.tabs?.length ? row.tabs : null
    const local = tabsRef.current
    const editor = editorRef.current
    const sameShape = remoteTabs && local ? tabShape(remoteTabs) === tabShape(local) : !remoteTabs && !local
    const active = remoteTabs?.find((t) => t.id === activeRef.current)
    // A map tab open and only other tabs' text changed: adopt the tabs without remounting the map.
    if (sameShape && remoteTabs && active?.map) {
      tabsRef.current = remoteTabs
      setTabs(remoteTabs)
      return
    }
    if (!sameShape || !editor || editor.isDestroyed || (remoteTabs && (!active || active.plugin))) {
      onReload(activeRef.current)
      return
    }
    if (remoteTabs) {
      tabsRef.current = remoteTabs
      setTabs(remoteTabs)
    } else {
      legacyContent.current = row.content
    }
    const next = ((active ? active.content : row.content) as JSONContent | null) ?? EMPTY_DOC
    const { from, to } = editor.state.selection
    editor.chain()
      // Not undoable: undo must never revert someone else's change.
      .command(({ tr }) => { tr.setMeta('addToHistory', false); return true })
      .setContent(next, { emitUpdate: false })
      .run()
    try {
      const size = editor.state.doc.content.size
      editor.commands.setTextSelection({ from: Math.min(from, size), to: Math.min(to, size) })
    } catch {
      /* selection lands wherever setContent left it */
    }
  }

  useEffect(() => {
    if (!bump) return
    let alive = true
    void (async () => {
      await settled() // our own in-flight save first: its echo is not a foreign change
      const row = await db.getPage(page.id).catch(() => null)
      if (!alive || !row) return
      const seen = getSavedAt()
      if (seen && row.updated_at <= seen) return
      if (matchesLocal(row)) { setSavedAt(row.updated_at); setRemote(false); return }
      if (hasPending()) { setRemote(true); return }
      applyRemote(row)
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on a new live signal; the handlers read refs
  }, [bump])

  async function reloadRemote() {
    discard() // drop our unsaved edits — the user chose the other version
    await settled()
    const row = await db.getPage(page.id).catch(() => null)
    if (row) applyRemote(row)
    else setRemote(false)
  }

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

  /** A tab showing a map page; the map page keeps its own image, pins and regions. */
  function addMapTab(map: Page, title = map.title || 'Map') {
    const tab: PageTab = { id: newTabId(), title, content: EMPTY_DOC, map: { mapPageId: map.id } }
    commit([...baseTabs(), tab])
    activate(tab.id)
  }

  /** "New map": a map page under this note, shown in a new tab (upload happens in the tab). */
  async function addNewMapTab() {
    try {
      const map = await usePages.getState().create(page.id, 'map', undefined, {
        title: `${page.title.trim() || 'Untitled'} map`,
      })
      if (alive.current) addMapTab(map, 'Map')
    } catch (e) {
      showImageNote(`Couldn't create the map: ${(e as Error).message}`)
    }
  }

  /** Point a map tab at another map page (e.g. its map was deleted). */
  function relinkMapTab(tabId: string, map: Page) {
    const current = tabsRef.current
    if (!current) return
    commit(current.map((t) => (t.id === tabId && t.map ? { ...t, map: { mapPageId: map.id } } : t)))
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
          onSetVisibility={setVisibility}
          onOpenMap={(id) => {
            const mapPageId = tabsRef.current?.find((t) => t.id === id)?.map?.mapPageId
            if (mapPageId) navigate(pagePath(page.project_id, mapPageId))
          }} />
      )}
      {addMenu && (
        <Popover anchor={addMenu.anchor} onClose={() => setAddMenu(null)}
          width={addMenu.mode === 'menu' ? 200 : 300}
          className={addMenu.mode === 'menu' ? undefined : 'tab-plugin-pick'}>
          {addMenu.mode === 'menu' ? (
            <>
              <button className="popover-item" role="menuitem" onClick={() => { setAddMenu(null); add() }}>
                <span>+</span><span>Document tab</span>
              </button>
              <button className="popover-item" role="menuitem"
                onClick={() => setAddMenu({ anchor: addMenu.anchor, mode: 'plugin' })}>
                <span aria-hidden dangerouslySetInnerHTML={{ __html: BLOCK_ICONS.plugin }} /><span>Plugin tab…</span>
              </button>
              <button className="popover-item" role="menuitem"
                onClick={() => setAddMenu({ anchor: addMenu.anchor, mode: 'map' })}>
                <span aria-hidden>🗺</span><span>Map tab…</span>
              </button>
            </>
          ) : addMenu.mode === 'map' ? (
            <MapTabPicker
              onNew={() => { setAddMenu(null); void addNewMapTab() }}
              onPick={(m) => { setAddMenu(null); addMapTab(m) }}
              onClose={() => setAddMenu(null)} />
          ) : (
            <PluginPicker projectId={page.project_id}
              onPick={(p) => { setAddMenu(null); addPluginTab(p) }}
              onClose={() => setAddMenu(null)} />
          )}
        </Popover>
      )}
      {remote && (
        <div className="doc-remote-banner" role="status">
          <span>This page was updated by someone else.</span>
          <button type="button" className="btn-ghost" onClick={() => void reloadRemote()}>Reload</button>
          <button type="button" className="btn-ghost" title="Keep editing; saving will replace their version"
            onClick={() => setRemote(false)}>Keep mine</button>
        </div>
      )}
      {nothingShown ? (
        <p className="doc-tabs-none">Nothing on this page is shared with you yet.</p>
      ) : activeTab?.map ? (
        <MapTabView key={`${activeTab.id}:${activeTab.map.mapPageId}`} page={page}
          mapPageId={activeTab.map.mapPageId} canEditNote={canEdit}
          onRemove={(tabs?.length ?? 0) > 1 ? () => remove(activeTab.id) : undefined}
          onRelink={(m) => relinkMapTab(activeTab.id, m)} />
      ) : activeTab?.plugin ? (
        <PluginTabView key={`${activeTab.id}:${activeTab.plugin.pluginId}`} page={page}
          pluginId={activeTab.plugin.pluginId} data={activeTab.plugin.data} canEdit={canEdit}
          onData={(data) => onPluginData(activeTab.id, data)}
          onReconnect={(p) => reconnectPluginTab(activeTab.id, p)} />
      ) : (
        <TabDoc key={activeId ?? 'legacy'} page={page} canEdit={canEdit} secretsVisible={secretsVisible} status={status}
          initialContent={activeTab ? activeTab.content : page.content}
          onChange={onChange} onEditor={onEditor} />
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
  /** v0.11: reports this tab's editor instance (null on unmount) for live updates. */
  onEditor?(editor: Editor | null): void
}

/**
 * One TipTap instance per tab (keyed by tab id), so each tab gets a fresh undo history —
 * a shared instance with setContent would let undo pull one tab's text into another.
 * `onChange` must be stable (it is captured by the editor's update handler).
 */
function TabDoc({ page, canEdit, secretsVisible, status, initialContent, onChange, onEditor }: TabDocProps) {
  const navigate = useNavigate()

  // Created once per mount: new option identities on each render would make TipTap reconfigure.
  // StarterKit's Heading already binds Mod-Alt-1..6.
  const [setup] = useState(() => ({
    editable: canEdit,
    extensions: [
      StarterKit.configure({ link: LINK_OPTIONS }),
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
          // Links: click shows the edit bubble, Ctrl/Cmd+click opens (see linkUi.tsx).
          handleClick: linkClickHandler,
          // Clicking under a trailing image/plugin block opens a paragraph after it.
          handleDOMEvents: {
            mousedown: clickBelowLastBlock,
            // Right-click on selected text: "New subpage from selection" / "Link to existing page…".
            contextmenu: selectionContextMenu(page.id),
          },
        }
      : {},
    content: (initialContent as JSONContent | null) ?? '',
  }))
  const editor = useEditor({
    ...setup,
    onUpdate: ({ editor }) => { if (canEdit) onChange(editor.getJSON()) },
  })

  useEffect(() => {
    onEditor?.(editor)
    return () => onEditor?.(null)
  }, [editor, onEditor])

  function followMention(e: MouseEvent<HTMLElement>) {
    // Read-only: a click on a link opens it in a new tab (edit mode: linkClickHandler).
    if (!canEdit && openLinkFromClick(e)) return
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
