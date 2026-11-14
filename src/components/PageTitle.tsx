import { useState } from 'react'
import { pageIconOf, renderIcon } from '../lib/icons'
import type { Page } from '../lib/types'
import { useCanEditPage } from '../state/pageEditors'
import { effectiveRole, usePages } from '../state/pages'
import Breadcrumbs from './Breadcrumbs'
import EditAccessControl from './EditAccessControl'
import IconPicker from './IconPicker'
import LockIcon from './LockIcon'
import Popover from './Popover'

/** Breadcrumbs, page icon, big borderless title (persists on blur or Enter), secret + edit-access pills. Key by page id. */
export default function PageTitle({ page }: { page: Page }) {
  const update = usePages((s) => s.update)
  const canEdit = useCanEditPage(page)
  const isOwner = usePages((s) => effectiveRole(s) === 'owner')
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
        {isOwner ? (
          <button type="button" className={`page-secret-toggle${page.is_secret ? ' on' : ''}`}
            aria-pressed={page.is_secret} title="DM only — only owners see this page"
            onClick={() => attempt({ is_secret: !page.is_secret })}>
            <LockIcon open={!page.is_secret} />
            <span>{page.is_secret ? 'Secret' : 'Visible'}</span>
          </button>
        ) : page.is_secret && (
          <span className="page-secret-toggle on static" title="DM only — only owners see this page">
            <LockIcon /><span>Secret</span>
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

      {iconAnchor && canEdit && (
        <Popover anchor={iconAnchor} onClose={() => setIconAnchor(null)} width={320} role="presentation"
          className="popover-padded">
          <IconPicker value={page.icon} onSelect={pickIcon} />
        </Popover>
      )}
    </header>
  )
}
