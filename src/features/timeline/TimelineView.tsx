import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useNavigate } from 'react-router-dom'
import * as db from '../../lib/db'
import { pageIconOf } from '../../lib/icons'
import type { Page, WorldEvent } from '../../lib/types'
import { usePanelStore } from '../../state/panel'
import EventCard from './EventCard'
import EventForm from './EventForm'
import type { EventDraft } from './EventForm'
import {
  compareEvents,
  countDuplicateKeys,
  groupByEra,
  insertionKeys,
  normEra,
  readEventText,
  toEventContent,
} from './eventUtils'
import './timeline.css'

type FormState = { mode: 'create'; index: number } | { mode: 'edit'; id: string } | null

export default function TimelineView({ page, canEdit }: { page: Page; canEdit: boolean }): JSX.Element {
  const nav = useNavigate()
  const [events, setEvents] = useState<WorldEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [opError, setOpError] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(null)
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set())
  const [linkTitles, setLinkTitles] = useState<Record<string, string>>({})
  const [linkIcons, setLinkIcons] = useState<Record<string, string>>({})
  const requested = useRef<Set<string>>(new Set())

  // ---- load / refetch on page change ----
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    setOpError(null)
    setForm(null)
    setEvents([])
    db.listEvents(page.id)
      .then((rows) => {
        if (!cancelled) setEvents(rows)
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Could not load events')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [page.id])

  // ---- resolve titles of linked pages for the chips ----
  useEffect(() => {
    const missing = [
      ...new Set(events.map((e) => e.target_page_id).filter((id): id is string => !!id)),
    ].filter((id) => !requested.current.has(id))
    if (missing.length === 0) return
    missing.forEach((id) => requested.current.add(id))
    Promise.all(
      missing.map((id) =>
        db.getPage(id).then(
          (p) => [id, p.title || 'Untitled', pageIconOf(p)] as const,
          () => [id, '', ''] as const,
        ),
      ),
    ).then((rows) => {
      setLinkTitles((prev) => {
        const next = { ...prev }
        for (const [id, title] of rows) if (title) next[id] = title
        return next
      })
      setLinkIcons((prev) => {
        const next = { ...prev }
        for (const [id, , icon] of rows) if (icon) next[id] = icon
        return next
      })
    })
  }, [events])

  const groups = useMemo(() => groupByEra(events), [events])
  const eras = useMemo(() => {
    const s = new Set<string>()
    for (const ev of events) {
      const era = normEra(ev.era)
      if (era) s.add(era)
    }
    return [...s]
  }, [events])
  const dupes = useMemo(() => countDuplicateKeys(events), [events])

  const openPage = useCallback(
    (id: string) => nav(`/project/${page.project_id}/page/${id}`),
    [nav, page.project_id],
  )
  const previewPage = useCallback((id: string) => usePanelStore.getState().openPreview(id), [])

  const markPending = (id: string, on: boolean) =>
    setPendingIds((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  const rememberLink = (link: EventDraft['link']) => {
    if (link) {
      requested.current.add(link.id)
      setLinkTitles((prev) => ({ ...prev, [link.id]: link.title }))
    }
  }

  // ---- mutations ----
  async function handleCreate(index: number, draft: EventDraft) {
    const { position } = insertionKeys(events, index)
    const created = await db.createEvent({
      timeline_page_id: page.id,
      position,
      sort_key: draft.sort_key,
      display_date: draft.display_date.trim(),
      era: normEra(draft.era),
      title: draft.title.trim(),
      content: toEventContent(draft.body),
      target_page_id: draft.link?.id ?? null,
    })
    rememberLink(draft.link)
    setEvents((prev) => [...prev, created].sort(compareEvents))
    setForm(null)
  }

  async function handleUpdate(original: WorldEvent, draft: EventDraft) {
    const attrs: Partial<WorldEvent> = {
      sort_key: draft.sort_key,
      display_date: draft.display_date.trim(),
      era: normEra(draft.era),
      title: draft.title.trim(),
      content: toEventContent(draft.body),
      target_page_id: draft.link?.id ?? null,
    }
    rememberLink(draft.link)
    setOpError(null)
    // optimistic
    setEvents((prev) => prev.map((e) => (e.id === original.id ? { ...e, ...attrs } : e)).sort(compareEvents))
    setForm(null)
    markPending(original.id, true)
    try {
      const saved = await db.updateEvent(original.id, attrs)
      setEvents((prev) => prev.map((e) => (e.id === saved.id ? saved : e)).sort(compareEvents))
    } catch (e) {
      setEvents((prev) => prev.map((x) => (x.id === original.id ? original : x)).sort(compareEvents))
      setOpError(e instanceof Error ? `Could not save event: ${e.message}` : 'Could not save event')
    } finally {
      markPending(original.id, false)
    }
  }

  async function handleDelete(ev: WorldEvent) {
    setOpError(null)
    setEvents((prev) => prev.filter((e) => e.id !== ev.id))
    if (form?.mode === 'edit' && form.id === ev.id) setForm(null)
    try {
      await db.deleteEvent(ev.id)
    } catch (e) {
      setEvents((prev) => [...prev, ev].sort(compareEvents))
      setOpError(e instanceof Error ? `Could not delete event: ${e.message}` : 'Could not delete event')
    }
  }

  // ---- drafts ----
  function createDraft(index: number): EventDraft {
    const prev = events[index - 1]
    const next = events[index]
    const era = (next ?? prev)?.era ?? ''
    return {
      display_date: '',
      title: '',
      era: normEra(era) ?? '',
      body: '',
      sort_key: insertionKeys(events, index).sort_key,
      link: null,
    }
  }

  function editDraft(ev: WorldEvent): EventDraft {
    return {
      display_date: ev.display_date ?? '',
      title: ev.title ?? '',
      era: ev.era ?? '',
      body: readEventText(ev.content),
      sort_key: ev.sort_key,
      link: ev.target_page_id ? { id: ev.target_page_id, title: linkTitles[ev.target_page_id] ?? 'Linked page' } : null,
    }
  }

  // ---- render helpers ----
  const renderCreateForm = (index: number) => (
    <div className="tl-event tl-event--form" key={`form-${index}`}>
      <span className="tl-node tl-node--new" aria-hidden="true" />
      <EventForm
        mode="create"
        initial={createDraft(index)}
        eras={eras}
        projectId={page.project_id}
        pageId={page.id}
        onSave={(d) => handleCreate(index, d)}
        onCancel={() => setForm(null)}
      />
    </div>
  )

  const renderSlot = (index: number) => {
    if (form?.mode === 'create' && form.index === index) return renderCreateForm(index)
    if (!canEdit) return null
    return (
      <div className="tl-slot" key={`slot-${index}`}>
        <button
          type="button"
          className="tl-slot-btn"
          title="Insert an event here"
          onClick={() => setForm({ mode: 'create', index })}
        >
          <span className="tl-slot-plus" aria-hidden="true">+</span>
          <span className="tl-slot-label">Add event</span>
        </button>
      </div>
    )
  }

  const renderEvent = (ev: WorldEvent) => {
    if (form?.mode === 'edit' && form.id === ev.id) {
      return (
        <div className="tl-event tl-event--form" key={ev.id}>
          <span className="tl-node" aria-hidden="true" />
          <EventForm
            mode="edit"
            initial={editDraft(ev)}
            eras={eras}
            projectId={page.project_id}
            pageId={page.id}
            onSave={(d) => handleUpdate(ev, d)}
            onCancel={() => setForm(null)}
          />
        </div>
      )
    }
    return (
      <EventCard
        key={ev.id}
        event={ev}
        linkTitle={ev.target_page_id ? linkTitles[ev.target_page_id] : undefined}
        linkIcon={ev.target_page_id ? linkIcons[ev.target_page_id] : undefined}
        canEdit={canEdit}
        pending={pendingIds.has(ev.id)}
        onOpenLink={openPage}
        onPreview={previewPage}
        onEdit={() => setForm({ mode: 'edit', id: ev.id })}
        onDelete={() => void handleDelete(ev)}
      />
    )
  }

  // ---- states ----
  const isEmpty = !loading && !loadError && events.length === 0
  const showEmptyState = isEmpty && form === null

  return (
    <div className="tl-root">
      <div className="tl-inner">
        <div className="tl-toolbar">
          <span className="tl-count">
            {loading ? 'Loading…' : `${events.length} ${events.length === 1 ? 'event' : 'events'}`}
          </span>
          {dupes > 0 && (
            <span
              className="tl-hint"
              title="Events with identical sort keys are ordered by insertion. Give them distinct sort keys to control their order."
            >
              · {dupes === 1 ? 'two or more events share a sort key' : `${dupes} sort keys are shared by several events`}
            </span>
          )}
          {canEdit && !loading && !loadError && events.length > 0 && (
            <button
              type="button"
              className="tl-toolbar-add"
              onClick={() => setForm({ mode: 'create', index: events.length })}
            >
              + Add event
            </button>
          )}
        </div>

        {opError && (
          <div className="tl-banner" role="alert">
            <span>{opError}</span>
            <button type="button" className="tl-btn-ghost" onClick={() => setOpError(null)}>
              Dismiss
            </button>
          </div>
        )}

        {loading && (
          <div className="tl-track tl-track--loading" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div className="tl-event" key={i}>
                <span className="tl-node" aria-hidden="true" />
                <div className="tl-card tl-skeleton">
                  <span className="tl-skel-line tl-skel-line--short" />
                  <span className="tl-skel-line tl-skel-line--title" />
                  <span className="tl-skel-line" />
                </div>
              </div>
            ))}
          </div>
        )}

        {loadError && (
          <div className="tl-empty">
            <div className="tl-empty-title">Couldn’t load this timeline</div>
            <div className="tl-empty-sub">{loadError}</div>
          </div>
        )}

        {showEmptyState && (
          <div className="tl-empty">
            <div className="tl-empty-glyph" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className="tl-empty-title">No events yet</div>
            <div className="tl-empty-sub">
              Dates are free text — use whatever calendar your world keeps.
            </div>
            {canEdit && (
              <button type="button" className="tl-btn-primary" onClick={() => setForm({ mode: 'create', index: 0 })}>
                Add first event
              </button>
            )}
          </div>
        )}

        {!loading && !loadError && !showEmptyState && (
          <div className="tl-track">
            {groups.map((g) => (
              <section className={`tl-group${g.era ? ' tl-group--era' : ''}`} key={`${g.start}-${g.era ?? ''}`}>
                {g.era && (
                  <div className="tl-era">
                    <span className="tl-era-mark" aria-hidden="true" />
                    <span className="tl-era-label">{g.era}</span>
                    <span className="tl-era-rule" aria-hidden="true" />
                  </div>
                )}
                {g.events.map((ev, j) => [renderSlot(g.start + j), renderEvent(ev)])}
              </section>
            ))}
            {form?.mode === 'create' && form.index === events.length
              ? renderCreateForm(events.length)
              : canEdit && (
                  <div className="tl-end">
                    <button
                      type="button"
                      className="tl-end-btn"
                      onClick={() => setForm({ mode: 'create', index: events.length })}
                    >
                      + Add event
                    </button>
                  </div>
                )}
          </div>
        )}
      </div>
    </div>
  )
}
