import type { MentionNodeAttrs } from '@tiptap/extension-mention'
import type { SuggestionProps } from '@tiptap/suggestion'
import { useImperativeHandle, useState, type Ref } from 'react'
import { pageIcon } from '../../components/pageIcon'
import type { Page } from '../../lib/types'

export type MentionItem = Pick<Page, 'id' | 'title' | 'kind'>

export interface MentionListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean
}

/** Opt-in "+ Create “…”" row: creates a page and inserts a mention of it. */
export interface MentionCreate {
  /** The new page's title for this query, or null when no create row should show. */
  titleFor(query: string): string | null
  /** Creates the page and inserts the mention (reports its own failures). */
  run(title: string): Promise<void>
}

export type MentionListProps = SuggestionProps<MentionItem, MentionNodeAttrs> & {
  ref?: Ref<MentionListHandle>
  create?: MentionCreate
}

export default function MentionList({ items, query, command, create, ref }: MentionListProps) {
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [shownItems, setShownItems] = useState(items)
  if (items !== shownItems) {
    setShownItems(items)
    setIndex(0)
  }

  const newTitle = create?.titleFor(query) ?? null
  const count = items.length + (newTitle ? 1 : 0)
  const active = Math.min(index, Math.max(0, count - 1))

  const runCreate = async (title: string) => {
    if (busy || !create) return
    setBusy(true)
    try {
      await create.run(title)
    } finally {
      setBusy(false)
    }
  }

  const select = (i: number) => {
    if (busy) return
    const item = items[i]
    if (item) command({ id: item.id, label: item.title })
    else if (i === items.length && newTitle) void runCreate(newTitle)
  }

  useImperativeHandle(ref, () => ({
    onKeyDown(event) {
      // While a page is being created, swallow Enter/Tab so they don't reach the document.
      if (busy && (event.key === 'Enter' || event.key === 'Tab')) return true
      if (!count) return false
      if (event.key === 'ArrowDown') setIndex((active + 1) % count)
      else if (event.key === 'ArrowUp') setIndex((active - 1 + count) % count)
      else if (event.key === 'Enter' || event.key === 'Tab') select(active)
      else return false
      return true
    },
  }))

  return (
    <div className="mention-list" role="listbox">
      {count === 0 && <div className="mention-empty">No matching pages</div>}
      {items.map((item, i) => (
        <button key={item.id} role="option" aria-selected={i === active}
          className={`mention-option${i === active ? ' active' : ''}`}
          onMouseEnter={() => setIndex(i)}
          onMouseDown={(e) => { e.preventDefault(); select(i) }}>
          <span>{pageIcon(item)}</span>
          <span className="mention-option-title">{item.title || 'Untitled'}</span>
        </button>
      ))}
      {newTitle && (
        <button key="__create" role="option" aria-selected={active === items.length} aria-busy={busy || undefined}
          className={`mention-option mention-create${active === items.length ? ' active' : ''}`}
          onMouseEnter={() => setIndex(items.length)}
          onMouseDown={(e) => { e.preventDefault(); select(items.length) }}>
          <span aria-hidden>+</span>
          <span className="mention-option-title">{busy ? `Creating “${newTitle}”…` : `Create “${newTitle}”`}</span>
        </button>
      )}
    </div>
  )
}
