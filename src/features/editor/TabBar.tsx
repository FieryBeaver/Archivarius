import { useRef, useState, type KeyboardEvent } from 'react'

export interface TabItem {
  id: string
  title: string
}

interface TabBarProps {
  /** Empty for a legacy single-doc page: only the add affordance is shown. */
  tabs: TabItem[]
  activeId: string | null
  canEdit: boolean
  renamingId: string | null
  onSelect(id: string): void
  onAdd(): void
  onStartRename(id: string): void
  /** title === null cancels the rename. */
  onRename(id: string, title: string | null): void
  onDelete(id: string): void
}

const MAX_TITLE = 60

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
  tabs, activeId, canEdit, renamingId, onSelect, onAdd, onStartRename, onRename, onDelete,
}: TabBarProps) {
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const deletable = canEdit && tabs.length > 1

  return (
    <div className={`doc-tabs${tabs.length ? '' : ' doc-tabs-empty'}`}>
      <div className="doc-tabs-list" role="tablist" aria-label="Document tabs">
        {tabs.map((tab) => {
          const active = tab.id === activeId
          const renaming = canEdit && tab.id === renamingId
          const confirming = deletable && tab.id === confirmId
          return (
            <div key={tab.id} className={`doc-tab${active ? ' active' : ''}${confirming ? ' confirming' : ''}`}>
              {renaming ? (
                <RenameInput tab={tab} onDone={(title) => onRename(tab.id, title)} />
              ) : (
                <button type="button" role="tab" aria-selected={active} className="doc-tab-btn"
                  title={canEdit ? `${tab.title} — double-click to rename` : tab.title}
                  onClick={() => { setConfirmId(null); onSelect(tab.id) }}
                  onDoubleClick={() => { if (canEdit) onStartRename(tab.id) }}>
                  {tab.title}
                </button>
              )}
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
        <button type="button" className="doc-tab-add" title="Add tab" aria-label="Add tab" onClick={onAdd}>
          {tabs.length ? '+' : '+ Add tab'}
        </button>
      )}
    </div>
  )
}
