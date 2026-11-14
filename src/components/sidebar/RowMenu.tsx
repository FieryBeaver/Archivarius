import Popover from '../Popover'
import { EyeGlyph, EyeOffGlyph } from '../UiIcons'

interface Props {
  anchor: DOMRect
  isSecret: boolean
  /** Owners only: the secret toggle item (secrets are GM machinery). */
  canSecret: boolean
  /** Switches this menu to the new-page kind picker (same anchor). */
  onAddChild: () => void
  /** Doc pages, editors+: snapshot the page as a template. */
  onSaveTemplate?: () => void
  onRename: () => void
  onToggleSecret: () => void
  onDelete: () => void
  onClose: () => void
}

export default function RowMenu({ anchor, isSecret, canSecret, onAddChild, onSaveTemplate, onRename, onToggleSecret, onDelete, onClose }: Props) {
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
      {onSaveTemplate && (
        <button className="popover-item" role="menuitem" onClick={pick(onSaveTemplate)}>
          <span>⧉</span><span>Save as template…</span>
        </button>
      )}
      {canSecret && (
        <button className="popover-item" role="menuitem" onClick={pick(onToggleSecret)}>
          <span>{isSecret ? <EyeGlyph /> : <EyeOffGlyph />}</span>
          <span>{isSecret ? 'Make visible' : 'Mark as secret'}</span>
        </button>
      )}
      <div className="popover-sep" role="separator" />
      <button className="popover-item danger" role="menuitem" onClick={pick(onDelete)}>
        <span>🗑</span><span>Delete</span>
      </button>
    </Popover>
  )
}
