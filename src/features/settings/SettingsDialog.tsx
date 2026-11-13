import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import * as db from '../../lib/db'
import { renderIcon } from '../../lib/icons'
import { GiPalette } from 'react-icons/gi'
import type { Project, Role, ThemeOverrides } from '../../lib/types'
import { GeneralTab } from './GeneralTab'
import { MembersTab } from './MembersTab'
import { TransferTab } from './TransferTab'
import { AboutTab } from './AboutTab'
import { AppearanceTab } from './AppearanceTab'
import './Settings.css'

type TabId = 'general' | 'appearance' | 'members' | 'transfer' | 'about'

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'general', label: 'General', icon: 'gi:GiCastle' },
  { id: 'appearance', label: 'Appearance', icon: 'appearance' },
  { id: 'members', label: 'Members', icon: 'gi:GiThreeFriends' },
  { id: 'transfer', label: 'Import / Export', icon: 'gi:GiTiedScroll' },
  { id: 'about', label: 'About', icon: 'gi:GiOpenBook' },
]

export interface SettingsContext {
  project: Project
  /** Current world name (may differ from props after a rename). */
  name: string
  setName(name: string): void
  /** Current saved theme (may differ from props after a save). null = defaults. */
  theme: ThemeOverrides | null
  setTheme(theme: ThemeOverrides | null): void
  /** null while loading or if not a member. */
  role: Role | null
  roleLoading: boolean
  setRole(role: Role | null): void
  /** While true the dialog refuses to close (long-running operation in flight). */
  setBusy(busy: boolean): void
  close(): void
}

export default function SettingsDialog(props: { project: Project; onClose: () => void }) {
  const { project, onClose } = props
  const [tab, setTab] = useState<TabId>('general')
  const [name, setName] = useState(project.name)
  const [theme, setTheme] = useState<ThemeOverrides | null>(project.theme ?? null)
  const [role, setRole] = useState<Role | null>(null)
  const [roleLoading, setRoleLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const busyRef = useRef(false)
  busyRef.current = busy

  const close = useCallback(() => {
    if (!busyRef.current) onClose()
  }, [onClose])

  // Fetch my role once on open.
  useEffect(() => {
    let alive = true
    db.getMyRole(project.id)
      .then((r) => { if (alive) setRole(r) })
      .catch(() => { if (alive) setRole(null) })
      .finally(() => { if (alive) setRoleLoading(false) })
    return () => { alive = false }
  }, [project.id])

  // Esc closes (unless a field consumed it via preventDefault).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault()
        close()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [close])

  // Focus the panel on open, restore focus on close, lock page scroll.
  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panelRef.current?.focus()
    return () => {
      document.body.style.overflow = prevOverflow
      prevFocus?.focus?.()
    }
  }, [])

  const onTabKey = (e: ReactKeyboardEvent<HTMLButtonElement>, i: number) => {
    const delta = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0
    if (!delta) return
    e.preventDefault()
    const next = TABS[(i + delta + TABS.length) % TABS.length]
    setTab(next.id)
    document.getElementById(`wks-tab-${next.id}`)?.focus()
  }

  const ctx: SettingsContext = {
    project, name, setName, theme, setTheme, role, roleLoading, setRole, setBusy, close,
  }

  let body: ReactNode
  if (tab === 'general') body = <GeneralTab ctx={ctx} />
  else if (tab === 'appearance') body = <AppearanceTab ctx={ctx} />
  else if (tab === 'members') body = <MembersTab ctx={ctx} />
  else if (tab === 'transfer') body = <TransferTab ctx={ctx} />
  else body = <AboutTab />

  return createPortal(
    <div
      className="wks-scrim"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}
    >
      <div
        ref={panelRef}
        className="wks-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wks-title"
        tabIndex={-1}
      >
        <header className="wks-header">
          <div className="wks-heading">
            <span className="wks-eyebrow">Settings</span>
            <h2 id="wks-title" className="wks-title" title={name}>{name}</h2>
          </div>
          <button
            type="button"
            className="btn-ghost wks-close"
            onClick={close}
            disabled={busy}
            aria-label="Close settings"
            title="Close (Esc)"
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div className="wks-main">
          <nav className="wks-tabs" role="tablist" aria-orientation="vertical">
            {TABS.map((t, i) => (
              <button
                key={t.id}
                id={`wks-tab-${t.id}`}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                aria-controls="wks-tabpanel"
                tabIndex={tab === t.id ? 0 : -1}
                className={'wks-tab' + (tab === t.id ? ' active' : '')}
                onClick={() => setTab(t.id)}
                onKeyDown={(e) => onTabKey(e, i)}
              >
                <span className="wks-tab-icon">{t.icon === 'appearance'
                  ? <GiPalette size={16} aria-hidden="true" style={{ verticalAlign: '-0.125em', flexShrink: 0 }} />
                  : renderIcon(t.icon, { size: 16 })}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </nav>
          <section
            id="wks-tabpanel"
            className="wks-content"
            role="tabpanel"
            aria-labelledby={`wks-tab-${tab}`}
          >
            {body}
          </section>
        </div>
      </div>
    </div>,
    document.body,
  )
}
