import type { SuggestionProps } from '@tiptap/suggestion'
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { BLOCK_ICONS } from './blockIcons'
import type { SlashItem } from './slashCommand'

export interface SlashListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean
}

export type SlashListProps = SuggestionProps<SlashItem, SlashItem> & {
  ref?: Ref<SlashListHandle>
}

/** Same surface and keyboard model as MentionList. */
export default function SlashList({ items, command, ref }: SlashListProps) {
  const [index, setIndex] = useState(0)
  const [shownItems, setShownItems] = useState(items)
  if (items !== shownItems) {
    setShownItems(items)
    setIndex(0)
  }
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listRef.current?.children[index]?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const select = (i: number) => {
    const item = items[i]
    if (item) command(item)
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
    <div className="mention-list slash-list" role="listbox" ref={listRef}>
      {items.length === 0 && <div className="mention-empty">No matching blocks</div>}
      {items.map((item, i) => (
        <button key={item.id} role="option" aria-selected={i === index}
          className={`mention-option slash-option${i === index ? ' active' : ''}`}
          onMouseEnter={() => setIndex(i)}
          onMouseDown={(e) => { e.preventDefault(); select(i) }}>
          {'text' in item.glyph
            ? <span className="slash-glyph slash-glyph-text">{item.glyph.text}</span>
            : <span className={`slash-glyph slash-glyph-${item.glyph.icon}`}
                dangerouslySetInnerHTML={{ __html: BLOCK_ICONS[item.glyph.icon] }} />}
          <span className="mention-option-title">{item.title}</span>
        </button>
      ))}
    </div>
  )
}
