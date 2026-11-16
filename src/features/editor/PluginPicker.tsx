import type { Editor } from '@tiptap/react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { renderIcon } from '../../lib/icons'
import type { Plugin } from '../../lib/types'
import { BLOCK_ICONS } from './blockIcons'
import { loadPlugins, pluginProjectId } from './pluginBlock'

interface PluginPickerProps {
  projectId: string | null
  onPick(plugin: Plugin): void
  onClose(): void
}

/** Plugin chooser: the slash menu's "Plugin…" item and the tab strip's "Plugin tab…" use it. */
export function PluginPicker({ projectId, onPick, onClose }: PluginPickerProps) {
  const [plugins, setPlugins] = useState<Plugin[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!projectId) {
      setPlugins([])
      return
    }
    let live = true
    loadPlugins(projectId, true).then(
      (rows) => { if (live) setPlugins(rows) },
      (e: Error) => { if (live) setError(e.message) },
    )
    return () => { live = false }
  }, [projectId])

  const q = query.trim().toLowerCase()
  const items = (plugins ?? []).filter((p) => !q || p.name.toLowerCase().includes(q))
  const active = Math.min(index, Math.max(0, items.length - 1))

  useEffect(() => {
    listRef.current?.querySelector('.active')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown' && items.length) {
      e.preventDefault()
      setIndex((active + 1) % items.length)
    } else if (e.key === 'ArrowUp' && items.length) {
      e.preventDefault()
      setIndex((active - 1 + items.length) % items.length)
    } else if ((e.key === 'Enter' || e.key === 'Tab') && items[active]) {
      e.preventDefault()
      onPick(items[active])
    }
  }

  let empty: string | null = null
  if (error) empty = `Couldn't load plugins: ${error}`
  else if (!plugins) empty = 'Loading plugins…'
  else if (!plugins.length) empty = 'No plugins uploaded yet. Add them in Settings → Plugins.'
  else if (!items.length) empty = 'No matching plugins'

  return (
    <div className="mention-list slash-list plugin-picker" role="dialog" aria-label="Insert plugin">
      <input className="plugin-picker-search" autoFocus placeholder="Search plugins…" value={query}
        onChange={(e) => { setQuery(e.target.value); setIndex(0) }} onKeyDown={onKeyDown} />
      <div role="listbox" ref={listRef} className="plugin-picker-items">
        {empty && <div className="mention-empty plugin-picker-empty">{empty}</div>}
        {items.map((p, i) => (
          <button key={p.id} type="button" role="option" aria-selected={i === active}
            className={`mention-option slash-option${i === active ? ' active' : ''}`}
            onMouseEnter={() => setIndex(i)}
            onMouseDown={(e) => { e.preventDefault(); onPick(p) }}>
            {p.icon
              ? <span className="slash-glyph">{renderIcon(p.icon)}</span>
              : <span className="slash-glyph slash-glyph-plugin" dangerouslySetInnerHTML={{ __html: BLOCK_ICONS.plugin }} />}
            <span className="mention-option-title">{p.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

let closeOpen: (() => void) | null = null

/**
 * Mounts a floating PluginPicker below (or above) `at`, a viewport rect. Closes on outside
 * mousedown, resize, Escape or a pick; only one is open at a time. Shared by the slash
 * command and a missing plugin's "Reconnect…" control.
 */
export function openFloatingPluginPicker(
  projectId: string | null,
  at: { left: number; top: number; bottom: number },
  onPick: (plugin: Plugin) => void,
  /** Escape inside the picker (not a pick or an outside click): callers may refocus. */
  onEscape?: () => void,
): void {
  closeOpen?.()

  const host = document.createElement('div')
  host.className = 'mention-popup plugin-picker-popup'
  host.style.position = 'fixed'
  const width = Math.min(320, window.innerWidth - 16)
  host.style.left = `${Math.max(8, Math.min(at.left, window.innerWidth - width - 8))}px`
  if (at.bottom + 320 > window.innerHeight && at.top > 320) {
    host.style.bottom = `${window.innerHeight - at.top + 4}px`
  } else {
    host.style.top = `${at.bottom + 4}px`
  }
  document.body.append(host)
  const root = createRoot(host)

  let closed = false
  function close() {
    if (closed) return
    closed = true
    if (closeOpen === close) closeOpen = null
    document.removeEventListener('mousedown', onOutside, true)
    window.removeEventListener('resize', close)
    // Defer unmount: close can run from inside a React handler of this root.
    queueMicrotask(() => { root.unmount(); host.remove() })
  }
  closeOpen = close

  function onOutside(e: MouseEvent) {
    if (!host.contains(e.target as globalThis.Node)) close()
  }
  document.addEventListener('mousedown', onOutside, true)
  window.addEventListener('resize', close)

  root.render(
    <PluginPicker projectId={projectId} onPick={(p) => { close(); onPick(p) }}
      onClose={() => { close(); onEscape?.() }} />,
  )
}

/**
 * Opens the picker at document position `pos` (an empty paragraph left by the slash command).
 * Choosing a plugin replaces that paragraph with { type: 'pluginBlock', attrs: { pluginId, data: null } }.
 */
export function openPluginPicker(editor: Editor, pos: number): void {
  const coords = editor.view.coordsAtPos(Math.min(pos, editor.state.doc.content.size))
  openFloatingPluginPicker(pluginProjectId(editor), coords, (plugin) => {
    if (editor.isDestroyed || !editor.isEditable) return
    const at = Math.min(pos, editor.state.doc.content.size)
    editor.chain().focus()
      .insertContentAt(at, { type: 'pluginBlock', attrs: { pluginId: plugin.id, data: null } })
      .run()
  }, () => { if (!editor.isDestroyed) editor.commands.focus() })
}
