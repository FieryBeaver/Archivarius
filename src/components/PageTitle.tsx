import { useRef, useState, type KeyboardEvent } from 'react'
import { pageIconOf, renderIcon } from '../lib/icons'
import type { Page } from '../lib/types'
import { useAuth } from '../state/auth'
import { useCanEditPage } from '../state/pageEditors'
import { effectiveRole, useHiddenVia, usePages } from '../state/pages'
import Breadcrumbs from './Breadcrumbs'
import EditAccessControl from './EditAccessControl'
import IconPicker from './IconPicker'
import Popover from './Popover'
import { EyeGlyph, EyeOffGlyph } from './UiIcons'

/** Breadcrumbs, page icon, big borderless title (persists on blur or Enter), secret + edit-access pills. Key by page id. */
export default function PageTitle({ page }: { page: Page }) {
  const update = usePages((s) => s.update)
  const canEdit = useCanEditPage(page)
  const isOwner = usePages((s) => effectiveRole(s) === 'owner')
  const role = usePages(effectiveRole)
  const myId = useAuth((s) => s.session?.user.id)
  // Owners toggle secrecy anywhere; editors on pages they created.
  const canSecret = isOwner || (role === 'editor' && !!myId && page.created_by === myId)
  // v0.10: hidden by a secret ancestor (the page's own toggle stays independent).
  const hiddenVia = useHiddenVia(page.id)
  const [value, setValue] = useState(page.title)
  const [error, setError] = useState<string | null>(null)
  const [iconAnchor, setIconAnchor] = useState<DOMRect | null>(null)

  // Pick up renames made elsewhere (e.g. the sidebar).
  const [synced, setSynced] = useState(page.title)
  if (page.title !== synced) {
    setSynced(page.title)
    setValue(page.title)
  }

  function attempt(attrs: Partial<Page>) {
    setError(null)
    update(page.id, attrs).catch((e: Error) => setError(e.message))
  }

  function save() {
    const title = value.trim() || 'Untitled'
    setValue(title)
    if (title === page.title) return
    attempt({ title })
  }

  function pickIcon(icon: string | null) {
    setIconAnchor(null)
    if (icon !== page.icon) attempt({ icon })
  }

  const icon = renderIcon(pageIconOf(page))

  return (
    <header className="page-header">
      <div className="page-meta">
        <Breadcrumbs page={page} />
        <EditAccessControl page={page} isOwner={isOwner} />
        {canSecret ? (
          <button type="button" className={`page-secret-toggle${page.is_secret ? ' on' : ''}`}
            aria-pressed={page.is_secret} title="Secret — visible to you and owners only"
            onClick={() => attempt({ is_secret: !page.is_secret })}>
            {page.is_secret ? <EyeOffGlyph /> : <EyeGlyph />}
            <span>{page.is_secret ? 'Secret' : 'Visible'}</span>
          </button>
        ) : page.is_secret && (
          <span className="page-secret-toggle on static" title="Secret — hidden from others">
            <EyeOffGlyph /><span>Secret</span>
          </span>
        )}
        {!page.is_secret && hiddenVia !== null && (
          <span className="page-secret-toggle on static" title={`Hidden with “${hiddenVia}” (a secret page above this one)`}>
            <EyeOffGlyph /><span>Hidden with parent</span>
          </span>
        )}
      </div>

      <div className="page-title-row">
        {canEdit ? (
          <button type="button" className="page-icon page-icon-btn" title="Change icon" aria-label="Change icon"
            aria-expanded={!!iconAnchor}
            onClick={(e) => setIconAnchor(iconAnchor ? null : e.currentTarget.getBoundingClientRect())}>
            {icon}
          </button>
        ) : (
          <span className="page-icon" aria-hidden="true">{icon}</span>
        )}
        {canEdit ? (
          <input className="page-title" value={value} placeholder="Untitled" aria-label="Page title"
            onChange={(e) => setValue(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
        ) : (
          <h1 className="page-title page-title-static">{page.title || 'Untitled'}</h1>
        )}
      </div>
      {error && <p className="error-text">{error}</p>}

      <PageTags page={page} canEdit={canEdit} onSave={(tags) => attempt({ tags })} />

      {iconAnchor && canEdit && (
        <Popover anchor={iconAnchor} onClose={() => setIconAnchor(null)} width={320} role="presentation"
          className="popover-padded">
          <IconPicker value={page.icon} onSelect={pickIcon} />
        </Popover>
      )}
    </header>
  )
}

/** v0.7: free-form tag chips under the title; searchable in the tree filter and quick switcher. */
function PageTags({ page, canEdit, onSave }: { page: Page; canEdit: boolean; onSave(tags: string[]): void }) {
  const [adding, setAdding] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const tags = page.tags ?? []
  if (!canEdit && tags.length === 0) return null

  const remove = (tag: string) => onSave(tags.filter((t) => t !== tag))
  const commit = () => {
    const value = inputRef.current?.value.trim().replace(/^#/, '') ?? ''
    setAdding(false)
    if (!value) return
    if (tags.some((t) => t.toLowerCase() === value.toLowerCase())) return
    onSave([...tags, value])
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); commit() }
    else if (e.key === 'Escape') { e.preventDefault(); setAdding(false) }
  }

  return (
    <div className="page-tags">
      {tags.map((tag) => (
        <span key={tag} className="page-tag">
          #{tag}
          {canEdit && (
            <button type="button" className="page-tag-remove" aria-label={`Remove tag ${tag}`}
              onClick={() => remove(tag)}>×</button>
          )}
        </span>
      ))}
      {canEdit && (adding ? (
        <input ref={inputRef} className="page-tag-input" autoFocus placeholder="tag name"
          maxLength={40} aria-label="New tag" onBlur={commit} onKeyDown={onKey} />
      ) : (
        <button type="button" className="page-tag-add" onClick={() => setAdding(true)}>
          + tag
        </button>
      ))}
    </div>
  )
}
