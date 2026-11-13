import { useState } from 'react'
import type { WorldEvent } from '../../lib/types'
import { readEventText } from './eventUtils'

interface Props {
  event: WorldEvent
  linkTitle: string | undefined
  canEdit: boolean
  pending: boolean
  onOpenLink: (pageId: string) => void
  onEdit: () => void
  onDelete: () => void
}

export default function EventCard({ event, linkTitle, canEdit, pending, onOpenLink, onEdit, onDelete }: Props) {
  const [confirming, setConfirming] = useState(false)
  const body = readEventText(event.content)

  return (
    <article className={`tl-event${pending ? ' is-pending' : ''}`}>
      <span className="tl-node" aria-hidden="true" />
      <div className="tl-card">
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
            <span aria-hidden="true">→</span> {linkTitle ?? 'open page'}
          </button>
        )}
      </div>
    </article>
  )
}
