import { useEffect, useLayoutEffect, useRef, type ReactNode, type SyntheticEvent } from 'react'
import { createPortal } from 'react-dom'
import './Popover.css'

interface Props {
  /** Bounding rect of the element the popover hangs from. */
  anchor: DOMRect
  onClose: () => void
  children: ReactNode
  /** Panel width in px (default 180, clamped to the viewport). */
  width?: number
  /** ARIA role of the panel (default "menu"). */
  role?: string
  className?: string
}

const WIDTH = 180

// React events bubble through portals; keep popover interactions away from the tree row.
const stop = (e: SyntheticEvent) => e.stopPropagation()

export default function Popover({ anchor, onClose, children, width = WIDTH, role = 'menu', className }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const below = anchor.bottom + 4

  // Flip above the anchor when there isn't room below (short phone viewports).
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const h = el.offsetHeight
    if (below + h > window.innerHeight - 8) el.style.top = `${Math.max(8, anchor.top - 4 - h)}px`
  }, [anchor, below])

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

  const w = Math.min(width, window.innerWidth - 16)
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - w - 8))

  return createPortal(
    <div ref={ref} className={className ? `popover ${className}` : 'popover'} role={role} style={{ top: below, left, width: w }}
      onClick={stop} onPointerDown={stop} onDoubleClick={stop} onContextMenu={stop}>
      {children}
    </div>,
    document.body,
  )
}
