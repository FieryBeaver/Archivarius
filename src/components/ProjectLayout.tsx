import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'
import * as db from '../lib/db'
import type { Project } from '../lib/types'
import { usePages } from '../state/pages'
import ContextPanel from './ContextPanel'
import EmptyState from './EmptyState'
import ErrorBoundary from './ErrorBoundary'
import QuickSwitcher from './QuickSwitcher'
import Sidebar from './sidebar/Sidebar'
import { SearchGlyph, SidebarGlyph } from './UiIcons'
import { useIsMobile } from './useMediaQuery'
import './ProjectLayout.css'

const SettingsDialog = lazy(() => import('../features/settings/SettingsDialog'))

const COLLAPSE_KEY = 'wk.sidebarCollapsed'

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}

function writeCollapsed(value: boolean) {
  try {
    window.localStorage.setItem(COLLAPSE_KEY, value ? '1' : '0')
  } catch {
    /* storage unavailable (private mode etc.) — collapse just won't persist */
  }
}

/** undefined = loading, null = not found / no access */
function useProject(projectId: string, version: number): Project | null | undefined {
  const [result, setResult] = useState<{ id: string; project: Project | null } | null>(null)
  useEffect(() => {
    let live = true
    db.listProjects().then(
      (list) => live && setResult({ id: projectId, project: list.find((p) => p.id === projectId) ?? null }),
      () => live && setResult({ id: projectId, project: null }),
    )
    return () => { live = false }
  }, [projectId, version])
  return result?.id === projectId ? result.project : undefined
}

export default function ProjectLayout() {
  const { projectId = '', pageId } = useParams()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  // Bumped after the settings dialog closes, so a rename shows up.
  const [projectVersion, setProjectVersion] = useState(0)
  const project = useProject(projectId, projectVersion)
  const load = usePages((s) => s.load)
  const pageTitle = usePages((s) => (pageId ? s.pages.find((p) => p.id === pageId)?.title : undefined))
  const isMobile = useIsMobile()

  // Mobile drawer: remembers the route it was opened on, so any navigation closes it.
  const [drawerPath, setDrawerPath] = useState<string | null>(null)
  const drawerOpen = isMobile && drawerPath === pathname
  const closeDrawer = () => setDrawerPath(null)

  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const sidebarHidden = !isMobile && collapsed

  const setSidebarCollapsed = (value: boolean) => {
    setCollapsed(value)
    writeCollapsed(value)
  }

  const openSwitcher = useCallback(() => {
    setDrawerPath(null)
    setSwitcherOpen(true)
  }, [])

  const closeSettings = useCallback(() => {
    setSettingsOpen(false)
    setProjectVersion((v) => v + 1)
  }, [])

  // Ctrl+K / Cmd+K anywhere (capture phase, so editors don't swallow it).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        e.stopPropagation()
        setDrawerPath(null)
        setSwitcherOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

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
    return <EmptyState glyph="✧" title="World not found" message="This world doesn't exist, or you don't have access to it."
      actionLabel="Back to your worlds" onAction={() => navigate('/')} />
  }

  const context = pageId && <ContextPanel key={pageId} projectId={projectId} pageId={pageId} />

  return (
    <div className={`layout${drawerOpen ? ' drawer-open' : ''}${sidebarHidden ? ' sidebar-collapsed' : ''}`}>
      <header className="mobile-topbar">
        <button className="mobile-topbar-btn" aria-label="Open pages" aria-expanded={drawerOpen}
          onClick={() => setDrawerPath(pathname)}>
          <span className="hamburger" aria-hidden />
        </button>
        <span className="mobile-topbar-title">{(pageId ? pageTitle || 'Untitled' : project?.name) ?? ''}</span>
        <button className="mobile-topbar-btn" aria-label="Search pages" onClick={openSwitcher}>
          <SearchGlyph />
        </button>
        <Link to="/" className="mobile-topbar-btn mobile-topbar-back" title="All worlds">Worlds</Link>
      </header>

      {!sidebarHidden && (
        <Sidebar projectId={projectId} projectName={project?.name ?? ''}
          inert={isMobile && !drawerOpen} onNavigate={closeDrawer}
          onSearch={openSwitcher}
          onSettings={project ? () => { setDrawerPath(null); setSettingsOpen(true) } : undefined}
          onCollapse={isMobile ? undefined : () => setSidebarCollapsed(true)} />
      )}
      {sidebarHidden && (
        <button className="sidebar-reopen" aria-label="Open sidebar" title="Open sidebar"
          onClick={() => setSidebarCollapsed(false)}>
          <SidebarGlyph />
        </button>
      )}
      <div className="drawer-scrim" aria-hidden onClick={closeDrawer} />

      <main className="layout-main">
        <Outlet />
        {isMobile && context}
      </main>
      {!isMobile && context}

      {switcherOpen && <QuickSwitcher onClose={() => setSwitcherOpen(false)} />}
      {settingsOpen && project && (
        <ErrorBoundary resetKey={project.id} fallback={(error) => (
          <div className="layout-toast" role="alert">
            <span>Settings failed to load: {error.message}</span>
            <button className="btn-ghost" onClick={closeSettings}>Close</button>
          </div>
        )}>
          <Suspense fallback={null}>
            <SettingsDialog project={project} onClose={closeSettings} />
          </Suspense>
        </ErrorBoundary>
      )}
    </div>
  )
}
