import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { PageIcon } from '../lib/icons'
import type { Page } from '../lib/types'
import { pagePath, useVisiblePages } from '../state/pages'
import LockIcon from './LockIcon'
import './QuickSwitcher.css'

const LIMIT = 50

interface Result {
  page: Page
  /** Ancestor titles, root first, joined with " / ". */
  path: string
}

/** Lower = better. null = no match. */
function score(title: string, q: string): number | null {
  if (!q) return 0
  if (title === q) return 0
  if (title.startsWith(q)) return 1
  if (title.split(/[\s\-_/]+/).some((w) => w.startsWith(q))) return 2
  const at = title.indexOf(q)
  if (at >= 0) return 3 + at / 1000
  // Fuzzy: every character in order.
  let i = 0
  for (const ch of title) if (ch === q[i]) i++
  return i === q.length ? 5 : null
}

function parentPath(byId: Map<string, Page>, page: Page): string {
  const out: string[] = []
  const seen = new Set<string>()
  let cur = page.parent_id ? byId.get(page.parent_id) : undefined
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    out.unshift(cur.title || 'Untitled')
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined
  }
  return out.join(' / ')
}

/** Ctrl/Cmd+K page finder over the loaded pages store. */
export default function QuickSwitcher({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const pages = useVisiblePages()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

  const results = useMemo<Result[]>(() => {
    const byId = new Map(pages.map((p) => [p.id, p]))
    const q = query.trim().toLowerCase()
    let ranked: Page[]
    if (!q) {
      // No query: most recently edited first.
      ranked = [...pages].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    } else {
      ranked = pages
        .map((p) => ({ p, s: score((p.title || 'Untitled').toLowerCase(), q) }))
        .filter((r): r is { p: Page; s: number } => r.s !== null)
        .sort((a, b) => a.s - b.s || a.p.title.length - b.p.title.length)
        .map((r) => r.p)
    }
    return ranked.slice(0, LIMIT).map((page) => ({ page, path: parentPath(byId, page) }))
  }, [pages, query])

  // Keep the highlight in range as results change.
  const current = Math.min(active, Math.max(0, results.length - 1))

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${current}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [current])

  function go(page: Page) {
    onClose()
    navigate(pagePath(page.project_id, page.id))
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((current + 1) % Math.max(1, results.length))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((current - 1 + results.length) % Math.max(1, results.length))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const r = results[current]
      if (r) go(r.page)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
  }

  return createPortal(
    <div className="qs-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="qs-panel" role="dialog" aria-modal="true" aria-label="Go to page" onKeyDown={onKeyDown}>
        <input className="qs-input" autoFocus placeholder="Go to page…" aria-label="Search pages"
          role="combobox" aria-expanded="true" aria-controls="qs-results"
          aria-activedescendant={results[current] ? `qs-${results[current].page.id}` : undefined}
          value={query} onChange={(e) => { setQuery(e.target.value); setActive(0) }} />
        {results.length === 0 ? (
          <p className="qs-empty">{pages.length ? `No pages match “${query.trim()}”.` : 'No pages yet.'}</p>
        ) : (
          <ul ref={listRef} id="qs-results" className="qs-list" role="listbox">
            {!query.trim() && <li className="qs-label" role="presentation">Recent</li>}
            {results.map(({ page, path }, i) => (
              <li key={page.id} id={`qs-${page.id}`} data-index={i} role="option" aria-selected={i === current}
                className={`qs-item${i === current ? ' active' : ''}${page.is_secret ? ' secret' : ''}`}
                onPointerMove={() => i !== current && setActive(i)}
                onClick={() => go(page)}>
                <span className="qs-icon"><PageIcon page={page} /></span>
                <span className="qs-text">
                  <span className="qs-title">{page.title || 'Untitled'}</span>
                  {path && <span className="qs-path">{path}</span>}
                </span>
                {page.is_secret && <LockIcon size={12} className="qs-lock" />}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  )
}
