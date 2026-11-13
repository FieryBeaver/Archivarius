import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ICON_CHOICES, searchIcons, type IconChoice } from '../lib/icons'
import './IconPicker.css'

interface Props {
  /** Current icon string ("gi:<Name>" or an emoji), or null for none / kind default. */
  value: string | null
  /** Called with a "gi:<Name>" id, an emoji string, or null (reset). */
  onSelect: (icon: string | null) => void
}

/**
 * Icon chooser panel: search, categorized Game Icons grid, free emoji input, reset.
 * No positioning or floating wrapper — the caller places it (e.g. inside a Popover).
 * Escape is not handled here, so it bubbles to the caller.
 */
export default function IconPicker({ value, onSelect }: Props) {
  const [query, setQuery] = useState('')
  const [emoji, setEmoji] = useState(() => (value && !value.startsWith('gi:') ? value : ''))
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    searchRef.current?.focus({ preventScroll: true })
  }, [])

  const results = useMemo(() => (query.trim() ? searchIcons(query, 500) : null), [query])

  function submitEmoji(e: FormEvent) {
    e.preventDefault()
    const v = emoji.trim()
    if (v) onSelect(v)
  }

  const grid = (icons: IconChoice[]) => (
    <div className="icon-picker-grid">
      {icons.map(({ id, name, Icon }) => (
        <button key={id} type="button" title={name} aria-label={name} aria-pressed={id === value}
          className={`icon-picker-cell${id === value ? ' selected' : ''}`}
          onClick={() => onSelect(id)}>
          <Icon aria-hidden="true" />
        </button>
      ))}
    </div>
  )

  return (
    <div className="icon-picker" role="dialog" aria-label="Choose an icon">
      <input ref={searchRef} className="icon-picker-search" type="search" placeholder="Search icons…"
        aria-label="Search icons" value={query} onChange={(e) => setQuery(e.target.value)} />

      <div className="icon-picker-scroll">
        {results ? (
          results.length ? (
            <section>
              <h4 className="icon-picker-label">Results</h4>
              {grid(results)}
            </section>
          ) : (
            <p className="icon-picker-empty">No icons match “{query.trim()}”.</p>
          )
        ) : (
          ICON_CHOICES.map((cat) => (
            <section key={cat.category}>
              <h4 className="icon-picker-label">{cat.category}</h4>
              {grid(cat.icons)}
            </section>
          ))
        )}
      </div>

      <form className="icon-picker-footer" onSubmit={submitEmoji}>
        <input className="icon-picker-emoji" placeholder="or type an emoji" aria-label="Emoji icon"
          maxLength={16} value={emoji} onChange={(e) => setEmoji(e.target.value)} />
        <button type="submit" className="icon-picker-btn" disabled={!emoji.trim()}>Use</button>
        <button type="button" className="icon-picker-btn icon-picker-reset" onClick={() => onSelect(null)}>
          No icon / reset
        </button>
      </form>
    </div>
  )
}
