import { Fragment, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageIcon } from '../lib/icons'
import type { Page } from '../lib/types'
import { ancestorsOf } from '../state/pageTree'
import { pagePath, useVisiblePages } from '../state/pages'
import LockIcon from './LockIcon'

/** Ancestor trail above the page title. Renders nothing for root pages. */
export default function Breadcrumbs({ page }: { page: Page }) {
  const navigate = useNavigate()
  // Visible pages only: while secrets are hidden, a secret ancestor must not
  // surface here (a real viewer never receives its row, so no crumb exists).
  const pages = useVisiblePages()
  const ancestors = useMemo(() => ancestorsOf(pages, page.id), [pages, page.id])
  if (ancestors.length === 0) return null

  // Long trails keep the root and the two nearest parents; the middle collapses to "…".
  const crumbs: (Page | null)[] = ancestors.length > 3
    ? [ancestors[0], null, ...ancestors.slice(-2)]
    : ancestors
  const hidden = ancestors.slice(1, -2).map((p) => p.title || 'Untitled').join(' / ')

  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      {crumbs.map((p, i) => (
        <Fragment key={p?.id ?? 'gap'}>
          {i > 0 && <span className="crumb-sep" aria-hidden="true">/</span>}
          {p ? (
            <button type="button" className={`crumb${p.is_secret ? ' secret' : ''}`}
              title={p.title || 'Untitled'}
              onClick={() => navigate(pagePath(p.project_id, p.id))}>
              <PageIcon page={p} size={14} className="crumb-icon" />
              <span className="crumb-title">{p.title || 'Untitled'}</span>
              {p.is_secret && <LockIcon size={11} className="crumb-lock" />}
            </button>
          ) : (
            <span className="crumb-gap" title={hidden}>…</span>
          )}
        </Fragment>
      ))}
    </nav>
  )
}
