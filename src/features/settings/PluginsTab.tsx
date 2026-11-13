import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import * as db from '../../lib/db'
import { renderIcon } from '../../lib/icons'
import IconPicker from '../../components/IconPicker'
import type { Plugin } from '../../lib/types'
import { STARTER_PLUGINS, type StarterPlugin } from './defaultPlugins'
import type { SettingsContext } from './SettingsDialog'
import { ROLE_LABEL } from './roles'

/** Shown for plugins without an icon of their own (also the tab icon). */
export const DEFAULT_PLUGIN_ICON = 'gi:GiRuneStone'

const NAME_MAX = 80

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${Math.round((bytes / 1024) * 10) / 10} KB`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/** Client-side checks before anything reaches the server. Returns an error message or null. */
function validatePluginFile(file: File): string | null {
  if (!/\.html?$/i.test(file.name)) return 'A plugin must be a single .html (or .htm) file.'
  if (file.size === 0) return 'That file is empty.'
  if (file.size > db.PLUGIN_MAX_BYTES) {
    return `That file is ${formatSize(file.size)}. Plugins can be at most ${db.PLUGIN_MAX_BYTES / 1024} KB — inline only what you need, or shrink embedded images.`
  }
  return null
}

function nameFromFile(fileName: string): string {
  return fileName.replace(/\.html?$/i, '').replace(/[_-]+/g, ' ').trim().slice(0, NAME_MAX)
}

/** Escape inside an inline editor closes that editor instead of the whole dialog. */
function escapeCloses(close: () => void) {
  return (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    }
  }
}

function errMsg(e: unknown, fallback: string): string {
  return (e as Error)?.message || fallback
}

export function PluginsTab({ ctx }: { ctx: SettingsContext }) {
  const { project, role, roleLoading, setBusy } = ctx
  const isOwner = role === 'owner'

  const [plugins, setPlugins] = useState<Plugin[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setPlugins(await db.listPlugins(project.id))
      setLoadError(null)
    } catch (e) {
      setLoadError(errMsg(e, 'Could not load plugins.'))
    }
  }, [project.id])

  useEffect(() => { void load() }, [load])

  const replaceInList = (p: Plugin) =>
    setPlugins((list) => (list ? list.map((x) => (x.id === p.id ? p : x)) : list))

  return (
    <div className="wks-stack">
      <p className="wks-hint wks-appearance-note">
        A plugin is a single self-contained HTML file running in a sandbox. It talks to Archivarius
        through a small messaging API — see <code>PLUGINS.md</code> in the project repository for the
        full guide and a character-sheet example.
      </p>

      {!roleLoading && !isOwner && (
        <p className="wks-hint">
          {role
            ? `You are ${/^[aeiou]/i.test(role) ? 'an' : 'a'} ${ROLE_LABEL[role].toLowerCase()} of this world. Only owners can add or change plugins.`
            : 'Only owners can add or change this world’s plugins.'}
        </p>
      )}

      {isOwner && <UploadForm projectId={project.id} setBusy={setBusy} onUploaded={load} />}

      {isOwner && <StarterPlugins projectId={project.id} plugins={plugins} setBusy={setBusy} onAdded={load} />}

      <div className="wks-field">
        <div className="wks-label">Plugins{plugins ? ` · ${plugins.length}` : ''}</div>
        {loadError && (
          <div className="wks-row-between">
            <p className="wks-error" role="alert">{loadError}</p>
            <button type="button" className="wks-btn" onClick={() => { void load() }}>Retry</button>
          </div>
        )}
        {!plugins && !loadError && <div className="wks-hint">Loading plugins…</div>}
        {plugins && plugins.length === 0 && (
          <div className="wks-plugins-empty">
            <span className="wks-plugins-empty-icon">{renderIcon(DEFAULT_PLUGIN_ICON, { size: 28 })}</span>
            <div className="wks-stack-sm">
              <div className="wks-strong">No plugins yet</div>
              <div className="wks-hint">
                Plugins add interactive blocks to your pages — character sheets, dice rollers, trackers,
                anything you can build as a web page. {isOwner ? 'Upload an HTML file above, then' : 'Once an owner uploads one,'}{' '}
                type <kbd className="wks-kbd">/plugin</kbd> in any document to insert it.
              </div>
            </div>
          </div>
        )}
        {plugins && plugins.length > 0 && (
          <>
            <ul className="wks-members wks-plugins">
              {plugins.map((p) => (
                <PluginRow
                  key={p.id}
                  plugin={p}
                  isOwner={isOwner}
                  setBusy={setBusy}
                  onUpdated={replaceInList}
                  onDeleted={(id) => setPlugins((list) => (list ? list.filter((x) => x.id !== id) : list))}
                />
              ))}
            </ul>
            <div className="wks-hint">
              Type <kbd className="wks-kbd">/plugin</kbd> in a document to insert one of these.
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/* ---------- starter plugins (v0.7) ---------- */

function StarterPlugins(props: {
  projectId: string
  plugins: Plugin[] | null
  setBusy(b: boolean): void
  onAdded(): Promise<void>
}) {
  const [adding, setAdding] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const existingNames = new Set((props.plugins ?? []).map((p) => p.name.toLowerCase()))

  const add = async (sp: StarterPlugin) => {
    if (adding) return
    setAdding(sp.key)
    setError(null)
    props.setBusy(true)
    try {
      await db.createPlugin(props.projectId, { name: sp.name, icon: sp.icon, file: sp.source })
      await props.onAdded()
    } catch (e) {
      setError(errMsg(e, `Could not add ${sp.name}.`))
    } finally {
      setAdding(null)
      props.setBusy(false)
    }
  }

  return (
    <div className="wks-field">
      <div className="wks-label">Starter plugins</div>
      <ul className="wks-members wks-plugins">
        {STARTER_PLUGINS.map((sp) => {
          const added = existingNames.has(sp.name.toLowerCase())
          return (
            <li key={sp.key} className="wks-member wks-plugin">
              <div className="wks-member-main">
                <span className="wks-plugin-icon" aria-hidden="true">{renderIcon(sp.icon, { size: 18 })}</span>
                <div className="wks-plugin-meta">
                  <div className="wks-member-email">{sp.name}</div>
                  <div className="wks-plugin-date">{sp.blurb}</div>
                </div>
              </div>
              <div className="wks-member-controls">
                <button type="button" className="wks-btn" disabled={added || adding !== null}
                  onClick={() => { void add(sp) }}>
                  {added ? 'Added ✓' : adding === sp.key ? 'Adding…' : 'Add to world'}
                </button>
              </div>
            </li>
          )
        })}
      </ul>
      {error && <p className="wks-error" role="alert">{error}</p>}
      <div className="wks-hint">
        Ready-made sheets, added like any uploaded plugin — rename, re-icon or replace them afterwards.
      </div>
    </div>
  )
}

/* ---------- upload ---------- */

function UploadForm(props: { projectId: string; setBusy(b: boolean): void; onUploaded(): Promise<void> }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [icon, setIcon] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const reset = () => {
    setFile(null)
    setName('')
    setIcon(null)
    setPicking(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  const onPick = (f: File | undefined) => {
    if (fileRef.current) fileRef.current.value = ''
    if (!f) return
    setDone(null)
    const problem = validatePluginFile(f)
    if (problem) {
      setError(problem)
      return
    }
    setError(null)
    setFile(f)
    if (!name.trim()) setName(nameFromFile(f.name))
  }

  const submit = async () => {
    if (!file || uploading) return
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Give the plugin a name.')
      return
    }
    const problem = validatePluginFile(file)
    if (problem) {
      setError(problem)
      return
    }
    setUploading(true)
    props.setBusy(true)
    setError(null)
    try {
      await db.createPlugin(props.projectId, { name: trimmed, icon, file })
      reset()
      setDone(trimmed)
      await props.onUploaded()
    } catch (e) {
      setError(errMsg(e, 'Could not upload the plugin.'))
    } finally {
      setUploading(false)
      props.setBusy(false)
    }
  }

  return (
    // A div, not a form: the inline IconPicker contains its own <form>.
    <div className="wks-field">
      <div className="wks-label">Upload plugin</div>
      <input
        ref={fileRef}
        className="wks-file-input"
        tabIndex={-1}
        aria-hidden="true"
        type="file"
        accept=".html,.htm,text/html"
        disabled={uploading}
        onChange={(e) => onPick(e.target.files?.[0])}
      />
      <div className="wks-plugin-upload">
        <div className="wks-plugin-file">
          <button type="button" className="wks-btn" disabled={uploading} onClick={() => fileRef.current?.click()}>
            {file ? 'Change file…' : 'Choose HTML file…'}
          </button>
          {file ? (
            <span className="wks-hint wks-ellipsis" title={file.name}>
              {file.name} · {formatSize(file.size)}
            </span>
          ) : (
            <span className="wks-hint">.html, up to {db.PLUGIN_MAX_BYTES / 1024} KB</span>
          )}
        </div>
        {file && (
          <>
            <div className="wks-plugin-namerow">
              <button
                type="button"
                className={'wks-btn wks-icon-btn wks-plugin-iconbtn' + (picking ? ' active' : '')}
                disabled={uploading}
                aria-expanded={picking}
                aria-label="Choose plugin icon"
                title="Choose icon"
                onClick={() => setPicking((v) => !v)}
              >
                {renderIcon(icon || DEFAULT_PLUGIN_ICON, { size: 18 })}
              </button>
              <input
                className="wks-input wks-plugin-name-input"
                aria-label="Plugin name"
                placeholder="Plugin name"
                maxLength={NAME_MAX}
                value={name}
                disabled={uploading}
                onChange={(e) => { setName(e.target.value); setError(null) }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit() } }}
              />
            </div>
            {picking && (
              <div className="wks-plugin-picker" onKeyDown={escapeCloses(() => setPicking(false))}>
                <IconPicker value={icon} onSelect={(i) => { setIcon(i); setPicking(false) }} />
              </div>
            )}
            <div className="wks-actions">
              <button type="button" className="btn-ghost wks-btn" disabled={uploading} onClick={() => { reset(); setError(null) }}>
                Cancel
              </button>
              <button type="button" className="btn-primary wks-btn" disabled={uploading || !name.trim()}
                onClick={() => { void submit() }}>
                {uploading ? 'Uploading…' : 'Upload'}
              </button>
            </div>
          </>
        )}
      </div>
      {error && <p className="wks-error" role="alert">{error}</p>}
      {!error && done && <div className="wks-hint" aria-live="polite">Uploaded “{done}”. Type /plugin in a document to use it.</div>}
    </div>
  )
}

/* ---------- list row ---------- */

type Mode = 'idle' | 'rename' | 'icon' | 'confirm-delete'

function PluginRow(props: {
  plugin: Plugin
  isOwner: boolean
  setBusy(b: boolean): void
  onUpdated(p: Plugin): void
  onDeleted(id: string): void
}) {
  const { plugin, isOwner } = props
  const fileRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<Mode>('idle')
  const [draft, setDraft] = useState(plugin.name)
  const [pending, setPending] = useState<null | 'save' | 'upload' | 'delete'>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const busy = pending !== null

  const run = async (kind: 'save' | 'upload' | 'delete', fn: () => Promise<void>, fallback: string) => {
    setPending(kind)
    setError(null)
    setNote(null)
    props.setBusy(true)
    try {
      await fn()
    } catch (e) {
      setError(errMsg(e, fallback))
    } finally {
      setPending(null)
      props.setBusy(false)
    }
  }

  const saveName = () => {
    const v = draft.trim()
    if (!v) { setError('Name cannot be empty.'); return }
    if (v === plugin.name) { setMode('idle'); return }
    void run('save', async () => {
      props.onUpdated(await db.updatePlugin(plugin.id, { name: v }))
      setMode('idle')
    }, 'Could not rename the plugin.')
  }

  const saveIcon = (icon: string | null) => {
    setMode('idle')
    if (icon === plugin.icon) return
    void run('save', async () => {
      props.onUpdated(await db.updatePlugin(plugin.id, { icon }))
    }, 'Could not change the icon.')
  }

  const replaceFile = (f: File | undefined) => {
    if (fileRef.current) fileRef.current.value = ''
    if (!f) return
    const problem = validatePluginFile(f)
    if (problem) { setError(problem); setNote(null); return }
    void run('upload', async () => {
      props.onUpdated(await db.updatePlugin(plugin.id, {}, f))
      setNote(`Replaced with ${f.name}. Open documents pick it up on reload.`)
    }, 'Could not replace the file.')
  }

  const remove = () => {
    void run('delete', async () => {
      await db.deletePlugin(plugin)
      props.onDeleted(plugin.id)
    }, 'Could not delete the plugin.')
  }

  const date = formatDate(plugin.created_at)

  return (
    <li className="wks-member wks-plugin">
      <div className="wks-member-main">
        {isOwner ? (
          <button
            type="button"
            className={'btn-ghost wks-btn wks-icon-btn wks-plugin-iconbtn' + (mode === 'icon' ? ' active' : '')}
            disabled={busy}
            aria-expanded={mode === 'icon'}
            aria-label={`Change icon for ${plugin.name}`}
            title="Change icon"
            onClick={() => setMode(mode === 'icon' ? 'idle' : 'icon')}
          >
            {renderIcon(plugin.icon || DEFAULT_PLUGIN_ICON, { size: 18 })}
          </button>
        ) : (
          <span className="wks-plugin-icon" aria-hidden="true">
            {renderIcon(plugin.icon || DEFAULT_PLUGIN_ICON, { size: 18 })}
          </span>
        )}
        {mode === 'rename' ? (
          <form
            className="wks-plugin-rename"
            onSubmit={(e) => { e.preventDefault(); saveName() }}
            onKeyDown={escapeCloses(() => { setMode('idle'); setDraft(plugin.name); setError(null) })}
          >
            <input
              className="wks-input"
              aria-label="Plugin name"
              autoFocus
              maxLength={NAME_MAX}
              value={draft}
              disabled={busy}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button type="button" className="btn-ghost wks-btn" disabled={busy}
              onClick={() => { setMode('idle'); setDraft(plugin.name); setError(null) }}>
              Cancel
            </button>
            <button type="submit" className="btn-primary wks-btn" disabled={busy || !draft.trim()}>
              {pending === 'save' ? 'Saving…' : 'Save'}
            </button>
          </form>
        ) : (
          <div className="wks-plugin-meta">
            <div className="wks-member-email" title={plugin.name}>{plugin.name}</div>
            {date && <div className="wks-plugin-date">Added {date}</div>}
          </div>
        )}
      </div>

      {isOwner && mode !== 'rename' && (
        <div className="wks-member-controls">
          {mode === 'confirm-delete' ? (
            <>
              <span className="wks-hint">Delete?</span>
              <button type="button" className="btn-ghost wks-btn" disabled={busy} onClick={() => setMode('idle')}>
                Cancel
              </button>
              <button type="button" className="btn-danger wks-btn wks-btn-danger-solid" disabled={busy} onClick={remove}>
                {pending === 'delete' ? 'Deleting…' : 'Delete'}
              </button>
            </>
          ) : (
            <>
              <input
                ref={fileRef}
                className="wks-file-input"
                tabIndex={-1}
                aria-hidden="true"
                type="file"
                accept=".html,.htm,text/html"
                onChange={(e) => replaceFile(e.target.files?.[0])}
              />
              <button type="button" className="btn-ghost wks-btn" disabled={busy}
                onClick={() => { setDraft(plugin.name); setError(null); setNote(null); setMode('rename') }}>
                Rename
              </button>
              <button type="button" className="btn-ghost wks-btn" disabled={busy} onClick={() => fileRef.current?.click()}>
                {pending === 'upload' ? 'Uploading…' : 'Replace file'}
              </button>
              <button
                type="button"
                className="btn-danger wks-btn wks-icon-btn"
                disabled={busy}
                aria-label={`Delete ${plugin.name}`}
                title="Delete plugin"
                onClick={() => { setError(null); setNote(null); setMode('confirm-delete') }}
              >
                <span aria-hidden="true">×</span>
              </button>
            </>
          )}
        </div>
      )}

      {mode === 'confirm-delete' && (
        <div className="wks-hint wks-member-note">
          Blocks using it stay in your documents and show as “plugin missing”.
        </div>
      )}
      {mode === 'icon' && isOwner && (
        <div className="wks-member-note wks-plugin-picker" onKeyDown={escapeCloses(() => setMode('idle'))}>
          <IconPicker value={plugin.icon} onSelect={saveIcon} />
        </div>
      )}
      {error && <p className="wks-error wks-member-note" role="alert">{error}</p>}
      {!error && note && <div className="wks-hint wks-member-note" aria-live="polite">{note}</div>}
    </li>
  )
}
