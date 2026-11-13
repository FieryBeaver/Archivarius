interface Props {
  message: string
  actionLabel?: string
  onAction?: () => void
}

export default function EmptyState({ message, actionLabel, onAction }: Props) {
  return (
    <div className="empty-state">
      <p>{message}</p>
      {actionLabel && onAction && (
        <button className="btn-primary" onClick={onAction}>{actionLabel}</button>
      )}
    </div>
  )
}
