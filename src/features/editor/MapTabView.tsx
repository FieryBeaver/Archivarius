import { lazy, Suspense, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ErrorBoundary from '../../components/ErrorBoundary'
import Popover from '../../components/Popover'
import { getPage } from '../../lib/db'
import { PageIcon } from '../../lib/icons'
import type { Page } from '../../lib/types'
import { useCanEditPage } from '../../state/pageEditors'
import { hidesSecrets, pagePath, useHiddenVia, usePages } from '../../state/pages'
import { MapTabPicker } from './MapTabPicker'

// Leaflet stays in the map chunk, as on map pages.
const MapView = lazy(() => import('../map/MapView'))

interface Props {
  /** The note hosting the tab. */
  page: Page
  mapPageId: string
  /** Edit rights on the NOTE: tab management (relink/remove). Map editing uses the map page's own rights. */
  canEditNote: boolean
  /** Remove the tab (undefined when it is the note's only tab). */
  onRemove?(): void
  /** Point the tab at another map page. */
  onRelink(map: Page): void
}

/**
 * A tab that embeds a map page (kind 'map'). Pins/regions load and save against the map page
 * itself, so RLS and edit rights are the map page's. The tab is unmounted while inactive
 * (DocEditor renders only the active tab) and MapCanvas re-fits/invalidates Leaflet's size
 * through its ResizeObserver whenever it is shown again.
 */
export default function MapTabView({ page, mapPageId, canEditNote, onRemove, onRelink }: Props) {
  const navigate = useNavigate()
  const stored = usePages((s) => s.pages.find((p) => p.id === mapPageId))
  const hideSecrets = usePages(hidesSecrets)
  // Secrecy is a subtree property: a map under a secret page is hidden with it.
  const hiddenVia = useHiddenVia(mapPageId)
  // Not in the loaded tree (e.g. created elsewhere moments ago): ask the API once.
  // undefined = not fetched / loading, null = unreadable (deleted, secret, RLS-hidden).
  const [fetched, setFetched] = useState<Page | null | undefined>(undefined)
  const inStore = !!stored
  useEffect(() => {
    if (inStore) return
    let live = true
    setFetched(undefined)
    getPage(mapPageId).then(
      (p) => { if (live) setFetched(p) },
      () => { if (live) setFetched(null) },
    )
    return () => { live = false }
  }, [mapPageId, inStore])

  const candidate = stored ?? fetched
  const mapPage = candidate
    && candidate.kind === 'map'
    && candidate.project_id === page.project_id
    && !((candidate.is_secret || hiddenVia !== null) && hideSecrets)
    ? candidate : null
  const canEditMap = useCanEditPage(mapPage ?? undefined)
  const [pickAt, setPickAt] = useState<DOMRect | null>(null)

  if (!stored && fetched === undefined) {
    return <div className="plugin-tab"><p className="plugin-tab-status">Loading map…</p></div>
  }

  if (!mapPage) {
    return (
      <div className="plugin-tab plugin-tab-missing map-tab-missing">
        <p className="plugin-tab-status">
          Map unavailable — it was deleted, or it isn't shared with you.
        </p>
        {canEditNote && (
          <div className="plugin-tab-missing-actions">
            <button type="button" className="btn-ghost plugin-tab-reconnect"
              onClick={(e) => setPickAt(e.currentTarget.getBoundingClientRect())}>
              Pick another map…
            </button>
            {onRemove && (
              <button type="button" className="btn-ghost plugin-tab-reconnect" onClick={onRemove}>
                Remove tab
              </button>
            )}
          </div>
        )}
        {pickAt && (
          <Popover anchor={pickAt} onClose={() => setPickAt(null)} width={300} className="tab-plugin-pick">
            <MapTabPicker excludeId={mapPageId}
              onPick={(m) => { setPickAt(null); onRelink(m) }}
              onClose={() => setPickAt(null)} />
          </Popover>
        )}
      </div>
    )
  }

  return (
    <div className="map-tab">
      <div className="map-tab-head">
        <button type="button" className="btn-ghost map-tab-open" title="Open the map's own page"
          onClick={() => navigate(pagePath(mapPage.project_id, mapPage.id))}>
          <PageIcon page={mapPage} size={14} />
          <span>{mapPage.title || 'Untitled'}</span>
          <span aria-hidden>↗</span>
        </button>
      </div>
      <div className="map-tab-frame">
        <ErrorBoundary resetKey={mapPage.id}>
          <Suspense fallback={<p className="plugin-tab-status">Loading map…</p>}>
            <MapView page={mapPage} canEdit={canEditMap} />
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  )
}
