import { TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { pageIcon } from '../../components/pageIcon'
import type { Page } from '../../lib/types'
import { rankByTitle } from '../../lib/titleRank'
import { useVisiblePages, usePages } from '../../state/pages'
import { BLOCK_ICONS } from './blockIcons'
import { showImageNote } from './imageBlock'
import { LinkField, applyLink, linkElementAt, linkRangeAt, openFloating } from './linkUi'
import { createTitleFor, titleFromText } from './newPageTitle'

/*
 * Right-click on a text selection in an editable doc: "New subpage from selection" (creates a
 * child doc page titled with the text and replaces the text with a mention of it) and
 * "Link to existing page…" (replaces the text with a mention of a picked page — or, via its
 * "+ Create “query”" row when no page has that exact title, of a new child page titled with the query).
 * Mentions are { type: 'mention', attrs: { id, label } } (CONTRACT) — the same node the "@"
 * suggestion inserts — so autosave's extractMentionIds/replaceMentions sync backlinks as usual.
 */

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

/** Creates a child doc page of the edited page (titled with the selection by default) and links the selection to it. */
async function newSubpage(t: Target, title = titleFromText(t.text)): Promise<void> {
  let page: Page
  try {
    page = await usePages.getState().create(t.pageId, 'doc', undefined, { title })
  } catch (e) {
    showImageNote(`Couldn’t create the page: ${(e as Error).message}`)
    return
  }
  if (!replaceWithMention(t, page)) {
    showImageNote(`Created “${page.title}”, but the text changed meanwhile — it wasn’t linked.`)
  }
}

type LinkRange = { from: number; to: number; href: string }

interface MenuProps {
  view: EditorView
  /** Non-empty text selection under the pointer (subpage / page link / add link), or null. */
  target: Target | null
  /** Existing link under the pointer (edit / remove), or null. */
  link: LinkRange | null
  currentPageId: string
  close(): void
}

function SelectionMenu({ view, target, link, currentPageId, close }: MenuProps) {
  const [mode, setMode] = useState<'menu' | 'page' | 'url'>('menu')
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  // "Link to existing page…" opens with the selected text as the search, selected so typing replaces it.
  useEffect(() => {
    if (mode !== 'page') return
    searchRef.current?.focus()
    searchRef.current?.select()
  }, [mode])
  const [index, setIndex] = useState(0)
  const pages = useVisiblePages()

  const q = query.trim().toLowerCase()
  const others = mode === 'page' ? pages.filter((p) => p.id !== currentPageId) : []
  // Best matches first (exact title, then prefix, then substring); no query: tree order.
  const items = (q ? rankByTitle(others, q, (p) => p.title || 'Untitled') : others).slice(0, 8)
  // "+ Create “query”" row after the matches (only when selection text can be linked).
  const newTitle = mode === 'page' && target ? createTitleFor(query, pages.map((p) => p.title)) : null
  const count = items.length + (newTitle ? 1 : 0)
  const active = Math.min(index, Math.max(0, count - 1))

  function linkPage(page: Page) {
    close()
    if (target && !replaceWithMention(target, page)) showImageNote('The text changed meanwhile — nothing was linked.')
  }

  function createAndLink(title: string) {
    close()
    if (target) void newSubpage(target, title)
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' && count) {
      e.preventDefault()
      setIndex((active + 1) % count)
    } else if (e.key === 'ArrowUp' && count) {
      e.preventDefault()
      setIndex((active - 1 + count) % count)
    } else if (e.key === 'Enter' && items[active]) {
      e.preventDefault()
      linkPage(items[active])
    } else if (e.key === 'Enter' && newTitle && active === items.length) {
      e.preventDefault()
      createAndLink(newTitle)
    }
  }

  const item = (icon: keyof typeof BLOCK_ICONS, label: string, run: () => void, danger = false) => (
    <button type="button" role="menuitem" className={`mention-option slash-option${danger ? ' selection-menu-danger' : ''}`}
      onMouseDown={(e) => { e.preventDefault(); run() }}>
      <span className="slash-glyph" aria-hidden dangerouslySetInnerHTML={{ __html: BLOCK_ICONS[icon] }} />
      <span className="mention-option-title">{label}</span>
    </button>
  )

  if (mode === 'url') {
    // Add a link to the selection, or edit the existing one (its full range).
    const range = link ?? (target ? { from: target.from, to: target.to, href: '' } : null)
    if (!range) return null
    const refocus = () => { if (!view.isDestroyed) view.focus() }
    return (
      <LinkField initial={range.href} editing={!!link}
        onApply={(href) => { close(); applyLink(view, range.from, range.to, href) }}
        onRemove={() => { close(); applyLink(view, range.from, range.to, null) }}
        onCancel={() => { close(); refocus() }} />
    )
  }

  if (mode === 'menu') {
    return (
      <div className="mention-list selection-menu" role="menu" aria-label="Selection actions">
        {target && item('pagePlus', 'New subpage from selection', () => { close(); void newSubpage(target) })}
        {target && item('link', 'Link to existing page…', () => {
          setQuery(target.text.replace(/\s+/g, ' ').trim().slice(0, 120))
          setIndex(0)
          setMode('page')
        })}
        {target && !link && item('link', 'Add link…', () => setMode('url'))}
        {link && item('link', 'Edit link…', () => setMode('url'))}
        {link && item('unlink', 'Remove link', () => { close(); applyLink(view, link.from, link.to, null) }, true)}
      </div>
    )
  }

  return (
    <div className="mention-list slash-list plugin-picker selection-menu" role="dialog" aria-label="Link to page">
      <input ref={searchRef} className="plugin-picker-search" autoFocus placeholder="Search pages…" value={query}
        onChange={(e) => { setQuery(e.target.value); setIndex(0) }} onKeyDown={onKeyDown} />
      <div role="listbox" className="plugin-picker-items">
        {!count && <div className="mention-empty plugin-picker-empty">No matching pages</div>}
        {items.map((p, i) => (
          <button key={p.id} type="button" role="option" aria-selected={i === active}
            className={`mention-option${i === active ? ' active' : ''}`}
            onMouseEnter={() => setIndex(i)}
            onMouseDown={(e) => { e.preventDefault(); linkPage(p) }}>
            <span>{pageIcon(p)}</span>
            <span className="mention-option-title">{p.title || 'Untitled'}</span>
          </button>
        ))}
        {newTitle && (
          <button type="button" role="option" aria-selected={active === items.length}
            className={`mention-option slash-option mention-create${active === items.length ? ' active' : ''}`}
            onMouseEnter={() => setIndex(items.length)}
            onMouseDown={(e) => { e.preventDefault(); createAndLink(newTitle) }}>
            <span className="slash-glyph" aria-hidden dangerouslySetInnerHTML={{ __html: BLOCK_ICONS.pagePlus }} />
            <span className="mention-option-title">Create “{newTitle}”</span>
          </button>
        )}
      </div>
    </div>
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

/** The text-selection target under the pointer, or null (see selectionContextMenu). */
function textTarget(view: EditorView, event: MouseEvent, pageId: string): Target | null {
  const { selection, doc, schema } = view.state
  if (!(selection instanceof TextSelection) || selection.empty || !schema.nodes.mention) return null
  const { $from, $to } = selection
  if ($from.parent.type.spec.code || $to.parent.type.spec.code) return null
  if (!pointOnSelection(event.clientX, event.clientY)) return null
  let { from, to } = selection
  const raw = doc.textBetween(from, to, ' ', ' ')
  if (!raw.trim()) return null
  // Keep surrounding spaces outside the mention/link when the range is plain text in one block.
  if ($from.sameParent($to) && raw.length === to - from) {
    from += raw.length - raw.trimStart().length
    to -= raw.length - raw.trimEnd().length
  }
  return { view, from, to, text: textOf(view, from, to), pageId }
}

/**
 * editorProps.handleDOMEvents.contextmenu (editable docs only). Takes over the right-click only
 * when it lands on a non-empty text selection (outside image/plugin blocks and code) or on an
 * existing link; otherwise returns false and the browser's own menu appears.
 */
export function selectionContextMenu(pageId: string) {
  return (view: EditorView, event: MouseEvent): boolean => {
    if (!view.editable) return false
    const el = event.target as HTMLElement | null
    if (el?.closest?.('.image-block, .plugin-block')) return false
    const target = textTarget(view, event, pageId)
    const a = linkElementAt(event.target, view.dom)
    let link: LinkRange | null = null
    if (a) {
      try { link = linkRangeAt(view, view.posAtDOM(a, 0)) } catch { link = null }
      if (link && !link.href) link = null
    }
    if (!target && !link) return false

    event.preventDefault()
    openFloating(event.clientX, event.clientY,
      { className: 'selection-menu-popup', onEscape: () => { if (!view.isDestroyed) view.focus() } },
      (close) => <SelectionMenu view={view} target={target} link={link} currentPageId={pageId} close={close} />)
    return true
  }
}
