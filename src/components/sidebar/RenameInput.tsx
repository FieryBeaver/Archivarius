import { useEffect, useRef, useState, type SyntheticEvent } from 'react'

interface Props {
  initial: string
  /** Called with the trimmed new title, or null when cancelled. */
  onDone: (title: string | null) => void
}

const stop = (e: SyntheticEvent) => e.stopPropagation()

export default function RenameInput({ initial, onDone }: Props) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)

  useEffect(() => {
    ref.current?.select()
  }, [])

  const finish = (title: string | null) => {
    if (done.current) return
    done.current = true
    onDone(title === null ? null : title.trim() || initial)
  }

  return (
    <input ref={ref} className="tree-rename" value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(value)
        if (e.key === 'Escape') finish(null)
      }}
      onClick={stop} onDoubleClick={stop} onPointerDown={stop} />
  )
}
