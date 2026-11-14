import { usePages } from '../../state/pages'
import Popover from '../Popover'
import { EyeGlyph, EyeOffGlyph } from '../UiIcons'

/**
 * The sidebar eye menu (owners/editors): hide secrets in place, or preview
 * the whole world as a player. Both are client-side views; RLS stays the boundary.
 */
export default function ViewMenu({ anchor, onClose }: { anchor: DOMRect; onClose: () => void }) {
  const hideSecrets = usePages((s) => s.hideSecrets)
  const previewing = usePages((s) => s.viewAs !== null)
  const setHideSecrets = usePages((s) => s.setHideSecrets)
  const setViewAs = usePages((s) => s.setViewAs)

  const pick = (fn: () => void) => () => {
    onClose()
    fn()
  }

  return (
    <Popover anchor={anchor} onClose={onClose} width={220}>
      <button className="popover-item" role="menuitemcheckbox" aria-checked={hideSecrets}
        onClick={pick(() => setHideSecrets(!hideSecrets))}>
        <span>{hideSecrets ? <EyeGlyph /> : <EyeOffGlyph />}</span>
        <span className="popover-item-label">
          {hideSecrets ? 'Show secrets' : 'Hide secrets'}
          <small>Keep editing, hide DM-only content</small>
        </span>
        {hideSecrets && <span className="popover-check" aria-hidden>✓</span>}
      </button>
      <button className="popover-item" role="menuitemcheckbox" aria-checked={previewing}
        onClick={pick(() => setViewAs(previewing ? null : 'viewer'))}>
        <span><EyeGlyph /></span>
        <span className="popover-item-label">
          {previewing ? 'Exit player preview' : 'Preview as player'}
          <small>Read-only, exactly what viewers see</small>
        </span>
        {previewing && <span className="popover-check" aria-hidden>✓</span>}
      </button>
    </Popover>
  )
}
