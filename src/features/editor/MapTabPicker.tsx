import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { PageIcon } from '../../lib/icons'
import type { Page } from '../../lib/types'
import { useVisiblePages } from '../../state/pages'

interface MapTabPickerProps {
  /** "New map" row (creates a map page under the note); omitted = existing maps only. */
  onNew?(): void
  onPick(map: Page): void
  onClose(): void
  /** Map page to leave out (e.g. the one a tab already shows). */
  excludeId?: string
}

type Item = { kind: 'new' } | { kind: 'map'; page: Page }

/**
 * The tab strip's "Map tab…" chooser: a new map, or any map page of the world.
 * Lists map pages from the loaded tree (what this user can read, minus hidden secrets).
 * Same look and keyboard handling as PluginPicker.
 */
export function MapTabPicker({ onNew, onPick, onClose, excludeId }: MapTabPickerProps) {
  const pages = useVisiblePages()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const q = query.trim().toLowerCase()
  const maps = pages
    .filter((p) => p.kind === 'map' && p.id !== excludeId)
    .filter((p) => !q || (p.title || 'Untitled').toLowerCase().includes(q))
    .sort((a, b) => (a.title || 'Untitled').localeCompare(b.title || 'Untitled'))
  const items: Item[] = [
    ...(onNew && !q ? [{ kind: 'new' } as const] : []),
    ...maps.map((page) => ({ kind: 'map', page }) as const),
  ]
  const active = Math.min(index, Math.max(0, items.length - 1))

  useEffect(() => {
    listRef.current?.querySelector('.active')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function choose(item: Item) {
    if (item.kind === 'new') onNew?.()
    else onPick(item.page)
  }

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
      choose(items[active])
    }
  }

  const empty = maps.length ? null : q ? 'No matching maps' : 'No maps in this world yet.'

  return (
    <div className="mention-list slash-list plugin-picker" role="dialog" aria-label="Choose a map">
      <input className="plugin-picker-search" autoFocus placeholder="Search maps…" value={query}
        onChange={(e) => { setQuery(e.target.value); setIndex(0) }} onKeyDown={onKeyDown} />
      <div role="listbox" ref={listRef} className="plugin-picker-items">
        {items.map((item, i) => (
          <button key={item.kind === 'new' ? '+new' : item.page.id} type="button" role="option"
            aria-selected={i === active}
            className={`mention-option slash-option${i === active ? ' active' : ''}`}
            onMouseEnter={() => setIndex(i)}
            onMouseDown={(e) => { e.preventDefault(); choose(item) }}>
            {item.kind === 'new' ? (
              <>
                <span className="slash-glyph">+</span>
                <span className="mention-option-title">New map</span>
              </>
            ) : (
              <>
                <span className="slash-glyph"><PageIcon page={item.page} size={16} /></span>
                <span className="mention-option-title">{item.page.title || 'Untitled'}</span>
              </>
            )}
          </button>
        ))}
        {empty && <div className="mention-empty plugin-picker-empty">{empty}</div>}
      </div>
    </div>
  )
}
