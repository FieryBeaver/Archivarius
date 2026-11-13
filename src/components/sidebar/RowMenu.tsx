import LockIcon from '../LockIcon'
import Popover from '../Popover'

interface Props {
  anchor: DOMRect
  isSecret: boolean
  /** Switches this menu to the new-page kind picker (same anchor). */
  onAddChild: () => void
  onRename: () => void
  onToggleSecret: () => void
  onDelete: () => void
  onClose: () => void
}

export default function RowMenu({ anchor, isSecret, onAddChild, onRename, onToggleSecret, onDelete, onClose }: Props) {
  const pick = (fn: () => void) => () => {
    onClose()
    fn()
  }
  return (
    <Popover anchor={anchor} onClose={onClose}>
      <button className="popover-item" role="menuitem" onClick={onAddChild}>
        <span>+</span><span>Add child page…</span>
      </button>
      <button className="popover-item" role="menuitem" onClick={pick(onRename)}>
        <span>✎</span><span>Rename</span>
      </button>
      <button className="popover-item" role="menuitem" onClick={pick(onToggleSecret)}>
        <span><LockIcon open={isSecret} /></span><span>{isSecret ? 'Make visible' : 'Mark as secret'}</span>
      </button>
      <div className="popover-sep" role="separator" />
      <button className="popover-item danger" role="menuitem" onClick={pick(onDelete)}>
        <span>🗑</span><span>Delete</span>
      </button>
    </Popover>
  )
}
