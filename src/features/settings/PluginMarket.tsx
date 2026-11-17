import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as db from '../../lib/db'
import { renderIcon } from '../../lib/icons'
import type { Plugin, ProjectPrefs } from '../../lib/types'
import { useProjectPrefs } from '../../state/project'
import {
  MAX_CUSTOM_PROVIDERS, OFFICIAL_PROVIDER_URL, customProviders, downloadPlugin, isOfficialProvider, loadIndex,
  normalizeProviderUrl, primeIndex, probeProvider, providerUrlProblem, type MarketEntry, type MarketIndex,
} from './pluginMarket'

/** Shown for market entries without a renderable icon (same as PluginsTab's default). */
const FALLBACK_ICON = 'gi:GiRuneStone'

type IndexState =
  | { status: 'loading' }
  | { status: 'ok'; index: MarketIndex }
  | { status: 'error'; error: string }

function errMsg(e: unknown, fallback: string): string {
  return (e as Error)?.message || fallback
}

function hostOf(url: string): string {
  try { return new URL(url).host } catch { return url }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${Math.round((bytes / 1024) * 10) / 10} KB`
}

/**
 * "Get plugins": browse provider registries and add plugins to the world.
 * Everyone sees the catalog; only owners add plugins or edit the provider list
 * (stored in projects.prefs.pluginProviders). Fetched plugin HTML is only uploaded, never run here.
 */
export function PluginMarket(props: {
  projectId: string
  projectPrefs: ProjectPrefs | null | undefined
  isOwner: boolean
  plugins: Plugin[] | null
  setBusy(b: boolean): void
  onAdded(): Promise<void>
}) {
  const { projectId, isOwner } = props
  const storePrefs = useProjectPrefs((s) => (s.projectId === projectId ? s.prefs : undefined))
  const setStorePrefs = useProjectPrefs((s) => s.setPrefs)
  // The store has the latest saved prefs for the open world; the project row may predate a save.
  const prefs: ProjectPrefs = (storePrefs !== undefined ? storePrefs : props.projectPrefs) ?? {}
  const custom = customProviders(prefs)
  const providers = [OFFICIAL_PROVIDER_URL, ...custom]

  const [selected, setSelected] = useState(OFFICIAL_PROVIDER_URL)
  const current = providers.includes(selected) ? selected : OFFICIAL_PROVIDER_URL
  const [names, setNames] = useState<Record<string, string>>({})
  const [state, setState] = useState<IndexState>({ status: 'loading' })
  const [query, setQuery] = useState('')

  const fetchIndex = useCallback((url: string, refresh: boolean) => {
    let live = true
    setState({ status: 'loading' })
    loadIndex(url, refresh).then(
      (index) => {
        if (!live) return
        setState({ status: 'ok', index })
        setNames((n) => (n[url] === index.name ? n : { ...n, [url]: index.name }))
      },
      (e) => { if (live) setState({ status: 'error', error: errMsg(e, 'Could not load the catalog.') }) },
    )
    return () => { live = false }
  }, [])

  const [reloadKey, setReloadKey] = useState(0)
  useEffect(() => fetchIndex(current, reloadKey > 0), [fetchIndex, current, reloadKey])

  const label = (url: string) => (url === OFFICIAL_PROVIDER_URL ? 'Official' : names[url] || hostOf(url))

  /* ---- provider list (owners) ---- */

  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [probing, setProbing] = useState(false)
  const [providerError, setProviderError] = useState<string | null>(null)
  const [providerNote, setProviderNote] = useState<string | null>(null)

  const savePrefs = async (next: ProjectPrefs): Promise<ProjectPrefs> => {
    const p = await db.updateProjectPrefs(projectId, next)
    const stored = p.prefs ?? next
    setStorePrefs(projectId, stored)
    return stored
  }

  const cancelAdd = () => { setAdding(false); setDraft(''); setProviderError(null) }

  // Escape in the URL field cancels the form only. A native listener on the input itself runs
  // before SettingsDialog's document-level Escape handler, which skips defaultPrevented events.
  const urlInputRef = useRef<HTMLInputElement>(null)
  const cancelAddRef = useRef(cancelAdd)
  cancelAddRef.current = cancelAdd
  useEffect(() => {
    const el = urlInputRef.current
    if (!el) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      cancelAddRef.current()
    }
    el.addEventListener('keydown', onKey)
    return () => el.removeEventListener('keydown', onKey)
  }, [adding])

  const addProvider = async () => {
    const problem = providerUrlProblem(draft)
    if (problem) { setProviderError(problem); return }
    const url = normalizeProviderUrl(draft)
    if (isOfficialProvider(url)) {
      setProviderError('That registry is already available as Official.')
      return
    }
    if (custom.includes(url)) {
      setProviderError(`That registry is already available as “${label(url)}”.`)
      return
    }
    if (custom.length >= MAX_CUSTOM_PROVIDERS) {
      setProviderError(`A world can have at most ${MAX_CUSTOM_PROVIDERS} custom providers.`)
      return
    }
    setProbing(true)
    setProviderError(null)
    setProviderNote(null)
    props.setBusy(true)
    try {
      const index = await probeProvider(url)
      const stored = await savePrefs({ ...prefs, pluginProviders: [...custom, url] })
      if (!customProviders(stored).includes(url)) throw new Error('The provider could not be saved. Please try again.')
      primeIndex(url, index)
      setNames((n) => ({ ...n, [url]: index.name }))
      setProviderNote(`Added “${index.name}” · ${index.plugins.length} plugin${index.plugins.length === 1 ? '' : 's'}.`)
      setDraft('')
      setAdding(false)
      setSelected(url)
      setQuery('')
    } catch (e) {
      setProviderError(errMsg(e, 'Could not add that provider.'))
    } finally {
      setProbing(false)
      props.setBusy(false)
    }
  }

  const removeProvider = async (url: string) => {
    setProbing(true)
    setProviderError(null)
    setProviderNote(null)
    props.setBusy(true)
    try {
      await savePrefs({ ...prefs, pluginProviders: custom.filter((u) => u !== url) })
      setSelected(OFFICIAL_PROVIDER_URL)
      setProviderNote(`Removed “${label(url)}”. Plugins already added from it stay in the world.`)
    } catch (e) {
      setProviderError(errMsg(e, 'Could not remove that provider.'))
    } finally {
      setProbing(false)
      props.setBusy(false)
    }
  }

  /* ---- catalog ---- */

  const [installing, setInstalling] = useState<string | null>(null)
  const [installError, setInstallError] = useState<{ slug: string; msg: string } | null>(null)
  const [installed, setInstalled] = useState<string | null>(null)

  const existingNames = new Set((props.plugins ?? []).map((p) => p.name.toLowerCase()))

  const index = state.status === 'ok' ? state.index : null
  const visible = useMemo(() => {
    if (!index) return []
    const q = query.trim().toLowerCase()
    if (!q) return index.plugins
    return index.plugins.filter((p) =>
      p.name.toLowerCase().includes(q)
      || p.blurb.toLowerCase().includes(q)
      || p.tags.some((t) => t.toLowerCase().includes(q)))
  }, [index, query])

  const install = async (entry: MarketEntry) => {
    if (!index || installing) return
    setInstalling(entry.slug)
    setInstallError(null)
    setInstalled(null)
    props.setBusy(true)
    try {
      // Bytes only: the HTML is checked and uploaded, never rendered or executed here.
      const file = await downloadPlugin(index, entry)
      await db.createPlugin(projectId, { name: entry.name, icon: entry.icon, file })
      setInstalled(entry.name)
      await props.onAdded()
    } catch (e) {
      setInstallError({ slug: entry.slug, msg: errMsg(e, `Could not add ${entry.name}.`) })
    } finally {
      setInstalling(null)
      props.setBusy(false)
    }
  }

  const switchTo = (url: string) => {
    setSelected(url)
    setQuery('')
    setInstallError(null)
    setInstalled(null)
    setProviderError(null)
    setProviderNote(null)
  }

  return (
    <div className="wks-field">
      <div className="wks-label">Get plugins</div>

      <div className="wks-market-providers">
        <select className="wks-select wks-market-select" aria-label="Plugin provider" value={current}
          disabled={probing} onChange={(e) => switchTo(e.target.value)}>
          {providers.map((url) => <option key={url} value={url}>{label(url)}</option>)}
        </select>
        <button type="button" className="btn-ghost wks-btn" disabled={state.status === 'loading'}
          title="Reload this provider’s catalog" onClick={() => setReloadKey((k) => k + 1)}>
          {state.status === 'loading' ? 'Loading…' : 'Refresh'}
        </button>
        {isOwner && current !== OFFICIAL_PROVIDER_URL && (
          <button type="button" className="btn-danger wks-btn" disabled={probing}
            onClick={() => { void removeProvider(current) }}>
            Remove provider
          </button>
        )}
        {isOwner && !adding && (
          <button type="button" className="btn-ghost wks-btn" disabled={probing}
            onClick={() => { setAdding(true); setProviderError(null); setProviderNote(null) }}>
            Add provider…
          </button>
        )}
      </div>

      {current !== OFFICIAL_PROVIDER_URL && (
        <div className="wks-hint wks-ellipsis" title={current}>{current}</div>
      )}

      {isOwner && adding && (
        <form className="wks-market-addprov"
          onSubmit={(e) => { e.preventDefault(); void addProvider() }}>
          <input ref={urlInputRef} className="wks-input" type="url" inputMode="url" autoFocus spellCheck={false}
            aria-label="Provider index URL" placeholder="https://example.com/plugins/index.json"
            value={draft} disabled={probing}
            onChange={(e) => { setDraft(e.target.value); setProviderError(null) }} />
          <button type="button" className="btn-ghost wks-btn" disabled={probing} onClick={cancelAdd}>
            Cancel
          </button>
          <button type="submit" className="btn-primary wks-btn" disabled={probing || !draft.trim()}>
            {probing ? 'Checking…' : 'Add'}
          </button>
        </form>
      )}
      {providerError && <p className="wks-error" role="alert">{providerError}</p>}
      {!providerError && providerNote && <div className="wks-hint" aria-live="polite">{providerNote}</div>}

      {state.status === 'error' && (
        <div className="wks-row-between">
          <p className="wks-error" role="alert">{state.error}</p>
          <button type="button" className="wks-btn" onClick={() => setReloadKey((k) => k + 1)}>Retry</button>
        </div>
      )}
      {state.status === 'loading' && <div className="wks-hint">Loading catalog…</div>}

      {index && (
        <>
          {(index.description || index.homepage) && (
            <div className="wks-hint">
              {index.description}
              {index.homepage && (
                <>
                  {index.description ? ' ' : ''}
                  <a href={index.homepage} target="_blank" rel="noopener noreferrer">{hostOf(index.homepage)}</a>
                </>
              )}
            </div>
          )}
          {index.plugins.length > 0 && (
            <input className="wks-input" type="search" aria-label="Search plugins"
              placeholder="Search by name, description or tag"
              value={query} onChange={(e) => setQuery(e.target.value)} />
          )}
          {index.plugins.length === 0 && <div className="wks-hint">This provider has no plugins yet.</div>}
          {index.plugins.length > 0 && visible.length === 0 && (
            <div className="wks-hint">No plugins match “{query.trim()}”.</div>
          )}
          {visible.length > 0 && (
            <ul className="wks-members wks-plugins wks-market">
              {visible.map((p) => {
                const added = existingNames.has(p.name.toLowerCase())
                const tooBig = p.bytes > db.PLUGIN_MAX_BYTES
                return (
                  <li key={p.slug} className="wks-member wks-plugin wks-market-card">
                    <div className="wks-member-main">
                      <span className="wks-plugin-icon" aria-hidden="true">
                        {renderIcon(p.icon || FALLBACK_ICON, { size: 18 })}
                      </span>
                      <div className="wks-plugin-meta">
                        <div className="wks-member-email" title={p.name}>
                          {p.name}
                          {p.version && <span className="wks-market-version"> v{p.version}</span>}
                        </div>
                        <div className="wks-plugin-date">
                          {[p.author && `by ${p.author}`, p.license, p.bytes ? formatSize(p.bytes) : '']
                            .filter(Boolean).join(' · ')}
                        </div>
                        {p.blurb && <div className="wks-market-blurb">{p.blurb}</div>}
                        {p.tags.length > 0 && (
                          <div className="wks-market-tags">
                            {p.tags.map((t) => (
                              <button key={t} type="button" className="wks-market-tag"
                                title={`Show plugins tagged “${t}”`} onClick={() => setQuery(t)}>
                                {t}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    {isOwner && (
                      <div className="wks-member-controls">
                        <button type="button" className="wks-btn"
                          disabled={added || tooBig || installing !== null}
                          title={tooBig ? `Larger than the ${db.PLUGIN_MAX_BYTES / 1024} KB plugin limit` : undefined}
                          onClick={() => { void install(p) }}>
                          {added ? 'Added ✓' : tooBig ? 'Too large' : installing === p.slug ? 'Adding…' : 'Add to world'}
                        </button>
                      </div>
                    )}
                    {installError?.slug === p.slug && (
                      <p className="wks-error wks-member-note" role="alert">{installError.msg}</p>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          {installed && <div className="wks-hint" aria-live="polite">Added “{installed}”. Type /plugin in a document to use it.</div>}
          {index.skipped > 0 && (
            <div className="wks-hint">{index.skipped} malformed entr{index.skipped === 1 ? 'y was' : 'ies were'} skipped.</div>
          )}
        </>
      )}

      <div className="wks-hint">
        {isOwner
          ? 'Plugins come from the provider’s registry and run sandboxed like any uploaded plugin. Only add providers you trust.'
          : 'Only owners can add plugins to this world.'}
      </div>
    </div>
  )
}
