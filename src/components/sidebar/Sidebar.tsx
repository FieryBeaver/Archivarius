import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { PageKind } from '../../lib/types'
import { pagePath, useCanEdit, usePages } from '../../state/pages'
import { GearGlyph, SearchGlyph, SidebarGlyph } from '../UiIcons'
import KindPicker from './KindPicker'
import PageTree from './PageTree'
import './Sidebar.css'

interface Props {
  projectId: string
  projectName: string
  /** Hidden off-canvas (mobile drawer closed): keep it out of focus order and a11y tree. */
  inert?: boolean
  /** Called when the user picks a page, so a mobile drawer can close. */
  onNavigate?: () => void
  /** Open the quick switcher. */
  onSearch?: () => void
  /** Open project settings. */
  onSettings?: () => void
  /** Collapse the sidebar (desktop only; the button is hidden on mobile). */
  onCollapse?: () => void
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

export default function Sidebar({ projectId, projectName, inert, onNavigate, onSearch, onSettings, onCollapse }: Props) {
  const navigate = useNavigate()
  const status = usePages((s) => s.status)
  const loadError = usePages((s) => s.error)
  const isEmpty = usePages((s) => s.pages.length === 0)
  const create = usePages((s) => s.create)
  const canEdit = useCanEdit()
  const [pickerAnchor, setPickerAnchor] = useState<DOMRect | null>(null)
  const [error, setError] = useState<string | null>(null)

  function addRoot(kind: PageKind) {
    setPickerAnchor(null)
    setError(null)
    create(null, kind).then(
      (page) => { onNavigate?.(); navigate(pagePath(projectId, page.id)) },
      (e: Error) => setError(e.message),
    )
  }

  return (
    <nav className="sidebar" inert={inert}>
      <header className="sidebar-header">
        <Link to="/" className="sidebar-back" title="All worlds">‹</Link>
        <Link to={`/project/${projectId}`} className="sidebar-project" onClick={onNavigate}>{projectName}</Link>
        {onSearch && (
          <button type="button" className="sidebar-icon-btn" aria-label="Search pages"
            title={`Search pages (${isMac ? '⌘' : 'Ctrl+'}K)`} onClick={onSearch}>
            <SearchGlyph />
          </button>
        )}
        {onCollapse && (
          <button type="button" className="sidebar-icon-btn sidebar-collapse" aria-label="Collapse sidebar"
            title="Collapse sidebar" onClick={onCollapse}>
            <SidebarGlyph />
          </button>
        )}
      </header>

      <div className="sidebar-section">
        <span>Pages</span>
        {canEdit && (
          <button className="tree-action" aria-label="Add page"
            onClick={(e) => setPickerAnchor(e.currentTarget.getBoundingClientRect())}>+</button>
        )}
      </div>
      {pickerAnchor && canEdit && (
        <KindPicker anchor={pickerAnchor} onPick={addRoot} onClose={() => setPickerAnchor(null)} />
      )}

      <div className="sidebar-body">
        {error && <p className="error-text tree-error">{error}</p>}
        {status === 'error' && <p className="error-text tree-error">{loadError}</p>}
        {status === 'ready' && isEmpty && (
          <p className="sidebar-empty">{canEdit ? 'No pages yet — hit + to begin.' : 'No pages yet.'}</p>
        )}
        <PageTree projectId={projectId} onNavigate={onNavigate} />
      </div>

      {onSettings && (
        <footer className="sidebar-footer">
          <button type="button" className="sidebar-footer-btn" onClick={onSettings}>
            <GearGlyph /><span>World settings</span>
          </button>
        </footer>
      )}
    </nav>
  )
}
