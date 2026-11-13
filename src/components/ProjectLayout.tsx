import { lazy, Suspense, useCallback, useEffect, useState, type CSSProperties } from 'react'
import { Link, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'
import * as db from '../lib/db'
import type { Project, ThemeOverrides } from '../lib/types'
import { usePages } from '../state/pages'
import { usePanelStore } from '../state/panel'
import { useProjectRefresh } from '../state/project'
import BacklinksPanel from './BacklinksPanel'
import ContextPanel from './ContextPanel'
import EmptyState from './EmptyState'
import ErrorBoundary from './ErrorBoundary'
import QuickSwitcher from './QuickSwitcher'
import Sidebar from './sidebar/Sidebar'
import { EyeGlyph, SearchGlyph, SidebarGlyph } from './UiIcons'
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

/** ThemeOverrides key -> CSS custom property. Missing keys fall back to the stylesheet. */
const THEME_VARS: [keyof ThemeOverrides, string][] = [
  ['accent', '--accent'], ['accent2', '--accent-2'], ['bg', '--bg'], ['panel', '--panel'],
  ['panel2', '--panel-2'], ['border', '--border'], ['text', '--text'], ['muted', '--muted'],
]

function themeVars(theme: ThemeOverrides | null | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, cssVar] of THEME_VARS) {
    const value = theme?.[key]
    if (typeof value === 'string' && value.trim()) out[cssVar] = value.trim()
  }
  // Tokens the stylesheet defines as literals: derive them from the overridden bases so the
  // sidebar, floating surfaces and secondary text follow a light/dark theme too.
  // (--accent-soft/--accent-line/chips are already color-mix()es of --accent on :root.)
  if (out['--bg'] || out['--panel-2']) out['--sidebar-bg'] = 'color-mix(in srgb, var(--bg) 85%, var(--panel-2))'
  if (out['--panel'] || out['--panel-2']) out['--surface-float'] = 'color-mix(in srgb, var(--panel) 60%, var(--panel-2))'
  if (out['--text'] || out['--muted']) out['--text-dim'] = 'color-mix(in srgb, var(--text) 72%, var(--muted))'
  if (out['--border'] || out['--text']) out['--border-strong'] = 'color-mix(in srgb, var(--border) 78%, var(--text))'
  return out
}

/** True for a light #rgb/#rrggbb colour (anything unparseable counts as dark, the default). */
function isLight(color: string | undefined): boolean {
  const m = color?.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return false
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5
}

/**
 * Mirror the world theme onto <html> while the project is open. Popovers, dialogs and menus
 * portal to <body>, outside the layout root, and derived tints (--accent-soft, chips, focus
 * glow…) are computed on :root — both only follow the theme when it is set there too.
 */
function useRootTheme(vars: Record<string, string>) {
  const key = JSON.stringify(vars)
  useEffect(() => {
    const parsed = JSON.parse(key) as Record<string, string>
    // Native controls/scrollbars: the stylesheet says dark; flip for a light background.
    if (isLight(parsed['--bg'])) parsed['color-scheme'] = 'light'
    const entries = Object.entries(parsed)
    const root = document.documentElement.style
    for (const [name, value] of entries) root.setProperty(name, value)
    return () => {
      for (const [name] of entries) root.removeProperty(name)
    }
  }, [key])
}

export default function ProjectLayout() {
  const { projectId = '', pageId } = useParams()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  // Bumped after the settings dialog closes (or via refreshProject()), so renames and theme edits show up.
  const projectVersion = useProjectRefresh((s) => s.version)
  const refreshProject = useProjectRefresh((s) => s.refreshProject)
  const project = useProject(projectId, projectVersion)
  const theme = themeVars(project?.theme)
  useRootTheme(theme)
  const previewOpen = usePanelStore((s) => s.previewPageId !== null)
  const closePreview = usePanelStore((s) => s.closePreview)
  const load = usePages((s) => s.load)
  const pageTitle = usePages((s) => (pageId ? s.pages.find((p) => p.id === pageId)?.title : undefined))
  const previewingRole = usePages((s) => s.viewAs)
  const setViewAs = usePages((s) => s.setViewAs)
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
    refreshProject()
  }, [refreshProject])

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

  // A preview belongs to the world it was opened in.
  useEffect(() => {
    closePreview()
    return closePreview
  }, [projectId, closePreview])

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

  const backlinks = pageId && <BacklinksPanel key={pageId} projectId={projectId} pageId={pageId} />

  return (
    <div className={`layout${drawerOpen ? ' drawer-open' : ''}${sidebarHidden ? ' sidebar-collapsed' : ''}`}
      style={theme as CSSProperties}>
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

      {previewingRole && (
        <div className="role-preview-banner" role="status">
          <EyeGlyph />
          <span className="role-preview-text">
            Player preview<span className="role-preview-detail"> — what a {previewingRole} sees</span>
          </span>
          <button type="button" className="role-preview-exit" onClick={() => setViewAs(null)}>Exit</button>
        </div>
      )}

      <main className="layout-main">
        <Outlet />
        {isMobile && backlinks}
      </main>
      {/* Desktop: the preview takes the right column's place while open. */}
      {!isMobile && !previewOpen && backlinks}
      <ContextPanel projectId={projectId} isMobile={isMobile} />

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
