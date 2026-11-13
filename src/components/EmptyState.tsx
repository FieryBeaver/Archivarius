interface Props {
  message: string
  /** Optional Spectral heading above the message. */
  title?: string
  /** Optional muted glyph above everything. */
  glyph?: string
  actionLabel?: string
  onAction?: () => void
}

export default function EmptyState({ message, title, glyph = '✦', actionLabel, onAction }: Props) {
  return (
    <div className="empty-state">
      <span className="empty-state-glyph" aria-hidden="true">{glyph}</span>
      {title && <h2 className="empty-state-title">{title}</h2>}
      <p>{message}</p>
      {actionLabel && onAction && (
        <button className="btn-primary" onClick={onAction}>{actionLabel}</button>
      )}
    </div>
  )
}
