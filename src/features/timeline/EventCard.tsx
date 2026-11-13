import { useState, type MouseEvent } from 'react'
import { renderIcon } from '../../lib/icons'
import type { WorldEvent } from '../../lib/types'
import { readEventText } from './eventUtils'

interface Props {
  event: WorldEvent
  linkTitle: string | undefined
  /** Target page's icon string (pageIconOf), once resolved. */
  linkIcon?: string
  canEdit: boolean
  pending: boolean
  onOpenLink: (pageId: string) => void
  /** Plain click on a linked card: preview the target in the context panel. */
  onPreview: (pageId: string) => void
  onEdit: () => void
  onDelete: () => void
}

export default function EventCard({ event, linkTitle, linkIcon, canEdit, pending, onOpenLink, onPreview, onEdit, onDelete }: Props) {
  const [confirming, setConfirming] = useState(false)
  const body = readEventText(event.content)
  const target = event.target_page_id

  // Card-level click previews the linked page; buttons/links inside the card
  // (Edit, Delete, the "open page" chip) keep their own behavior, and a click
  // that ends a text selection is not treated as a preview request.
  const handleCardClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!target) return
    if ((e.target as HTMLElement).closest('button, a, input, textarea, select')) return
    if (window.getSelection()?.toString()) return
    onPreview(target)
  }

  return (
    <article className={`tl-event${pending ? ' is-pending' : ''}`}>
      <span className="tl-node" aria-hidden="true" />
      <div className={`tl-card${target ? ' is-linked' : ''}`} onClick={target ? handleCardClick : undefined}>
        <header className="tl-card-head">
          {event.display_date && <time className="tl-date">{event.display_date}</time>}
          {canEdit && (
            <div className={`tl-actions${confirming ? ' is-visible' : ''}`}>
              {confirming ? (
                <>
                  <span className="tl-confirm-text">Delete this event?</span>
                  <button type="button" className="tl-btn-ghost" onClick={() => setConfirming(false)}>
                    Keep
                  </button>
                  <button type="button" className="tl-btn-danger" onClick={onDelete}>
                    Delete
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="tl-icon-btn" title="Edit event" onClick={onEdit}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="tl-icon-btn tl-icon-btn--danger"
                    title="Delete event"
                    onClick={() => setConfirming(true)}
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
          )}
        </header>
        {event.title && <h3 className="tl-title">{event.title}</h3>}
        {body && <p className="tl-body">{body}</p>}
        {event.target_page_id && (
          <button
            type="button"
            className="tl-chip"
            onClick={() => event.target_page_id && onOpenLink(event.target_page_id)}
          >
            <span className="tl-chip-icon" aria-hidden="true">
              {(linkIcon && renderIcon(linkIcon, { size: 14 })) || '→'}
            </span>
            {linkTitle ?? 'open page'}
          </button>
        )}
      </div>
    </article>
  )
}
