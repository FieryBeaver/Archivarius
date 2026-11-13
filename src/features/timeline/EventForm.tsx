import { useEffect, useId, useRef, useState } from 'react'
import PageLinkPicker from './PageLinkPicker'

export interface EventDraft {
  display_date: string
  title: string
  era: string
  body: string
  sort_key: number
  link: { id: string; title: string } | null
}

interface Props {
  mode: 'create' | 'edit'
  initial: EventDraft
  eras: string[]
  projectId: string
  pageId: string
  onSave: (draft: EventDraft) => Promise<void>
  onCancel: () => void
}

export default function EventForm({ mode, initial, eras, projectId, pageId, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState<EventDraft>(initial)
  const [sortText, setSortText] = useState(String(initial.sort_key))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLFormElement>(null)
  const uid = useId()
  const eraListId = `${uid}-eras`

  useEffect(() => {
    titleRef.current?.focus()
    rootRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [])

  function set<K extends keyof EventDraft>(key: K, value: EventDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  const sortValid = sortText.trim() !== '' && Number.isFinite(Number(sortText))
  const canSave = !saving && sortValid && (draft.title.trim() !== '' || draft.display_date.trim() !== '')

  async function submit() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      await onSave({ ...draft, sort_key: Number(sortText) })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save event')
      setSaving(false)
    }
  }

  return (
    <form
      ref={rootRef}
      className="tl-form"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          onCancel()
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          void submit()
        }
      }}
    >
      <div className="tl-form-row tl-form-row--split">
        <label className="tl-field">
          <span>Date</span>
          <input
            type="text"
            value={draft.display_date}
            placeholder="e.g. Year 312, 3rd Age"
            onChange={(e) => set('display_date', e.target.value)}
          />
        </label>
        <label className="tl-field">
          <span>Era</span>
          <input
            type="text"
            list={eraListId}
            value={draft.era}
            placeholder="optional"
            onChange={(e) => set('era', e.target.value)}
          />
          <datalist id={eraListId}>
            {eras.map((era) => (
              <option key={era} value={era} />
            ))}
          </datalist>
        </label>
      </div>

      <label className="tl-field">
        <span>Title</span>
        <input
          ref={titleRef}
          type="text"
          className="tl-form-title"
          value={draft.title}
          placeholder="What happened?"
          onChange={(e) => set('title', e.target.value)}
        />
      </label>

      <label className="tl-field">
        <span>Description</span>
        <textarea
          rows={4}
          value={draft.body}
          placeholder="Details, consequences, who was involved…"
          onChange={(e) => set('body', e.target.value)}
        />
      </label>

      <div className="tl-form-row tl-form-row--split tl-form-row--link">
        <div className="tl-field">
          <span>Link to page</span>
          <PageLinkPicker
            projectId={projectId}
            excludeId={pageId}
            value={draft.link}
            onChange={(v) => set('link', v)}
          />
        </div>
        <label className="tl-field tl-field--narrow">
          <span title="Events are ordered by this number. Prefilled to fit where you clicked.">Sort key</span>
          <input
            type="number"
            step="any"
            value={sortText}
            className={sortValid ? undefined : 'is-invalid'}
            onChange={(e) => setSortText(e.target.value)}
          />
        </label>
      </div>

      {error && <div className="tl-form-error">{error}</div>}

      <div className="tl-form-actions">
        <span className="tl-form-hint">Ctrl+Enter to save · Esc to cancel</span>
        <button type="button" className="tl-btn-ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="tl-btn-primary" disabled={!canSave}>
          {saving ? 'Saving…' : mode === 'create' ? 'Add event' : 'Save'}
        </button>
      </div>
    </form>
  )
}
