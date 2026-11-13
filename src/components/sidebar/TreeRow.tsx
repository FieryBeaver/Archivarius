import { useSortable } from '@dnd-kit/sortable'
import { useState, type CSSProperties, type MouseEvent } from 'react'
import type { PageKind } from '../../lib/types'
import type { FlatNode } from '../../state/pageTree'
import { PageIcon } from '../../lib/icons'
import LockIcon from '../LockIcon'
import { INDENT } from './dnd'
import KindPicker from './KindPicker'
import RenameInput from './RenameInput'
import RowMenu from './RowMenu'

interface Props {
  row: FlatNode
  /** Depth to render at (the projected depth while this row is being dragged). */
  depth: number
  selected: boolean
  expanded: boolean
  /** Viewers get a read-only row: no drag, rename, menu or add-child. */
  canEdit: boolean
  /** Reordering makes no sense in a filtered view; actions still work. */
  dragDisabled?: boolean
  onOpen: () => void
  onToggle: () => void
  onAddChild: (kind: PageKind) => void
  onRename: (title: string) => void
  onToggleSecret: () => void
  onDelete: () => void
}

type Popup = { kind: 'add' | 'menu'; anchor: DOMRect } | null

const rectOf = (e: MouseEvent) => (e.currentTarget as HTMLElement).getBoundingClientRect()

export default function TreeRow(props: Props) {
  const { row, depth, selected, expanded, canEdit } = props
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: row.id, disabled: !canEdit || props.dragDisabled })
  const [renaming, setRenaming] = useState(false)
  const [popup, setPopup] = useState<Popup>(null)
  const closePopup = () => setPopup(null)

  const style = {
    paddingLeft: 8 + depth * INDENT,
    '--depth': depth, // indent guides (Sidebar.css)
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
  } as CSSProperties
  const className = ['tree-row', selected && 'selected', isDragging && 'dragging', popup && 'menu-open',
    row.page.is_secret && 'secret']
    .filter(Boolean).join(' ')

  return (
    <div ref={setNodeRef} style={style} className={className} {...attributes} {...listeners}
      onClick={props.onOpen}
      onDoubleClick={() => canEdit && setRenaming(true)}
      onContextMenu={(e) => {
        if (!canEdit) return
        e.preventDefault()
        // A touch long-press is a drag (TouchSensor); don't also pop the menu mid-drag.
        if (isDragging) return
        setPopup({ kind: 'menu', anchor: new DOMRect(e.clientX, e.clientY, 0, 0) })
      }}>
      <button className={`tree-chevron${row.childCount ? '' : ' hidden'}${expanded ? ' open' : ''}`}
        aria-label={expanded ? 'Collapse' : 'Expand'} tabIndex={-1}
        onClick={(e) => { e.stopPropagation(); props.onToggle() }}>
        ›
      </button>
      <span className="tree-icon"><PageIcon page={row.page} /></span>

      {renaming ? (
        <RenameInput initial={row.page.title}
          onDone={(title) => {
            setRenaming(false)
            if (title !== null && title !== row.page.title) props.onRename(title)
          }} />
      ) : (
        <span className="tree-title">{row.page.title || 'Untitled'}</span>
      )}

      {row.page.is_secret && (
        <span className="tree-secret" title="DM only — hidden from viewers"><LockIcon /></span>
      )}

      {canEdit && <span className="tree-actions">
        <button className="tree-action" aria-label="Add child page"
          onClick={(e) => { e.stopPropagation(); setPopup({ kind: 'add', anchor: rectOf(e) }) }}>+</button>
        <button className="tree-action" aria-label="Page options"
          onClick={(e) => { e.stopPropagation(); setPopup({ kind: 'menu', anchor: rectOf(e) }) }}>⋯</button>
      </span>}

      {popup?.kind === 'add' && (
        <KindPicker anchor={popup.anchor} onClose={closePopup}
          onPick={(kind) => { closePopup(); props.onAddChild(kind) }} />
      )}
      {popup?.kind === 'menu' && (
        <RowMenu anchor={popup.anchor} isSecret={row.page.is_secret} onClose={closePopup}
          onRename={() => setRenaming(true)} onToggleSecret={props.onToggleSecret} onDelete={props.onDelete} />
      )}
    </div>
  )
}
