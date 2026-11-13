import type { MentionNodeAttrs } from '@tiptap/extension-mention'
import type { SuggestionProps } from '@tiptap/suggestion'
import { useImperativeHandle, useState, type Ref } from 'react'
import { pageIcon } from '../../components/pageIcon'
import type { Page } from '../../lib/types'

export type MentionItem = Pick<Page, 'id' | 'title' | 'kind'>

export interface MentionListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean
}

export type MentionListProps = SuggestionProps<MentionItem, MentionNodeAttrs> & {
  ref?: Ref<MentionListHandle>
}

export default function MentionList({ items, command, ref }: MentionListProps) {
  const [index, setIndex] = useState(0)
  const [shownItems, setShownItems] = useState(items)
  if (items !== shownItems) {
    setShownItems(items)
    setIndex(0)
  }

  const select = (i: number) => {
    const item = items[i]
    if (item) command({ id: item.id, label: item.title })
  }

  useImperativeHandle(ref, () => ({
    onKeyDown(event) {
      if (!items.length) return false
      if (event.key === 'ArrowDown') setIndex((index + 1) % items.length)
      else if (event.key === 'ArrowUp') setIndex((index - 1 + items.length) % items.length)
      else if (event.key === 'Enter' || event.key === 'Tab') select(index)
      else return false
      return true
    },
  }))

  return (
    <div className="mention-list" role="listbox">
      {items.length === 0 && <div className="mention-empty">No matching pages</div>}
      {items.map((item, i) => (
        <button key={item.id} role="option" aria-selected={i === index}
          className={`mention-option${i === index ? ' active' : ''}`}
          onMouseEnter={() => setIndex(i)}
          onMouseDown={(e) => { e.preventDefault(); select(i) }}>
          <span>{pageIcon(item)}</span>
          <span className="mention-option-title">{item.title || 'Untitled'}</span>
        </button>
      ))}
    </div>
  )
}
