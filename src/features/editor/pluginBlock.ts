import type { Node as PMNode } from '@tiptap/pm/model'
import { Node, mergeAttributes, type Editor } from '@tiptap/react'
import * as db from '../../lib/db'
import type { Plugin, Role } from '../../lib/types'
import { effectiveRole, usePages, visibilityRole } from '../../state/pages'
import { usePanelStore } from '../../state/panel'
import { glyphElement } from './blockIcons'
import { makeDragHandle } from './blocks'

/*
 * User-uploaded plugin blocks (CONTRACT.md v0.6, PLUGINS.md).
 * { type: 'pluginBlock', attrs: { pluginId, data } } — an atom rendered as a sandboxed iframe
 * (sandbox="allow-scripts" only, never allow-same-origin) talking to the host via postMessage.
 */

// ---------- plugin list / source cache (module scope, short TTL) ----------

const TTL_MS = 30_000
type Entry<T> = { at: number; p: Promise<T> }
const listCache = new Map<string, Entry<Plugin[]>>()
const sourceCache = new Map<string, Entry<string>>()

function cached<T>(cache: Map<string, Entry<T>>, key: string, fresh: boolean, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit.p
  const p = load()
  const entry = { at: Date.now(), p }
  cache.set(key, entry)
  // Never cache failures.
  p.catch(() => { if (cache.get(key) === entry) cache.delete(key) })
  return p
}

/** The project's plugins, cached briefly. `fresh` bypasses (and refreshes) the cache. */
export function loadPlugins(projectId: string, fresh = false): Promise<Plugin[]> {
  return cached(listCache, projectId, fresh, () => db.listPlugins(projectId))
}

/** A plugin's HTML source, cached briefly. Shared by block node views and plugin tabs. */
export function loadSource(plugin: Plugin): Promise<string> {
  return cached(sourceCache, plugin.source_path, false, () => db.getPluginSource(plugin))
}

/** Drops cached plugin lists and sources (all projects when no id is given). */
export function invalidatePlugins(projectId?: string): void {
  if (!projectId) {
    listCache.clear()
    sourceCache.clear()
    return
  }
  listCache.delete(projectId)
  for (const key of [...sourceCache.keys()]) if (key.startsWith(`${projectId}/`)) sourceCache.delete(key)
}

// ---------- bridge helpers ----------

export const PLUGIN_THEME_TOKENS = ['bg', 'panel', 'panel-2', 'border', 'text', 'muted', 'accent', 'accent-2', 'danger'] as const
export const PLUGIN_MIN_HEIGHT = 40
export const PLUGIN_MAX_HEIGHT = 2400
export const PLUGIN_DEFAULT_HEIGHT = 120
const MIN_HEIGHT = PLUGIN_MIN_HEIGHT
const MAX_HEIGHT = PLUGIN_MAX_HEIGHT
const DEFAULT_HEIGHT = PLUGIN_DEFAULT_HEIGHT

/** Resolved theme colors keyed by token name without the leading "--". */
export function readTheme(el: Element): Record<string, string> {
  const style = getComputedStyle(el)
  const theme: Record<string, string> = {}
  for (const name of PLUGIN_THEME_TOKENS) {
    const v = style.getPropertyValue(`--${name}`).trim()
    if (v) theme[name] = v
  }
  return theme
}

/** JSON round-trip: drops anything not JSON-serializable. undefined/unserializable → null. */
export function cleanData(data: unknown): unknown {
  try {
    const json = JSON.stringify(data)
    return json === undefined ? null : JSON.parse(json)
  } catch {
    return null
  }
}

function dataKey(data: unknown): string {
  try { return JSON.stringify(data ?? null) } catch { return '' }
}

function parseDataAttr(raw: string | null): unknown {
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

// ---------- block visibility (v0.7, workstream 1A) ----------

export const PLUGIN_VISIBILITIES = ['all', 'editors', 'owners'] as const
export type PluginVisibility = (typeof PLUGIN_VISIBILITIES)[number]

export const PLUGIN_VISIBILITY_LABELS: Record<PluginVisibility, string> = {
  all: 'Everyone',
  editors: 'Editors & owners',
  owners: 'Owners only',
}

function asVisibility(v: unknown): PluginVisibility {
  return PLUGIN_VISIBILITIES.includes(v as PluginVisibility) ? (v as PluginVisibility) : 'all'
}

/**
 * Client-side gating, like secret blocks: the block's data still reaches every
 * member via the page row. Content that players must never receive belongs in
 * secret pages or DM notes (both RLS-enforced).
 */
function roleAllows(visibleTo: PluginVisibility, role: Role | null): boolean {
  if (visibleTo === 'owners') return role === 'owner'
  if (visibleTo === 'editors') return role === 'owner' || role === 'editor'
  return true
}

// ---------- node ----------

export interface PluginBlockOptions {
  /** Project whose plugins to resolve; null = the currently loaded project (usePages). */
  projectId: string | null
  /** false forces read-only (previews); otherwise follows editor.isEditable. */
  canEdit: boolean
}

export const PluginBlock = Node.create<PluginBlockOptions>({
  name: 'pluginBlock',
  group: 'block',
  atom: true,
  selectable: true,
  // v0.7 (3A): draggable via the header grip only (the node view arms dom.draggable).
  draggable: true,

  addOptions() {
    return { projectId: null, canEdit: true }
  },

  addAttributes() {
    return {
      pluginId: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-plugin-id') ?? '',
        renderHTML: (attrs) => ({ 'data-plugin-id': attrs.pluginId }),
      },
      data: {
        default: null,
        parseHTML: (el) => parseDataAttr(el.getAttribute('data-plugin-data')),
        renderHTML: (attrs) => (attrs.data == null ? {} : { 'data-plugin-data': dataKey(attrs.data) }),
      },
      /** v0.7: who sees the block ('all' | 'editors' | 'owners'). Client-side gating. */
      visibleTo: {
        default: 'all' as PluginVisibility,
        parseHTML: (el) => asVisibility(el.getAttribute('data-plugin-visible-to')),
        renderHTML: (attrs) =>
          asVisibility(attrs.visibleTo) === 'all' ? {} : { 'data-plugin-visible-to': asVisibility(attrs.visibleTo) },
      },
      /** v0.7: optional custom header title (defaults to the plugin's name). */
      title: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-plugin-title'),
        renderHTML: (attrs) => (attrs.title ? { 'data-plugin-title': String(attrs.title) } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-plugin-block]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-plugin-block': '', class: 'plugin-block' })]
  },

  renderText: () => '',

  addNodeView() {
    const { projectId, canEdit } = this.options
    return ({ node: initial, editor, getPos }) => createPluginView(initial, editor, getPos, projectId, canEdit)
  },
})

function createPluginView(
  initial: PMNode,
  editor: Editor,
  getPos: () => number | undefined,
  optProjectId: string | null,
  optCanEdit: boolean,
) {
  let node = initial
  let destroyed = false
  let iframe: HTMLIFrameElement | null = null
  let height = DEFAULT_HEIGHT
  let pluginName = 'Plugin'
  // Last data the host knows the plugin has; avoids echoing init back after set-data.
  let knownData = dataKey(node.attrs.data)

  const canEdit = () => optCanEdit && editor.isEditable

  const dom = document.createElement('div')
  dom.className = 'plugin-block'
  dom.setAttribute('data-plugin-block', '')

  const header = document.createElement('div')
  header.className = 'plugin-block-header'
  const title = document.createElement('span')
  title.className = 'plugin-block-title'
  title.textContent = pluginName
  const gate = document.createElement('span')
  gate.className = 'plugin-block-gate'
  gate.hidden = true
  if (canEdit()) header.append(makeDragHandle(dom, () => editor.isEditable))
  header.append(glyphElement('plugin', 'plugin-block-glyph'), title, gate)

  /** Header text follows the custom title and visibility attrs. */
  function paintHeader() {
    title.textContent = (typeof node.attrs.title === 'string' && node.attrs.title) || pluginName
    const vis = asVisibility(node.attrs.visibleTo)
    gate.hidden = vis === 'all'
    if (vis !== 'all') {
      gate.replaceChildren(glyphElement('lock', 'plugin-block-gate-glyph'),
        document.createTextNode(PLUGIN_VISIBILITY_LABELS[vis]))
      gate.title = 'Hidden from anyone below this role (on their screen — not a security boundary)'
    }
  }

  function setAttr(name: 'visibleTo' | 'title', value: string | null) {
    const pos = getPos()
    if (typeof pos !== 'number' || !editor.isEditable) return
    const current = editor.state.doc.nodeAt(pos)
    if (!current || current.type.name !== 'pluginBlock') return
    editor.view.dispatch(editor.state.tr.setNodeAttribute(pos, name, value))
  }

  // ---- block settings popover (canEdit only) ----
  let settingsPop: HTMLDivElement | null = null
  let settingsBtn: HTMLButtonElement | null = null

  function closeSettings() {
    settingsPop?.remove()
    settingsPop = null
    document.removeEventListener('pointerdown', onDocDown, true)
    document.removeEventListener('keydown', onPopKey)
  }
  function onDocDown(e: PointerEvent) {
    const t = e.target as globalThis.Node | null
    if (settingsPop && t && !settingsPop.contains(t) && !settingsBtn?.contains(t)) closeSettings()
  }
  function onPopKey(e: KeyboardEvent) {
    if (e.key === 'Escape') closeSettings()
  }

  function openSettings() {
    if (settingsPop) return closeSettings()
    if (!settingsBtn) return
    const pop = document.createElement('div')
    pop.className = 'plugin-settings-pop'
    pop.setAttribute('role', 'dialog')
    pop.setAttribute('aria-label', 'Plugin block settings')

    const visLabel = document.createElement('label')
    visLabel.className = 'plugin-settings-field'
    visLabel.append('Visible to')
    const select = document.createElement('select')
    const myRole = visibilityRole(usePages.getState())
    for (const vis of PLUGIN_VISIBILITIES) {
      const opt = document.createElement('option')
      opt.value = vis
      opt.textContent = PLUGIN_VISIBILITY_LABELS[vis]
      // An editor picking "Owners only" would hide the block from themselves.
      opt.disabled = vis === 'owners' && myRole !== 'owner'
      select.append(opt)
    }
    select.value = asVisibility(node.attrs.visibleTo)
    select.addEventListener('change', () => setAttr('visibleTo', asVisibility(select.value)))
    visLabel.append(select)

    const hint = document.createElement('p')
    hint.className = 'plugin-settings-hint'
    hint.textContent = 'Hides the block on lower-role screens. Data players must never receive belongs on a secret page or in DM notes.'

    const titleLabel = document.createElement('label')
    titleLabel.className = 'plugin-settings-field'
    titleLabel.append('Title')
    const input = document.createElement('input')
    input.type = 'text'
    input.maxLength = 60
    input.placeholder = pluginName
    input.value = typeof node.attrs.title === 'string' ? node.attrs.title : ''
    const commitTitle = () => {
      const clean = input.value.trim()
      if (clean === ((node.attrs.title as string | null) ?? '')) return
      setAttr('title', clean || null)
    }
    input.addEventListener('change', commitTitle)
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commitTitle(); closeSettings() } })
    titleLabel.append(input)

    pop.append(visLabel, hint, titleLabel)
    document.body.append(pop)
    const r = settingsBtn.getBoundingClientRect()
    const w = Math.min(260, window.innerWidth - 16)
    pop.style.width = `${w}px`
    pop.style.left = `${Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))}px`
    pop.style.top = `${Math.min(r.bottom + 4, window.innerHeight - pop.offsetHeight - 8)}px`
    document.addEventListener('pointerdown', onDocDown, true)
    document.addEventListener('keydown', onPopKey)
    settingsPop = pop
  }

  if (canEdit()) {
    const settings = document.createElement('button')
    settings.type = 'button'
    settings.className = 'plugin-block-settings'
    settings.title = 'Block settings'
    settings.setAttribute('aria-label', 'Plugin block settings')
    settings.tabIndex = -1
    settings.append(glyphElement('sliders', 'plugin-block-settings-glyph'))
    settings.addEventListener('mousedown', (e) => e.preventDefault())
    settings.addEventListener('click', openSettings)
    settingsBtn = settings

    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'plugin-block-remove'
    remove.title = 'Remove block'
    remove.setAttribute('aria-label', 'Remove plugin block')
    remove.textContent = '×'
    remove.tabIndex = -1
    remove.addEventListener('mousedown', (e) => e.preventDefault())
    remove.addEventListener('click', () => {
      const pos = getPos()
      if (typeof pos !== 'number' || !editor.isEditable) return
      editor.view.dispatch(editor.state.tr.delete(pos, pos + node.nodeSize))
    })
    header.append(settings, remove)
  }

  const body = document.createElement('div')
  body.className = 'plugin-block-body'
  const status = document.createElement('div')
  status.className = 'plugin-block-status'
  status.textContent = 'Loading plugin…'
  body.append(status)
  dom.append(header, body)

  function showStatus(text: string, missing = false) {
    status.textContent = text
    dom.classList.toggle('plugin-block-missing', missing)
    body.replaceChildren(status)
  }

  function post(msg: Record<string, unknown>) {
    // Opaque-origin frame: '*' is the only target origin that reaches it.
    iframe?.contentWindow?.postMessage(msg, '*')
  }

  function sendInit() {
    knownData = dataKey(node.attrs.data)
    post({
      type: 'archivarius:init',
      data: node.attrs.data ?? null,
      canEdit: canEdit(),
      // v0.7: the viewer's BASE project role ('owner' | 'editor' | 'viewer' | null), so plugins
      // can adapt (e.g. a GM-only panel). Follows the preview role while "view as player" is on.
      role: effectiveRole(usePages.getState()),
      // v0.7: the custom-role label when one is assigned (e.g. "Co-GM"); display only.
      roleName: usePages.getState().roleName,
      theme: readTheme(dom),
    })
  }

  function onMessage(event: MessageEvent) {
    if (!iframe || event.source !== iframe.contentWindow) return
    const msg = event.data as unknown
    if (!msg || typeof msg !== 'object') return
    const type = (msg as { type?: unknown }).type
    if (typeof type !== 'string' || !type.startsWith('archivarius:')) return
    const m = msg as Record<string, unknown>

    switch (type) {
      case 'archivarius:ready':
        // Also fires again whenever the frame reloads.
        sendInit()
        break
      case 'archivarius:set-data': {
        if (!canEdit()) return
        const pos = getPos()
        if (typeof pos !== 'number') return
        const current = editor.state.doc.nodeAt(pos)
        if (!current || current.type.name !== 'pluginBlock') return
        const data = cleanData(m.data)
        const key = dataKey(data)
        knownData = key
        if (key === dataKey(current.attrs.data)) return
        editor.view.dispatch(editor.state.tr.setNodeAttribute(pos, 'data', data))
        break
      }
      case 'archivarius:resize': {
        const h = Number(m.height)
        if (!Number.isFinite(h)) return
        height = Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, h)))
        iframe.style.height = `${height}px`
        break
      }
      case 'archivarius:open-page':
        if (typeof m.pageId === 'string' && m.pageId) usePanelStore.getState().openPreview(m.pageId)
        break
    }
  }
  window.addEventListener('message', onMessage)

  async function resolve() {
    const pluginId = node.attrs.pluginId as string
    const projectId = optProjectId || usePages.getState().projectId
    if (!pluginId || !projectId) return showStatus('Plugin not found', true)
    try {
      let plugin = (await loadPlugins(projectId)).find((p) => p.id === pluginId)
      // Cache may predate an upload made in another tab/dialog.
      if (!plugin && !destroyed) plugin = (await loadPlugins(projectId, true)).find((p) => p.id === pluginId)
      if (destroyed) return
      if (!plugin) return showStatus('Plugin not found', true)
      pluginName = plugin.name
      paintHeader()
      const source = await loadSource(plugin)
      if (destroyed) return
      const frame = document.createElement('iframe')
      // Sandbox before srcdoc/attachment so the document never runs unsandboxed.
      frame.setAttribute('sandbox', 'allow-scripts')
      frame.setAttribute('referrerpolicy', 'no-referrer')
      frame.title = plugin.name
      frame.className = 'plugin-block-frame'
      frame.style.height = `${height}px`
      frame.srcdoc = source
      iframe = frame
      body.replaceChildren(frame)
    } catch (e) {
      if (!destroyed) showStatus(`Couldn't load plugin: ${(e as Error).message}`, true)
    }
  }

  // Resolve lazily: a block gated above the current role never loads its iframe.
  let resolveStarted = false
  function applyGate() {
    const ok = roleAllows(asVisibility(node.attrs.visibleTo), visibilityRole(usePages.getState()))
    dom.hidden = !ok
    if (ok && !resolveStarted) {
      resolveStarted = true
      void resolve()
    }
  }
  paintHeader()
  applyGate()

  return {
    dom,
    update(updated: PMNode) {
      if (updated.type !== node.type || updated.attrs.pluginId !== node.attrs.pluginId) return false
      node = updated
      paintHeader()
      applyGate()
      // External change (undo/redo, collaborative reload): re-init the plugin with the new data.
      if (iframe && dataKey(node.attrs.data) !== knownData) sendInit()
      return true
    },
    stopEvent: (e: Event) =>
      (e.target as HTMLElement | null)?.closest?.('.plugin-block-remove, .plugin-block-settings') != null,
    ignoreMutation: () => true,
    destroy() {
      destroyed = true
      closeSettings()
      window.removeEventListener('message', onMessage)
      iframe = null
    },
  }
}

/** The configured pluginBlock project id for an editor (null = current project). */
export function pluginProjectId(editor: Editor): string | null {
  const ext = editor.extensionManager.extensions.find((e) => e.name === 'pluginBlock')
  const id = (ext?.options as PluginBlockOptions | undefined)?.projectId
  return id || usePages.getState().projectId
}
