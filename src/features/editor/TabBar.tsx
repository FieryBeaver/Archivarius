import { useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import Popover from '../../components/Popover'
import { EyeGlyph, EyeOffGlyph } from '../../components/UiIcons'
import { VISIBILITIES, VISIBILITY_LABELS, asVisibility, type Visibility } from '../../lib/visibility'

export interface TabItem {
  id: string
  title: string
  visibleTo?: Visibility
}

interface TabBarProps {
  /** Empty for a legacy single-doc page: only the add affordance is shown. */
  tabs: TabItem[]
  activeId: string | null
  canEdit: boolean
  /** Offer "Owners only" (an editor choosing it would lock themselves out). */
  canOwnerOnly: boolean
  renamingId: string | null
  onSelect(id: string): void
  /** Opens the add-tab menu anchored to the + button. */
  onAdd(anchor: DOMRect): void
  onStartRename(id: string): void
  /** title === null cancels the rename. */
  onRename(id: string, title: string | null): void
  onDelete(id: string): void
  onSetVisibility(id: string, visibleTo: Visibility): void
}

const MAX_TITLE = 60

const VISIBILITY_HINTS: Record<Visibility, string> = {
  all: 'Players see this tab',
  editors: 'Hidden from players',
  owners: 'Hidden from players and editors',
}

function RenameInput({ tab, onDone }: { tab: TabItem; onDone(title: string | null): void }) {
  const done = useRef(false)
  const finish = (title: string | null) => {
    if (done.current) return
    done.current = true
    onDone(title)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(e.currentTarget.value) }
    else if (e.key === 'Escape') { e.preventDefault(); finish(null) }
  }
  return (
    <input className="doc-tab-input" defaultValue={tab.title} maxLength={MAX_TITLE} aria-label="Tab name"
      autoFocus onFocus={(e) => e.currentTarget.select()} onKeyDown={onKeyDown}
      onBlur={(e) => finish(e.currentTarget.value)}
      size={Math.max(6, Math.min(tab.title.length + 1, 24))} />
  )
}

/** Document tab strip between the page header and the editor. */
export default function TabBar({
  tabs, activeId, canEdit, canOwnerOnly, renamingId, onSelect, onAdd, onStartRename, onRename, onDelete,
  onSetVisibility,
}: TabBarProps) {
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ id: string; anchor: DOMRect } | null>(null)
  const deletable = canEdit && tabs.length > 1
  const menuTab = menu ? tabs.find((t) => t.id === menu.id) ?? null : null

  function openMenu(e: MouseEvent, id: string) {
    if (!canEdit) return
    e.preventDefault()
    setConfirmId(null)
    setMenu({ id, anchor: new DOMRect(e.clientX, e.clientY, 0, 0) })
  }

  return (
    <div className={`doc-tabs${tabs.length ? '' : ' doc-tabs-empty'}`}>
      <div className="doc-tabs-list" role="tablist" aria-label="Document tabs">
        {tabs.map((tab) => {
          const active = tab.id === activeId
          const renaming = canEdit && tab.id === renamingId
          const confirming = deletable && tab.id === confirmId
          const vis = asVisibility(tab.visibleTo)
          const restricted = vis !== 'all'
          return (
            <div key={tab.id} onContextMenu={(e) => openMenu(e, tab.id)}
              className={`doc-tab${active ? ' active' : ''}${confirming ? ' confirming' : ''}${restricted ? ' restricted' : ''}`}>
              {renaming ? (
                <RenameInput tab={tab} onDone={(title) => onRename(tab.id, title)} />
              ) : (
                <button type="button" role="tab" aria-selected={active} className="doc-tab-btn"
                  title={canEdit ? `${tab.title} — double-click to rename, right-click for options` : tab.title}
                  onClick={() => { setConfirmId(null); onSelect(tab.id) }}
                  onDoubleClick={() => { if (canEdit) onStartRename(tab.id) }}>
                  {tab.title}
                </button>
              )}
              {!renaming && !confirming && (canEdit ? (
                <button type="button" className="doc-tab-eye" aria-pressed={restricted}
                  aria-label={restricted ? `Show tab ${tab.title} to players` : `Hide tab ${tab.title} from players`}
                  title={restricted
                    ? `${VISIBILITY_HINTS[vis]} — click to show to everyone (right-click for more)`
                    : 'Players see this tab — click to hide it from them (right-click for more)'}
                  onClick={() => onSetVisibility(tab.id, restricted ? 'all' : 'editors')}>
                  {restricted ? <EyeOffGlyph size={13} /> : <EyeGlyph size={13} />}
                </button>
              ) : restricted && (
                <span className="doc-tab-eye static" title={VISIBILITY_HINTS[vis]}><EyeOffGlyph size={13} /></span>
              ))}
              {confirming ? (
                <span className="doc-tab-confirm" role="group" aria-label={`Delete tab ${tab.title}?`}>
                  <span>Delete?</span>
                  <button type="button" className="doc-tab-confirm-yes" autoFocus
                    onKeyDown={(e) => { if (e.key === 'Escape') setConfirmId(null) }}
                    onClick={() => { setConfirmId(null); onDelete(tab.id) }}>Yes</button>
                  <button type="button" onClick={() => setConfirmId(null)}>No</button>
                </span>
              ) : deletable && !renaming && (
                <button type="button" className="doc-tab-close" aria-label={`Delete tab ${tab.title}`}
                  title="Delete tab" onClick={() => setConfirmId(tab.id)}>×</button>
              )}
            </div>
          )
        })}
      </div>
      {canEdit && (
        <button type="button" className="doc-tab-add" title="Add tab" aria-label="Add tab"
          onClick={(e) => onAdd(e.currentTarget.getBoundingClientRect())}>
          {tabs.length ? '+' : '+ Add tab'}
        </button>
      )}
      {menu && menuTab && (
        <Popover anchor={menu.anchor} onClose={() => setMenu(null)} width={230}>
          <button className="popover-item" role="menuitem"
            onClick={() => { setMenu(null); onStartRename(menuTab.id) }}>
            <span>✎</span><span>Rename</span>
          </button>
          <div className="popover-sep" role="separator" />
          <div className="popover-heading">Visible to</div>
          {VISIBILITIES.filter((v) => v !== 'owners' || canOwnerOnly || menuTab.visibleTo === 'owners').map((v) => {
            const checked = asVisibility(menuTab.visibleTo) === v
            return (
              <button key={v} className="popover-item" role="menuitemradio" aria-checked={checked}
                onClick={() => { setMenu(null); if (!checked) onSetVisibility(menuTab.id, v) }}>
                <span>{v === 'all' ? <EyeGlyph /> : <EyeOffGlyph />}</span>
                <span className="popover-item-label">
                  {VISIBILITY_LABELS[v]}
                  <small>{VISIBILITY_HINTS[v]}</small>
                </span>
                {checked && <span className="popover-check" aria-hidden>✓</span>}
              </button>
            )
          })}
          {deletable && (
            <>
              <div className="popover-sep" role="separator" />
              <button className="popover-item danger" role="menuitem"
                onClick={() => { setMenu(null); setConfirmId(menuTab.id) }}>
                <span>🗑</span><span>Delete tab</span>
              </button>
            </>
          )}
        </Popover>
      )}
    </div>
  )
}
