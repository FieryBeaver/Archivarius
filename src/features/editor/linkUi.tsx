import type { EditorView } from '@tiptap/pm/view'
import { getMarkRange } from '@tiptap/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BLOCK_ICONS } from './blockIcons'

/*
 * External links (v0.9). The mark is StarterKit v3's bundled Link (no extra dependency),
 * configured by LINK_OPTIONS: only http/https/mailto hrefs are accepted (anything else — e.g.
 * javascript: or data: — is refused on set, paste and parse, and rendered with an empty href).
 * Opening is always ours (window.open with noopener/noreferrer), never the anchor's own default:
 *  - edit mode: click puts the caret and shows a bubble (href · Edit · Remove); Ctrl/Cmd+click opens;
 *  - read-only (ReadOnlyDoc, viewers, player preview): a plain click opens in a new tab.
 */

// ---------- href validation ----------

const ALLOWED = /^(https?:\/\/|mailto:)/i

/** True for hrefs we allow in documents: http(s) URLs and mailto. */
export function isAllowedHref(href: unknown): boolean {
  if (typeof href !== 'string') return false
  // Browsers ignore embedded whitespace/control chars in schemes ("java\nscript:").
  const clean = href.replace(/[\s\u0000-\u001f\u007f]/g, '')
  if (!ALLOWED.test(clean)) return false
  try {
    const url = new URL(clean)
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:'
  } catch {
    return false
  }
}

/**
 * Normalizes what a user typed into a link field: adds https:// to bare domains and mailto: to
 * bare e-mail addresses. Returns null when the result isn't an allowed href.
 */
export function normalizeHref(raw: string): string | null {
  const v = raw.trim()
  if (!v) return null
  let candidate = v
  if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) {
    if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(v)) candidate = `mailto:${v}`
    else if (/^(\/\/)?[^\s/]+\.[^\s/]{2,}/.test(v)) candidate = `https://${v.replace(/^\/\//, '')}`
    else return null
  }
  if (!isAllowedHref(candidate)) return null
  // Reject an empty host ("https://").
  if (/^https?:/i.test(candidate)) {
    try { if (!new URL(candidate).hostname) return null } catch { return null }
  }
  return candidate
}

/** StarterKit.configure({ link: LINK_OPTIONS }) for DocEditor and ReadOnlyDoc. */
export const LINK_OPTIONS = {
  // Opening is handled by openLink (see top comment); the mark's own click handler stays off.
  openOnClick: false,
  enableClickSelection: false,
  autolink: true,
  linkOnPaste: true,
  defaultProtocol: 'https',
  HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer nofollow', class: 'doc-link' },
  isAllowedUri: (url: string) => isAllowedHref(url),
  shouldAutoLink: (url: string) => isAllowedHref(url) || /^[^\s@]+\.[a-z]{2,}/i.test(url),
} as const

/** Opens an allowed href in a new tab without giving it a handle on this window. */
export function openLink(href: string | null | undefined): void {
  if (!href || !isAllowedHref(href)) return
  window.open(href, '_blank', 'noopener,noreferrer')
}

/** The <a> inside `root` that `target` is in, if any. */
export function linkElementAt(target: EventTarget | null, root: HTMLElement): HTMLAnchorElement | null {
  const a = (target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null
  return a && root.contains(a) ? a : null
}

/** Read-only views: a click on a link opens it in a new tab (React onClick on the editor wrapper). */
export function openLinkFromClick(e: { target: EventTarget | null; currentTarget: HTMLElement; preventDefault(): void }): boolean {
  const a = linkElementAt(e.target, e.currentTarget)
  if (!a) return false
  e.preventDefault()
  openLink(a.getAttribute('href'))
  return true
}

// ---------- mark helpers ----------

/** The full range of the link mark around `pos`, with its href. */
export function linkRangeAt(view: EditorView, pos: number): { from: number; to: number; href: string } | null {
  const type = view.state.schema.marks.link
  if (!type) return null
  const doc = view.state.doc
  const clamp = Math.max(0, Math.min(pos, doc.content.size))
  const $pos = doc.resolve(clamp)
  // At a link's end the mark is on nodeBefore; getMarkRange checks both sides.
  const range = getMarkRange($pos, type)
  if (!range) return null
  let href = ''
  doc.nodesBetween(range.from, range.to, (node) => {
    const mark = type.isInSet(node.marks)
    if (mark && !href) href = String(mark.attrs.href ?? '')
  })
  return { ...range, href }
}

/** Sets (or with null removes) the link on [from, to). */
export function applyLink(view: EditorView, from: number, to: number, href: string | null): void {
  const type = view.state.schema.marks.link
  if (!type || view.isDestroyed || from >= to) return
  const tr = view.state.tr.removeMark(from, to, type)
  if (href) tr.addMark(from, to, type.create({ href }))
  // Keep the autolink plugin from re-deriving links over our explicit change.
  tr.setMeta('preventAutolink', true)
  view.dispatch(tr)
  view.focus()
}

// ---------- floating host (shared by the selection menu, link field and link bubble) ----------

let closeOpen: (() => void) | null = null

export interface FloatingOptions {
  className?: string
  /** Called after Escape closes the popup (e.g. refocus the editor). */
  onEscape?: () => void
  /** When the popup doesn't fit below `y`, its bottom goes here (default: `y`). */
  flipY?: number
}

/**
 * Mounts a fixed-position popup at (x, y), kept inside the viewport (re-measured as its content
 * changes). Closes on Escape, outside mousedown, scrolling outside it, resize or window blur.
 * Only one is open at a time. `render` gets the close function. Returns close.
 */
export function openFloating(x: number, y: number, opts: FloatingOptions, render: (close: () => void) => ReactNode): () => void {
  closeOpen?.()

  const host = document.createElement('div')
  host.className = `mention-popup ${opts.className ?? ''}`.trim()
  host.style.position = 'fixed'
  host.style.left = `${x}px`
  host.style.top = `${y}px`
  document.body.append(host)
  const root = createRoot(host)

  function place() {
    const r = host.getBoundingClientRect()
    const left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8))
    let top = y
    if (y + r.height > window.innerHeight - 8) top = Math.max(8, (opts.flipY ?? y) - r.height)
    host.style.left = `${left}px`
    host.style.top = `${top}px`
  }
  const observer = new ResizeObserver(place)
  observer.observe(host)

  let closed = false
  function close() {
    if (closed) return
    closed = true
    if (closeOpen === close) closeOpen = null
    observer.disconnect()
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
  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    close()
    opts.onEscape?.()
  }
  // Scrolling the page closes the popup; scrolling inside it (a list) doesn't.
  function onScroll(e: Event) {
    if (!host.contains(e.target as globalThis.Node)) close()
  }
  document.addEventListener('mousedown', onOutside, true)
  document.addEventListener('keydown', onKey, true)
  window.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', close)
  window.addEventListener('blur', close)

  root.render(render(close))
  return close
}

/** Closes whichever floating popup is open (link bubble, link field, selection menu). */
export function closeFloating(): void {
  closeOpen?.()
}

// ---------- link field ----------

interface LinkFieldProps {
  initial: string
  /** An existing link is being edited (offers Remove). */
  editing: boolean
  onApply(href: string): void
  onRemove(): void
  onCancel(): void
}

/** URL input: Enter applies, Escape cancels (handled by the floating host). */
export function LinkField({ initial, editing, onApply, onRemove, onCancel }: LinkFieldProps) {
  const [value, setValue] = useState(initial || 'https://')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // The editor (re)takes focus on a deferred tick after the menu click, so focus+select here
    // in a frame, then check once more shortly after: if focus went back to the editor (or
    // anywhere else) re-focus the field, so stray keystrokes can't land in the document.
    const focusField = () => {
      const el = inputRef.current
      if (!el || !el.isConnected) return
      el.focus({ preventScroll: true })
      el.select()
    }
    const frame = requestAnimationFrame(focusField)
    const timer = window.setTimeout(() => {
      if (inputRef.current && document.activeElement !== inputRef.current) focusField()
    }, 60)
    return () => { cancelAnimationFrame(frame); window.clearTimeout(timer) }
  }, [])

  function submit() {
    const v = value.trim()
    if (!v || v === 'https://') {
      if (editing) onRemove()
      else onCancel()
      return
    }
    const href = normalizeHref(v)
    if (!href) {
      setError('Only http(s) and mailto links are allowed.')
      return
    }
    onApply(href)
  }

  return (
    <form className="mention-list link-field" aria-label={editing ? 'Edit link' : 'Add link'}
      onSubmit={(e) => { e.preventDefault(); submit() }}>
      <div className="link-field-row">
        <span className="link-field-glyph" aria-hidden dangerouslySetInnerHTML={{ __html: BLOCK_ICONS.link }} />
        <input ref={inputRef} autoFocus className="plugin-picker-search link-field-input" type="text" inputMode="url"
          spellCheck={false} autoComplete="off" placeholder="https://…" aria-label="Link address"
          value={value} onChange={(e) => { setValue(e.target.value); setError(null) }} />
      </div>
      {error && <div className="link-field-error" role="alert">{error}</div>}
      <div className="link-field-actions">
        {editing && <button type="button" className="btn-danger" onClick={onRemove}>Remove</button>}
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn-primary">{editing ? 'Save' : 'Add link'}</button>
      </div>
    </form>
  )
}

/**
 * Opens the link field for [from, to) at (x, y). With an existing link (`editing`), the range is
 * the link's full extent and Remove is offered.
 */
export function openLinkField(view: EditorView, from: number, to: number, initial: string, at: { x: number; y: number; flipY?: number }): void {
  const editing = !!initial
  const refocus = () => { if (!view.isDestroyed) view.focus() }
  openFloating(at.x, at.y, { className: 'link-field-popup', onEscape: refocus, flipY: at.flipY }, (close) => (
    <LinkField initial={initial} editing={editing}
      onApply={(href) => { close(); applyLink(view, from, to, href) }}
      onRemove={() => { close(); applyLink(view, from, to, null) }}
      onCancel={() => { close(); refocus() }} />
  ))
}

/**
 * Toolbar / keyboard entry: the link under the caret (edit) or the current selection (add).
 * Returns false when there is nothing to link (empty selection outside a link).
 */
export function openLinkFieldForSelection(view: EditorView): boolean {
  const { from, to, empty } = view.state.selection
  const existing = linkRangeAt(view, from)
  const inLink = existing && (empty || (from >= existing.from && to <= existing.to))
  if (!inLink && empty) return false
  const range = inLink ? existing : { from, to, href: '' }
  const start = view.coordsAtPos(range.from)
  const end = view.coordsAtPos(range.to)
  openLinkField(view, range.from, range.to, range.href, { x: start.left, y: end.bottom + 6, flipY: start.top - 6 })
  return true
}

// ---------- link bubble (edit mode) ----------

function shortHref(href: string): string {
  const s = href.replace(/^mailto:/i, '').replace(/^https?:\/\//i, '').replace(/\/$/, '')
  return s.length > 48 ? `${s.slice(0, 47)}…` : s
}

interface BubbleProps {
  href: string
  onEdit(): void
  onRemove(): void
}

function LinkBubble({ href, onEdit, onRemove }: BubbleProps) {
  return (
    <div className="mention-list link-bubble" role="dialog" aria-label="Link">
      <a className="link-bubble-href" href={href} target="_blank" rel="noopener noreferrer nofollow" title={href}
        onClick={(e) => { e.preventDefault(); openLink(href) }}>
        <span aria-hidden dangerouslySetInnerHTML={{ __html: BLOCK_ICONS.link }} />
        <span className="link-bubble-text">{shortHref(href)}</span>
      </a>
      <button type="button" className="btn-ghost link-bubble-btn" onMouseDown={(e) => e.preventDefault()} onClick={onEdit}>Edit</button>
      <button type="button" className="btn-danger link-bubble-btn" onMouseDown={(e) => e.preventDefault()} onClick={onRemove}>Remove</button>
    </div>
  )
}

/**
 * editorProps.handleClick (editable docs): Ctrl/Cmd+click on a link opens it; a plain click
 * lets ProseMirror place the caret and shows the bubble under the link.
 */
export function linkClickHandler(view: EditorView, pos: number, event: MouseEvent): boolean {
  if (event.button !== 0) return false
  const a = linkElementAt(event.target, view.dom)
  if (!a) return false
  if (event.metaKey || event.ctrlKey) {
    event.preventDefault()
    openLink(a.getAttribute('href'))
    return true
  }
  if (!view.editable) return false
  const range = linkRangeAt(view, pos)
  if (!range || !range.href) return false
  const rect = a.getBoundingClientRect()
  const refocus = () => { if (!view.isDestroyed) view.focus() }
  const closeBubble = openFloating(rect.left, rect.bottom + 6, { className: 'link-bubble-popup', onEscape: refocus, flipY: rect.top - 6 }, (close) => (
    <LinkBubble href={range.href}
      onEdit={() => {
        close()
        openLinkField(view, range.from, range.to, range.href, { x: rect.left, y: rect.bottom + 6, flipY: rect.top - 6 })
      }}
      onRemove={() => { close(); applyLink(view, range.from, range.to, null) }} />
  ))
  // Typing in the editor dismisses the bubble (a no-op if it already closed).
  view.dom.addEventListener('keydown', closeBubble, { once: true })
  return false
}
