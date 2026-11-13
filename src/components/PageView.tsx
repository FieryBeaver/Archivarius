import { lazy, Suspense, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import DocEditor from '../features/editor/DocEditor'
import type { Page } from '../lib/types'
import { useCanEditPage } from '../state/pageEditors'
import { hidesSecrets, usePages } from '../state/pages'
import EmptyState from './EmptyState'
import ErrorBoundary from './ErrorBoundary'
import PageTitle from './PageTitle'
import './PageView.css'

const MapView = lazy(() => import('../features/map/MapView'))
const TimelineView = lazy(() => import('../features/timeline/TimelineView'))

function PageBody({ page, canEdit }: { page: Page; canEdit: boolean }) {
  switch (page.kind) {
    case 'doc':
      return <DocEditor key={page.id} page={page} canEdit={canEdit} />
    case 'map':
      return <MapView key={page.id} page={page} canEdit={canEdit} />
    case 'timeline':
      return <TimelineView key={page.id} page={page} canEdit={canEdit} />
  }
}

export default function PageView() {
  const { projectId, pageId = '' } = useParams()
  const navigate = useNavigate()
  const status = usePages((s) => s.status)
  const page = usePages((s) => s.pages.find((p) => p.id === pageId))
  const expandTo = usePages((s) => s.expandTo)
  const hideSecrets = usePages(hidesSecrets)
  const previewing = usePages((s) => s.viewAs !== null)
  const setViewAs = usePages((s) => s.setViewAs)
  const setHideSecrets = usePages((s) => s.setHideSecrets)
  // Per page: restricted pages are writable only by owners and listed page editors.
  const canEdit = useCanEditPage(page)

  // Reveal the page in the tree (re-run when it moves under a new parent).
  const foundId = page?.id
  const parentId = page?.parent_id
  useEffect(() => {
    if (foundId) expandTo(foundId)
  }, [foundId, parentId, expandTo])

  if (status !== 'ready') return null
  if (!page) {
    return <EmptyState glyph="✧" title="Page not found" message="This page has wandered off the map."
      actionLabel="Back to the world" onAction={() => navigate(`/project/${projectId}`)} />
  }
  if (page.is_secret && hideSecrets) {
    return previewing ? (
      <EmptyState glyph="🔒" title="Hidden from players"
        message="This page is a secret — players don't see it at all."
        actionLabel="Exit player preview" onAction={() => setViewAs(null)} />
    ) : (
      <EmptyState glyph="🔒" title="Secrets are hidden"
        message="This page is a secret, and secrets are hidden right now."
        actionLabel="Show secrets" onAction={() => setHideSecrets(false)} />
    )
  }

  return (
    <article className={`page-view kind-${page.kind}`}>
      <PageTitle key={page.id} page={page} />
      <div className="page-body">
        <ErrorBoundary resetKey={page.id}>
          <Suspense fallback={<div className="page-loading">Loading…</div>}>
            <PageBody page={page} canEdit={canEdit} />
          </Suspense>
        </ErrorBoundary>
      </div>
    </article>
  )
}
