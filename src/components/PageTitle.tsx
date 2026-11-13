import { useState } from 'react'
import type { Page } from '../lib/types'
import { usePages } from '../state/pages'
import { pageIcon } from './pageIcon'

/** Big borderless title; persists on blur or Enter. Key by page id. */
export default function PageTitle({ page }: { page: Page }) {
  const update = usePages((s) => s.update)
  const [value, setValue] = useState(page.title)
  const [error, setError] = useState<string | null>(null)

  // Pick up renames made elsewhere (e.g. the sidebar).
  const [synced, setSynced] = useState(page.title)
  if (page.title !== synced) {
    setSynced(page.title)
    setValue(page.title)
  }

  function save() {
    const title = value.trim() || 'Untitled'
    setValue(title)
    if (title === page.title) return
    setError(null)
    update(page.id, { title }).catch((e: Error) => setError(e.message))
  }

  return (
    <header className="page-header">
      <div className="page-meta">
        <span>{pageIcon(page)}</span>
        {page.is_secret && <span className="page-secret">🔒 Secret</span>}
      </div>
      <input className="page-title" value={value} placeholder="Untitled" aria-label="Page title"
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
      {error && <p className="error-text">{error}</p>}
    </header>
  )
}
