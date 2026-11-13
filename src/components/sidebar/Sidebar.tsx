import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { PageKind } from '../../lib/types'
import { pagePath, usePages } from '../../state/pages'
import KindPicker from './KindPicker'
import PageTree from './PageTree'
import './Sidebar.css'

interface Props {
  projectId: string
  projectName: string
}

export default function Sidebar({ projectId, projectName }: Props) {
  const navigate = useNavigate()
  const status = usePages((s) => s.status)
  const loadError = usePages((s) => s.error)
  const isEmpty = usePages((s) => s.pages.length === 0)
  const create = usePages((s) => s.create)
  const [pickerAnchor, setPickerAnchor] = useState<DOMRect | null>(null)
  const [error, setError] = useState<string | null>(null)

  function addRoot(kind: PageKind) {
    setPickerAnchor(null)
    setError(null)
    create(null, kind).then(
      (page) => navigate(pagePath(projectId, page.id)),
      (e: Error) => setError(e.message),
    )
  }

  return (
    <nav className="sidebar">
      <header className="sidebar-header">
        <Link to="/" className="sidebar-back" title="All worlds">‹</Link>
        <Link to={`/project/${projectId}`} className="sidebar-project">{projectName}</Link>
      </header>

      <div className="sidebar-section">
        <span>Pages</span>
        <button className="tree-action" aria-label="Add page"
          onClick={(e) => setPickerAnchor(e.currentTarget.getBoundingClientRect())}>+</button>
      </div>
      {pickerAnchor && <KindPicker anchor={pickerAnchor} onPick={addRoot} onClose={() => setPickerAnchor(null)} />}

      <div className="sidebar-body">
        {error && <p className="error-text tree-error">{error}</p>}
        {status === 'error' && <p className="error-text tree-error">{loadError}</p>}
        {status === 'ready' && isEmpty && <p className="sidebar-empty">No pages yet — hit + to begin.</p>}
        <PageTree projectId={projectId} />
      </div>
    </nav>
  )
}
