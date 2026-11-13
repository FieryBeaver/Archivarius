import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as db from '../lib/db'
import { PageIcon } from '../lib/icons'
import type { Page, PageKind } from '../lib/types'
import { usePanelStore } from '../state/panel'
import { hidesSecrets, pagePath, usePages } from '../state/pages'
import ErrorBoundary from './ErrorBoundary'
import LockIcon from './LockIcon'
import { CloseGlyph } from './UiIcons'

const ReadOnlyDoc = lazy(() => import('../features/editor/ReadOnlyDoc'))

const KIND_LABEL: Record<PageKind, string> = { doc: 'Page', map: 'Map', timeline: 'Timeline' }

/** undefined = loading, null = hidden from me (RLS) or gone */
type Loaded = { id: string; page: Page | null }

/**
 * Page preview panel driven by `usePanelStore` (anyone may call openPreview).
 * Desktop: a right-hand column. Mobile: a bottom sheet over a scrim.
 */
export default function ContextPanel({ projectId, isMobile }: { projectId: string; isMobile: boolean }) {
  const pageId = usePanelStore((s) => s.previewPageId)
  const closePreview = usePanelStore((s) => s.closePreview)
  const hideSecrets = usePages(hidesSecrets)
  const navigate = useNavigate()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!pageId) return
    let live = true
    db.getPage(pageId).then(
      (page) => live && setLoaded({ id: pageId, page }),
      () => live && setLoaded({ id: pageId, page: null }),
    )
    return () => { live = false }
  }, [pageId])

  useEffect(() => {
    if (!pageId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) closePreview()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [pageId, closePreview])

  // The sheet is modal on phones: move focus into it.
  useEffect(() => {
    if (pageId && isMobile) closeRef.current?.focus()
  }, [pageId, isMobile])

  if (!pageId) return null
  let page = loaded?.id === pageId ? loaded.page : undefined
  // While previewing as a viewer, a secret page previews as it would for them: not at all.
  if (page?.is_secret && hideSecrets) page = null

  function open() {
    if (!pageId) return
    navigate(pagePath(projectId, pageId))
    closePreview()
  }

  const panel = (
    <aside className={`preview-panel${isMobile ? ' sheet' : ''}`} aria-label="Page preview"
      role={isMobile ? 'dialog' : 'complementary'} aria-modal={isMobile || undefined}>
      {isMobile && <span className="preview-grabber" aria-hidden />}
      <header className="preview-head">
        <span className="preview-eyebrow">Preview</span>
        <button ref={closeRef} type="button" className="preview-close" aria-label="Close preview" title="Close (Esc)"
          onClick={closePreview}>
          <CloseGlyph />
        </button>
      </header>

      {page === undefined ? (
        <p className="preview-muted">Loading…</p>
      ) : page === null ? (
        <p className="preview-muted">You can't see this page.</p>
      ) : (
        <>
          <div className="preview-title-row">
            <span className="preview-icon"><PageIcon page={page} /></span>
            <div className="preview-title-text">
              <h2 className="preview-title">{page.title || 'Untitled'}</h2>
              <span className="preview-kind">
                {KIND_LABEL[page.kind]}
                {page.is_secret && <><span aria-hidden> · </span><LockIcon size={10} /> Secret</>}
              </span>
            </div>
          </div>
          <button type="button" className="btn-primary preview-open" onClick={open}>Open page</button>
          <div className="preview-body">
            <PreviewBody page={page} />
          </div>
        </>
      )}
    </aside>
  )

  if (!isMobile) return panel
  return (
    <>
      <div className="preview-scrim" aria-hidden onClick={closePreview} />
      {panel}
    </>
  )
}

function PreviewBody({ page }: { page: Page }) {
  if (page.kind === 'map') {
    return page.map_image_path
      ? <img className="preview-map" src={db.mapImageUrl(page.map_image_path)} alt="" loading="lazy" />
      : <p className="preview-muted">No map image yet.</p>
  }
  if (page.kind === 'timeline') {
    return <p className="preview-muted">Open the timeline to browse its events.</p>
  }
  const content = page.tabs?.[0]?.content ?? page.content
  if (!content) return <p className="preview-muted">This page is empty.</p>
  return (
    <ErrorBoundary resetKey={page.id}>
      <Suspense fallback={<p className="preview-muted">Loading…</p>}>
        <ReadOnlyDoc content={content} />
      </Suspense>
    </ErrorBoundary>
  )
}
