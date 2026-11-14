import { useEffect, useRef, useState } from 'react'
import type { Page, Plugin } from '../../lib/types'
import { effectiveRole, usePages } from '../../state/pages'
import { usePanelStore } from '../../state/panel'
import {
  cleanData, loadPlugins, loadSource,
  PLUGIN_DEFAULT_HEIGHT, PLUGIN_MAX_HEIGHT, PLUGIN_MIN_HEIGHT, readTheme,
} from './pluginBlock'

interface Props {
  page: Page
  /** The hosted plugin's id (from tab.plugin). */
  pluginId: string
  /** The tab's stored plugin data. */
  data: unknown
  canEdit: boolean
  /** Persist new data (debounced by the page's normal tabs save path). */
  onData(data: unknown): void
}

type Loaded = { plugin: Plugin; source: string } | { error: string } | null

/**
 * A full-tab plugin host (v0.7, workstream 2A). Same sandbox and bridge as
 * pluginBlock — sandbox="allow-scripts" only — but the data lives in the
 * page tab (tab.plugin.data) instead of a block node.
 */
export default function PluginTabView({ page, pluginId, data, canEdit, onData }: Props) {
  const [loaded, setLoaded] = useState<Loaded>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  // Live refs: the message handler is registered once per source.
  const dataRef = useRef(data)
  const onDataRef = useRef(onData)
  onDataRef.current = onData

  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        let plugin = (await loadPlugins(page.project_id)).find((p) => p.id === pluginId)
        // Cache may predate an upload made in another tab/dialog.
        if (!plugin && live) plugin = (await loadPlugins(page.project_id, true)).find((p) => p.id === pluginId)
        if (!live) return
        if (!plugin) return setLoaded({ error: 'This plugin was removed from the world.' })
        const source = await loadSource(plugin)
        if (live) setLoaded({ plugin, source })
      } catch (e) {
        if (live) setLoaded({ error: (e as Error).message })
      }
    })()
    return () => { live = false }
  }, [page.project_id, pluginId])

  const source = loaded && 'source' in loaded ? loaded.source : null

  useEffect(() => {
    if (!source) return
    const post = (msg: Record<string, unknown>) => {
      // Opaque-origin frame: '*' is the only target origin that reaches it.
      frameRef.current?.contentWindow?.postMessage(msg, '*')
    }
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current
      if (!frame || event.source !== frame.contentWindow) return
      const msg = event.data as unknown
      if (!msg || typeof msg !== 'object') return
      const type = (msg as { type?: unknown }).type
      if (typeof type !== 'string' || !type.startsWith('archivarius:')) return
      const m = msg as Record<string, unknown>

      switch (type) {
        case 'archivarius:ready':
          post({
            type: 'archivarius:init',
            data: dataRef.current ?? null,
            canEdit,
            role: effectiveRole(usePages.getState()),
            roleName: usePages.getState().roleName,
            theme: hostRef.current ? readTheme(hostRef.current) : {},
          })
          break
        case 'archivarius:set-data': {
          if (!canEdit) return
          const clean = cleanData(m.data)
          dataRef.current = clean
          onDataRef.current(clean)
          break
        }
        case 'archivarius:resize': {
          const h = Number(m.height)
          if (!Number.isFinite(h) || !frameRef.current) return
          const px = Math.round(Math.min(PLUGIN_MAX_HEIGHT, Math.max(PLUGIN_MIN_HEIGHT, h)))
          frameRef.current.style.height = `${px}px`
          break
        }
        case 'archivarius:open-page':
          if (typeof m.pageId === 'string' && m.pageId) usePanelStore.getState().openPreview(m.pageId)
          break
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [source, canEdit])

  return (
    <div ref={hostRef} className="plugin-tab">
      {loaded === null && <p className="plugin-tab-status">Loading plugin…</p>}
      {loaded && 'error' in loaded && (
        <p className="plugin-tab-status plugin-tab-error">Couldn't load this plugin: {loaded.error}</p>
      )}
      {loaded && 'source' in loaded && (
        <iframe
          ref={frameRef}
          className="plugin-tab-frame"
          title={loaded.plugin.name}
          // Never allow-same-origin: the source is user-uploaded HTML.
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          style={{ height: PLUGIN_DEFAULT_HEIGHT }}
          srcDoc={loaded.source}
        />
      )}
    </div>
  )
}
