import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as db from '../lib/db'
import type { Page } from '../lib/types'
import { pagePath } from '../state/pages'
import { pageIcon } from './pageIcon'

type Backlink = Pick<Page, 'id' | 'title' | 'kind'>

interface Props {
  projectId: string
  pageId: string
}

/** Right-hand context panel. Renders nothing when it has nothing to show. */
export default function ContextPanel({ projectId, pageId }: Props) {
  const navigate = useNavigate()
  const [backlinks, setBacklinks] = useState<Backlink[]>([])
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
          {backlinks.map((b) => (
            <li key={b.id}>
              <button className="context-link" onClick={() => navigate(pagePath(projectId, b.id))}>
                <span>{pageIcon(b)}</span>
                <span>{b.title || 'Untitled'}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  )
}
