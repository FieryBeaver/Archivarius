import { useEffect, useRef, type ReactNode, type SyntheticEvent } from 'react'
import { createPortal } from 'react-dom'
import './Popover.css'

interface Props {
  /** Bounding rect of the element the popover hangs from. */
  anchor: DOMRect
  onClose: () => void
  children: ReactNode
}

const WIDTH = 180

// React events bubble through portals; keep popover interactions away from the tree row.
const stop = (e: SyntheticEvent) => e.stopPropagation()

export default function Popover({ anchor, onClose, children }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - WIDTH - 8))

  return createPortal(
    <div ref={ref} className="popover" role="menu" style={{ top: anchor.bottom + 4, left, width: WIDTH }}
      onClick={stop} onPointerDown={stop} onDoubleClick={stop} onContextMenu={stop}>
      {children}
    </div>,
    document.body,
  )
}
