import type { PageKind } from '../../lib/types'
import Popover from '../Popover'
import { KIND_ICONS, KIND_LABELS } from '../pageIcon'

const KINDS: PageKind[] = ['doc', 'map', 'timeline']

interface Props {
  anchor: DOMRect
  onPick: (kind: PageKind) => void
  onClose: () => void
}

export default function KindPicker({ anchor, onPick, onClose }: Props) {
  return (
    <Popover anchor={anchor} onClose={onClose}>
      {KINDS.map((kind) => (
        <button key={kind} className="popover-item" role="menuitem" onClick={() => onPick(kind)}>
          <span>{KIND_ICONS[kind]}</span>
          <span>{KIND_LABELS[kind]}</span>
        </button>
      ))}
    </Popover>
  )
}
