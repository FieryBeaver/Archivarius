import { lazy, Suspense, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import DocEditor from '../features/editor/DocEditor'
import type { Page } from '../lib/types'
import { usePages } from '../state/pages'
import EmptyState from './EmptyState'
import ErrorBoundary from './ErrorBoundary'
import PageTitle from './PageTitle'
import './PageView.css'

const MapView = lazy(() => import('../features/map/MapView'))
const TimelineView = lazy(() => import('../features/timeline/TimelineView'))

function PageBody({ page }: { page: Page }) {
  switch (page.kind) {
    case 'doc':
      return <DocEditor key={page.id} page={page} />
    case 'map':
      return <MapView key={page.id} page={page} canEdit />
    case 'timeline':
      return <TimelineView key={page.id} page={page} canEdit />
  }
}

export default function PageView() {
  const { projectId, pageId = '' } = useParams()
  const navigate = useNavigate()
  const status = usePages((s) => s.status)
  const page = usePages((s) => s.pages.find((p) => p.id === pageId))
  const expandTo = usePages((s) => s.expandTo)

  // Reveal the page in the tree (re-run when it moves under a new parent).
  const foundId = page?.id
  const parentId = page?.parent_id
  useEffect(() => {
    if (foundId) expandTo(foundId)
  }, [foundId, parentId, expandTo])

  if (status !== 'ready') return null
  if (!page) {
    return <EmptyState message="This page has wandered off the map."
      actionLabel="Back to the world" onAction={() => navigate(`/project/${projectId}`)} />
  }

  return (
    <article className={`page-view kind-${page.kind}`}>
      <PageTitle key={page.id} page={page} />
      <div className="page-body">
        <ErrorBoundary resetKey={page.id}>
          <Suspense fallback={<div className="page-loading">Loading…</div>}>
            <PageBody page={page} />
          </Suspense>
        </ErrorBoundary>
      </div>
    </article>
  )
}
