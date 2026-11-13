import { useEffect, useRef, useState } from 'react'
import * as db from '../../lib/db'
import { PageIcon } from '../../lib/icons'
import type { Page } from '../../lib/types'

type PageHit = Pick<Page, 'id' | 'title' | 'kind'>

interface Props {
  projectId: string
  excludeId: string
  value: { id: string; title: string } | null
  onChange: (v: { id: string; title: string } | null) => void
}

export default function PageLinkPicker({ projectId, excludeId, value, onChange }: Props) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<PageHit[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const reqId = useRef(0)

  useEffect(() => {
    if (!open) return
    const id = ++reqId.current
    const t = window.setTimeout(() => {
      db.searchPages(projectId, query.trim())
        .then((rows) => {
          if (id !== reqId.current) return
          setHits(rows.filter((r) => r.id !== excludeId))
          setActive(0)
        })
        .catch(() => {
          if (id === reqId.current) setHits([])
        })
    }, 180)
    return () => window.clearTimeout(t)
  }, [query, open, projectId, excludeId])

  function pick(hit: PageHit) {
    onChange({ id: hit.id, title: hit.title || 'Untitled' })
    setQuery('')
    setOpen(false)
  }

  if (value) {
    return (
      <div className="tl-link-selected">
        <span className="tl-chip tl-chip--static"><span aria-hidden="true">→</span> {value.title}</span>
        <button type="button" className="tl-btn-ghost" onClick={() => onChange(null)}>
          Clear
        </button>
      </div>
    )
  }

  return (
    <div className="tl-picker">
      <input
        type="text"
        value={query}
        placeholder="Search pages to link…"
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (!open || hits.length === 0) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((a) => (a + 1) % hits.length)
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => (a - 1 + hits.length) % hits.length)
          } else if (e.key === 'Enter') {
            e.preventDefault()
            pick(hits[active])
          } else if (e.key === 'Escape') {
            e.stopPropagation()
            setOpen(false)
          }
        }}
      />
      {open && hits.length > 0 && (
        <ul className="tl-picker-list" role="listbox">
          {hits.map((h, i) => (
            <li
              key={h.id}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'is-active' : undefined}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(h)
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="tl-picker-kind" aria-hidden="true">
                <PageIcon page={{ kind: h.kind, icon: null }} size={16} />
              </span>
              <span className="tl-picker-title">{h.title || 'Untitled'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
