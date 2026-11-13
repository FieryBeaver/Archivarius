import { useEffect, useRef, useState, type JSX } from 'react'
import { getPage, searchPages } from '../../lib/db'
import type { Page } from '../../lib/types'
import { kindIcon } from './constants'

type PageRef = Pick<Page, 'id' | 'title' | 'kind'>

interface Props {
  projectId: string
  /** The current map page; excluded from results. */
  excludeId: string
  value: string | null
  onChange: (pageId: string | null) => void
  onOpen?: (pageId: string) => void
}

export default function PageLinkPicker({
  projectId,
  excludeId,
  value,
  onChange,
  onOpen,
}: Props): JSX.Element {
  const [target, setTarget] = useState<PageRef | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PageRef[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const reqId = useRef(0)

  // Resolve the linked page's title.
  useEffect(() => {
    if (!value || target?.id === value) return
    let cancelled = false
    getPage(value)
      .then((p) => {
        if (!cancelled) setTarget({ id: p.id, title: p.title, kind: p.kind })
      })
      .catch(() => {
        if (!cancelled) setTarget({ id: value, title: '(missing page)', kind: 'doc' })
      })
    return () => {
      cancelled = true
    }
  }, [value, target?.id])

  // Debounced search while the result list is open.
  useEffect(() => {
    if (!open) return
    const id = ++reqId.current
    const t = window.setTimeout(() => {
      setLoading(true)
      searchPages(projectId, query.trim())
        .then((rows) => {
          if (id === reqId.current) setResults(rows.filter((r) => r.id !== excludeId))
        })
        .catch(() => {
          if (id === reqId.current) setResults([])
        })
        .finally(() => {
          if (id === reqId.current) setLoading(false)
        })
    }, 180)
    return () => window.clearTimeout(t)
  }, [open, query, projectId, excludeId])

  function pick(p: PageRef) {
    setTarget(p)
    setQuery('')
    setOpen(false)
    onChange(p.id)
  }

  return (
    <div className="wk-link">
      {value && target?.id === value ? (
        <div className="wk-link__current">
          <button
            type="button"
            className="wk-link__target"
            title="Open linked page"
            onClick={() => onOpen?.(target.id)}
          >
            <span aria-hidden>{kindIcon(target.kind)}</span>
            <span className="wk-link__title">{target.title || 'Untitled'}</span>
          </button>
          <button
            type="button"
            className="wk-icon-btn"
            title="Remove link"
            aria-label="Remove link"
            onClick={() => onChange(null)}
          >
            ×
          </button>
        </div>
      ) : null}
      <input
        className="wk-link__search"
        type="search"
        placeholder={value ? 'Change linked page…' : 'Search pages to link…'}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            setOpen(false)
          } else if (e.key === 'Enter' && results[0]) {
            e.preventDefault()
            pick(results[0])
          }
        }}
      />
      {open && (
        <ul className="wk-link__results" role="listbox">
          {loading && results.length === 0 && <li className="wk-link__empty">Searching…</li>}
          {!loading && results.length === 0 && <li className="wk-link__empty">No pages found</li>}
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className={`wk-link__result${r.id === value ? ' is-active' : ''}`}
                // mousedown so the pick lands before the input's blur closes the list
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(r)
                }}
              >
                <span aria-hidden>{kindIcon(r.kind)}</span>
                <span className="wk-link__title">{r.title || 'Untitled'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
