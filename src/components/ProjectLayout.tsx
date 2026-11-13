import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'
import * as db from '../lib/db'
import type { Project } from '../lib/types'
import { usePages } from '../state/pages'
import ContextPanel from './ContextPanel'
import EmptyState from './EmptyState'
import Sidebar from './sidebar/Sidebar'
import { useIsMobile } from './useMediaQuery'
import './ProjectLayout.css'

/** undefined = loading, null = not found / no access */
function useProject(projectId: string): Project | null | undefined {
  const [result, setResult] = useState<{ id: string; project: Project | null } | null>(null)
  useEffect(() => {
    let live = true
    db.listProjects().then(
      (list) => live && setResult({ id: projectId, project: list.find((p) => p.id === projectId) ?? null }),
      () => live && setResult({ id: projectId, project: null }),
    )
    return () => { live = false }
  }, [projectId])
  return result?.id === projectId ? result.project : undefined
}

export default function ProjectLayout() {
  const { projectId = '', pageId } = useParams()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const project = useProject(projectId)
  const load = usePages((s) => s.load)
  const pageTitle = usePages((s) => (pageId ? s.pages.find((p) => p.id === pageId)?.title : undefined))
  const isMobile = useIsMobile()

  // Mobile drawer: remembers the route it was opened on, so any navigation closes it.
  const [drawerPath, setDrawerPath] = useState<string | null>(null)
  const drawerOpen = isMobile && drawerPath === pathname
  const closeDrawer = () => setDrawerPath(null)

  useEffect(() => {
    load(projectId)
  }, [projectId, load])

  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerPath(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  if (project === null) {
    return <EmptyState message="This world doesn't exist, or you don't have access to it."
      actionLabel="Back to your worlds" onAction={() => navigate('/')} />
  }

  const context = pageId && <ContextPanel key={pageId} projectId={projectId} pageId={pageId} />

  return (
    <div className={`layout${drawerOpen ? ' drawer-open' : ''}`}>
      <header className="mobile-topbar">
        <button className="mobile-topbar-btn" aria-label="Open pages" aria-expanded={drawerOpen}
          onClick={() => setDrawerPath(pathname)}>
          <span className="hamburger" aria-hidden />
        </button>
        <span className="mobile-topbar-title">{(pageId ? pageTitle || 'Untitled' : project?.name) ?? ''}</span>
        <Link to="/" className="mobile-topbar-btn mobile-topbar-back" title="All worlds">Worlds</Link>
      </header>

      <Sidebar projectId={projectId} projectName={project?.name ?? ''}
        inert={isMobile && !drawerOpen} onNavigate={closeDrawer} />
      <div className="drawer-scrim" aria-hidden onClick={closeDrawer} />

      <main className="layout-main">
        <Outlet />
        {isMobile && context}
      </main>
      {!isMobile && context}
    </div>
  )
}
