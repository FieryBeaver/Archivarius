import { TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { useLayoutEffect, useState, type KeyboardEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { pageIcon } from '../../components/pageIcon'
import type { Page } from '../../lib/types'
import { useVisiblePages, usePages } from '../../state/pages'
import { BLOCK_ICONS } from './blockIcons'
import { showImageNote } from './imageBlock'

/*
 * Right-click on a text selection in an editable doc: "New subpage from selection" (creates a
 * child doc page titled with the text and replaces the text with a mention of it) and
 * "Link to existing page…" (replaces the text with a mention of a picked page).
 * Mentions are { type: 'mention', attrs: { id, label } } (CONTRACT) — the same node the "@"
 * suggestion inserts — so autosave's extractMentionIds/replaceMentions sync backlinks as usual.
 */

const TITLE_MAX = 80

/** Selected text → page title: whitespace collapsed, trimmed, capped; "Untitled" if empty. */
export function titleFromSelection(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return 'Untitled'
  return clean.length > TITLE_MAX ? `${clean.slice(0, TITLE_MAX - 1).trimEnd()}…` : clean
}

interface Target {
  view: EditorView
  /** Range to replace (selection minus leading/trailing whitespace when that is safe). */
  from: number
  to: number
  /** doc.textBetween(from, to) at open time; re-checked before replacing. */
  text: string
  pageId: string
}

function textOf(view: EditorView, from: number, to: number): string {
  return view.state.doc.textBetween(from, to, ' ', ' ')
}

/** Replaces the target range with a mention, unless the text changed while we were busy. */
function replaceWithMention(t: Target, page: Pick<Page, 'id' | 'title'>): boolean {
  const { view } = t
  if (view.isDestroyed) return false
  const type = view.state.schema.nodes.mention
  if (!type || t.to > view.state.doc.content.size || textOf(view, t.from, t.to) !== t.text) return false
  const node = type.create({ id: page.id, label: page.title })
  const tr = view.state.tr.replaceWith(t.from, t.to, node)
  tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(t.to)))
  view.dispatch(tr.scrollIntoView())
  view.focus()
  return true
}

async function newSubpage(t: Target): Promise<void> {
  let page: Page
  try {
    page = await usePages.getState().create(t.pageId, 'doc', undefined, { title: titleFromSelection(t.text) })
  } catch (e) {
    showImageNote(`Couldn’t create the page: ${(e as Error).message}`)
    return
  }
  if (!replaceWithMention(t, page)) {
    showImageNote(`Created “${page.title}”, but the text changed meanwhile — it wasn’t linked.`)
  }
}

interface MenuProps {
  host: HTMLElement
  x: number
  y: number
  currentPageId: string
  onNewSubpage(): void
  onLink(page: Page): void
}

function SelectionMenu({ host, x, y, currentPageId, onNewSubpage, onLink }: MenuProps) {
  const [mode, setMode] = useState<'menu' | 'link'>('menu')
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const pages = useVisiblePages()

  const q = query.trim().toLowerCase()
  const items = mode === 'link'
    ? pages.filter((p) => p.id !== currentPageId && (!q || (p.title || 'Untitled').toLowerCase().includes(q))).slice(0, 8)
    : []
  const active = Math.min(index, Math.max(0, items.length - 1))

  // At the pointer, flipped to stay inside the viewport; re-run when the content grows.
  useLayoutEffect(() => {
    const r = host.getBoundingClientRect()
    let left = x
    let top = y
    if (left + r.width > window.innerWidth - 8) left = Math.max(8, x - r.width)
    if (top + r.height > window.innerHeight - 8) top = Math.max(8, y - r.height)
    host.style.left = `${left}px`
    host.style.top = `${top}px`
  }, [host, x, y, mode, items.length])

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' && items.length) {
      e.preventDefault()
      setIndex((active + 1) % items.length)
    } else if (e.key === 'ArrowUp' && items.length) {
      e.preventDefault()
      setIndex((active - 1 + items.length) % items.length)
    } else if (e.key === 'Enter' && items[active]) {
      e.preventDefault()
      onLink(items[active])
    }
  }

  if (mode === 'menu') {
    return (
      <div className="mention-list selection-menu" role="menu" aria-label="Selection actions">
        <button type="button" role="menuitem" className="mention-option slash-option"
          onMouseDown={(e) => { e.preventDefault(); onNewSubpage() }}>
          <span className="slash-glyph" aria-hidden dangerouslySetInnerHTML={{ __html: BLOCK_ICONS.pagePlus }} />
          <span className="mention-option-title">New subpage from selection</span>
        </button>
        <button type="button" role="menuitem" className="mention-option slash-option"
          onMouseDown={(e) => { e.preventDefault(); setMode('link') }}>
          <span className="slash-glyph" aria-hidden dangerouslySetInnerHTML={{ __html: BLOCK_ICONS.link }} />
          <span className="mention-option-title">Link to existing page…</span>
        </button>
      </div>
    )
  }

  return (
    <div className="mention-list slash-list plugin-picker selection-menu" role="dialog" aria-label="Link to page">
      <input className="plugin-picker-search" autoFocus placeholder="Search pages…" value={query}
        onChange={(e) => { setQuery(e.target.value); setIndex(0) }} onKeyDown={onKeyDown} />
      <div role="listbox" className="plugin-picker-items">
        {!items.length && <div className="mention-empty plugin-picker-empty">No matching pages</div>}
        {items.map((p, i) => (
          <button key={p.id} type="button" role="option" aria-selected={i === active}
            className={`mention-option${i === active ? ' active' : ''}`}
            onMouseEnter={() => setIndex(i)}
            onMouseDown={(e) => { e.preventDefault(); onLink(p) }}>
            <span>{pageIcon(p)}</span>
            <span className="mention-option-title">{p.title || 'Untitled'}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

let closeOpen: (() => void) | null = null

function openSelectionMenu(target: Target, x: number, y: number): void {
  closeOpen?.()

  const host = document.createElement('div')
  host.className = 'mention-popup selection-menu-popup'
  host.style.position = 'fixed'
  host.style.left = `${x}px`
  host.style.top = `${y}px`
  document.body.append(host)
  const root = createRoot(host)

  let closed = false
  function close() {
    if (closed) return
    closed = true
    if (closeOpen === close) closeOpen = null
    document.removeEventListener('mousedown', onOutside, true)
    document.removeEventListener('keydown', onKey, true)
    window.removeEventListener('scroll', onScroll, true)
    window.removeEventListener('resize', close)
    window.removeEventListener('blur', close)
    // Defer unmount: close can run from inside a React handler of this root.
    queueMicrotask(() => { root.unmount(); host.remove() })
  }
  closeOpen = close

  function onOutside(e: MouseEvent) {
    if (!host.contains(e.target as globalThis.Node)) close()
  }
  function onKey(e: globalThis.KeyboardEvent) {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    close()
    if (!target.view.isDestroyed) target.view.focus()
  }
  // Scrolling the page closes the menu; scrolling inside it (the page list) doesn't.
  function onScroll(e: Event) {
    if (!host.contains(e.target as globalThis.Node)) close()
  }
  document.addEventListener('mousedown', onOutside, true)
  document.addEventListener('keydown', onKey, true)
  window.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', close)
  window.addEventListener('blur', close)

  root.render(
    <SelectionMenu host={host} x={x} y={y} currentPageId={target.pageId}
      onNewSubpage={() => { close(); void newSubpage(target) }}
      onLink={(page) => {
        close()
        if (!replaceWithMention(target, page)) showImageNote('The text changed meanwhile — nothing was linked.')
      }} />,
  )
}

/** Whether (x, y) falls on the rendered DOM selection. */
function pointOnSelection(x: number, y: number): boolean {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false
  for (let i = 0; i < sel.rangeCount; i++) {
    for (const r of sel.getRangeAt(i).getClientRects()) {
      if (x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 2 && y <= r.bottom + 2) return true
    }
  }
  return false
}

/**
 * editorProps.handleDOMEvents.contextmenu (editable docs only). Takes over the right-click only
 * when it lands on a non-empty text selection outside image/plugin blocks and code; otherwise
 * returns false and the browser's own menu appears.
 */
export function selectionContextMenu(pageId: string) {
  return (view: EditorView, event: MouseEvent): boolean => {
    if (!view.editable) return false
    const { selection, doc, schema } = view.state
    if (!(selection instanceof TextSelection) || selection.empty || !schema.nodes.mention) return false
    const el = event.target as HTMLElement | null
    if (el?.closest?.('.image-block, .plugin-block')) return false
    const { $from, $to } = selection
    if ($from.parent.type.spec.code || $to.parent.type.spec.code) return false
    if (!pointOnSelection(event.clientX, event.clientY)) return false

    let { from, to } = selection
    const raw = doc.textBetween(from, to, ' ', ' ')
    if (!raw.trim()) return false
    // Keep surrounding spaces outside the mention when the range is plain text in one block.
    if ($from.sameParent($to) && raw.length === to - from) {
      from += raw.length - raw.trimStart().length
      to -= raw.length - raw.trimEnd().length
    }

    event.preventDefault()
    openSelectionMenu({ view, from, to, text: textOf(view, from, to), pageId }, event.clientX, event.clientY)
    return true
  }
}
