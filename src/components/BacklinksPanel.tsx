import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as db from '../lib/db'
import type { Page } from '../lib/types'
import { PageIcon } from '../lib/icons'
import { pagePath, usePages } from '../state/pages'
import LockIcon from './LockIcon'

type Backlink = Pick<Page, 'id' | 'title' | 'kind'>

interface Props {
  projectId: string
  pageId: string
}

/** Backlinks ("Mentioned in") column. Renders nothing when it has nothing to show. */
export default function BacklinksPanel({ projectId, pageId }: Props) {
  const navigate = useNavigate()
  const [backlinks, setBacklinks] = useState<Backlink[]>([])
  // Backlink rows carry no icon / secrecy; take those from the loaded tree when available.
  const pages = usePages((s) => s.pages)
  // Only matters on mobile, where the panel sits below the content (the toggle is hidden on desktop).
  const [collapsed, setCollapsed] = useState(true)

  useEffect(() => {
    let live = true
    db.listBacklinks(pageId).then(
      (rows) => live && setBacklinks(rows),
      () => live && setBacklinks([]),
    )
    return () => { live = false }
  }, [pageId])

  if (backlinks.length === 0) return null

  return (
    <aside className={`context-panel${collapsed ? ' collapsed' : ''}`}>
      <section className="context-section">
        <h3>Mentioned in</h3>
        <button className="context-toggle" aria-expanded={!collapsed} onClick={() => setCollapsed((c) => !c)}>
          Mentioned in<span className="context-toggle-count">({backlinks.length})</span>
        </button>
        <ul className="context-list">
          {backlinks.map((b) => {
            const full = pages.find((p) => p.id === b.id)
            return (
              <li key={b.id}>
                <button className={`context-link${full?.is_secret ? ' secret' : ''}`}
                  onClick={() => navigate(pagePath(projectId, b.id))}>
                  <span className="context-link-icon"><PageIcon page={{ kind: b.kind, icon: full?.icon ?? null }} /></span>
                  <span className="context-link-title">{full?.title || b.title || 'Untitled'}</span>
                  {full?.is_secret && <LockIcon size={11} className="context-link-lock" />}
                </button>
              </li>
            )
          })}
        </ul>
      </section>
    </aside>
  )
}
