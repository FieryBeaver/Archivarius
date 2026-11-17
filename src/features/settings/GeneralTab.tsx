import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as db from '../../lib/db'
import { IMAGE_HARD_MAX_BYTES, IMAGE_WARN_MIN_BYTES, imageWarnBytes, prepareImageUpload } from '../../lib/prepareImageUpload'
import type { ProjectPrefs } from '../../lib/types'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../state/auth'
import { prefsFor, useProjectPrefs } from '../../state/project'
import type { SettingsContext } from './SettingsDialog'
import { ROLE_LABEL } from './roles'

export function GeneralTab({ ctx }: { ctx: SettingsContext }) {
  const { project, name, setName, role, roleLoading } = ctx
  const isOwner = role === 'owner'
  const [draft, setDraft] = useState(name)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)

  useEffect(() => { setDraft(name) }, [name])

  useEffect(() => {
    if (!saved) return
    const t = window.setTimeout(() => setSaved(false), 1600)
    return () => window.clearTimeout(t)
  }, [saved])

  const commit = async () => {
    const next = draft.trim()
    if (!next) {
      setDraft(name)
      setRenameError('A world needs a name.')
      return
    }
    if (next === name || saving) {
      setDraft(next)
      return
    }
    const prev = name
    setName(next) // optimistic
    setSaving(true)
    setRenameError(null)
    try {
      const p = await db.renameProject(project.id, next)
      setName(p.name)
      setSaved(true)
    } catch (e) {
      setName(prev)
      setDraft(prev)
      setRenameError((e as Error).message || 'Could not rename the world.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="wks-stack">
      <div className="wks-field">
        <label className="wks-label" htmlFor="wks-world-name">World name</label>
        {isOwner ? (
          <input
            id="wks-world-name"
            className="wks-input"
            value={draft}
            maxLength={200}
            disabled={saving}
            onChange={(e) => { setDraft(e.target.value); setRenameError(null) }}
            onBlur={() => { void commit() }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() }
              else if (e.key === 'Escape') { e.preventDefault(); setDraft(name); setRenameError(null) }
            }}
          />
        ) : (
          <div id="wks-world-name" className="wks-readonly">{name}</div>
        )}
        <div className="wks-hint" aria-live="polite">
          {roleLoading
            ? 'Checking your access…'
            : saving
              ? 'Saving…'
              : saved
                ? 'Saved'
                : isOwner
                  ? 'Saves when you press Enter or leave the field.'
                  : `You are ${role ? `${articleFor(role)} ${ROLE_LABEL[role].toLowerCase()}` : 'not a member'} of this world. Only owners can rename it.`}
        </div>
        {renameError && <p className="wks-error" role="alert">{renameError}</p>}
      </div>

      <CoverImage ctx={ctx} isOwner={isOwner} />

      <UploadPrefs ctx={ctx} isOwner={isOwner} />

      {!roleLoading && role && (
        <div className="wks-danger-zone">
          <div className="wks-label wks-label-danger">Danger zone</div>
          {isOwner ? <DeleteWorld ctx={ctx} /> : <LeaveWorld ctx={ctx} />}
        </div>
      )}
    </div>
  )
}

/** v0.7: cover image shown on the world's card in "Your worlds". Owner only. */
function CoverImage({ ctx, isOwner }: { ctx: SettingsContext; isOwner: boolean }) {
  const { project, setBusy } = ctx
  const fileRef = useRef<HTMLInputElement>(null)
  const [coverPath, setCoverPath] = useState<string | null>(project.cover_path ?? null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pick = async (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = ''
    if (!file || pending) return
    setPending(true)
    setBusy(true)
    setError(null)
    try {
      // Over the world's size threshold: offer compression first (null = cancelled).
      const chosen = await prepareImageUpload(file, prefsFor(project.id))
      if (!chosen) return
      const { path } = await db.uploadCoverImage(project.id, chosen)
      await db.updateProjectCover(project.id, path)
      setCoverPath(path)
    } catch (e) {
      setError((e as Error).message || 'Could not set the cover image.')
    } finally {
      setPending(false)
      setBusy(false)
    }
  }

  const remove = async () => {
    if (pending) return
    setPending(true)
    setBusy(true)
    setError(null)
    try {
      await db.updateProjectCover(project.id, null)
      setCoverPath(null)
    } catch (e) {
      setError((e as Error).message || 'Could not remove the cover image.')
    } finally {
      setPending(false)
      setBusy(false)
    }
  }

  if (!isOwner && !coverPath) return null

  return (
    <div className="wks-field">
      <div className="wks-label">Cover image</div>
      {coverPath && (
        <img className="wks-cover-preview" src={db.mapImageUrl(coverPath)} alt="World cover" />
      )}
      {isOwner ? (
        <>
          <input ref={fileRef} className="wks-file-input" tabIndex={-1} aria-hidden="true" type="file"
            accept="image/*" disabled={pending} onChange={(e) => { void pick(e.target.files?.[0]) }} />
          <div className="wks-actions wks-actions-start">
            <button type="button" className="wks-btn" disabled={pending} onClick={() => fileRef.current?.click()}>
              {pending ? 'Working…' : coverPath ? 'Replace image…' : 'Choose image…'}
            </button>
            {coverPath && (
              <button type="button" className="btn-ghost wks-btn" disabled={pending} onClick={() => { void remove() }}>
                Remove
              </button>
            )}
          </div>
          <div className="wks-hint">Shown on this world's card in "Your worlds". Up to 10 MB; wide images look best.</div>
        </>
      ) : (
        <div className="wks-hint">Only owners can change the cover.</div>
      )}
      {error && <p className="wks-error" role="alert">{error}</p>}
    </div>
  )
}

const MB = 1024 * 1024
const mbText = (bytes: number) => String(Math.round((bytes / MB) * 10) / 10)

/** v0.9: when to suggest compressing uploaded images (projects.prefs). Owners edit; others read. */
function UploadPrefs({ ctx, isOwner }: { ctx: SettingsContext; isOwner: boolean }) {
  const { project } = ctx
  const setStorePrefs = useProjectPrefs((s) => s.setPrefs)
  // The store has the latest saved prefs for the open world; the project row may predate a save.
  const [prefs, setPrefs] = useState<ProjectPrefs>(() => prefsFor(project.id) ?? project.prefs ?? {})
  const [draft, setDraft] = useState(() => mbText(imageWarnBytes(prefs)))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!saved) return
    const t = window.setTimeout(() => setSaved(false), 1600)
    return () => window.clearTimeout(t)
  }, [saved])

  const save = async (next: ProjectPrefs) => {
    const prev = prefs
    setPrefs(next)
    setPending(true)
    setError(null)
    try {
      const p = await db.updateProjectPrefs(project.id, next)
      const stored = p.prefs ?? next
      setPrefs(stored)
      setStorePrefs(project.id, stored)
      setSaved(true)
    } catch (e) {
      setPrefs(prev)
      setDraft(mbText(imageWarnBytes(prev)))
      setError((e as Error).message || 'Could not save upload settings.')
    } finally {
      setPending(false)
    }
  }

  const commitSize = () => {
    const mb = Number(draft.replace(',', '.'))
    if (!Number.isFinite(mb) || mb <= 0) {
      setDraft(mbText(imageWarnBytes(prefs)))
      return
    }
    const bytes = Math.round(Math.min(IMAGE_HARD_MAX_BYTES, Math.max(IMAGE_WARN_MIN_BYTES, mb * MB)))
    setDraft(mbText(bytes))
    if (bytes === imageWarnBytes(prefs)) return
    void save({ ...prefs, imageWarnBytes: bytes })
  }

  const threshold = imageWarnBytes(prefs)
  const auto = !!prefs.autoCompress

  return (
    <div className="wks-field">
      <div className="wks-label">Uploads</div>
      {isOwner ? (
        <>
          <label className="wks-upload-size">
            <span>Suggest compressing images larger than</span>
            <input className="wks-input wks-input-narrow" type="number" inputMode="decimal"
              min={IMAGE_WARN_MIN_BYTES / MB} max={IMAGE_HARD_MAX_BYTES / MB} step={0.1}
              value={draft} disabled={pending} aria-label="Size threshold in MB"
              onChange={(e) => { setDraft(e.target.value); setError(null) }}
              onBlur={commitSize}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() }
                else if (e.key === 'Escape') { e.preventDefault(); setDraft(mbText(threshold)) }
              }} />
            <span>MB</span>
          </label>
          <label className="wks-check">
            <input type="checkbox" checked={auto} disabled={pending}
              onChange={(e) => { void save({ ...prefs, autoCompress: e.target.checked }) }} />
            <span>Always compress automatically without asking</span>
          </label>
          <div className="wks-hint" aria-live="polite">
            {pending ? 'Saving…' : saved ? 'Saved'
              : `Applies to page images, maps and the cover. Compressed images are WebP, at most 2048 px on the long edge (maps keep their size). The hard limit is ${IMAGE_HARD_MAX_BYTES / MB} MB.`}
          </div>
        </>
      ) : (
        <div className="wks-hint">
          Images larger than {mbText(threshold)} MB are offered compression before upload
          {auto ? ' (compressed automatically)' : ''}. Only owners can change this.
        </div>
      )}
      {error && <p className="wks-error" role="alert">{error}</p>}
    </div>
  )
}

function articleFor(role: string): string {
  return /^[aeiou]/i.test(role) ? 'an' : 'a'
}

function DeleteWorld({ ctx }: { ctx: SettingsContext }) {
  const { project, name, setBusy, close } = ctx
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setLocalBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const matches = typed.trim() === name.trim()

  const run = async () => {
    if (!matches || busy) return
    setLocalBusy(true)
    setBusy(true)
    setError(null)
    try {
      await db.deleteProject(project.id)
      setBusy(false)
      close()
      navigate('/')
    } catch (e) {
      setBusy(false)
      setLocalBusy(false)
      setError((e as Error).message || 'Could not delete the world.')
    }
  }

  if (!open) {
    return (
      <div className="wks-row-between">
        <div>
          <div className="wks-strong">Delete this world</div>
          <div className="wks-hint">Removes every page, map, timeline and member. This cannot be undone.</div>
        </div>
        <button type="button" className="btn-danger wks-btn" onClick={() => setOpen(true)}>
          Delete world…
        </button>
      </div>
    )
  }

  return (
    <form
      className="wks-confirm"
      onSubmit={(e) => { e.preventDefault(); void run() }}
    >
      <label className="wks-hint" htmlFor="wks-delete-confirm">
        Type <strong className="wks-strong">{name}</strong> to confirm.
      </label>
      <input
        id="wks-delete-confirm"
        className="wks-input"
        value={typed}
        autoFocus
        autoComplete="off"
        spellCheck={false}
        disabled={busy}
        onChange={(e) => setTyped(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); setOpen(false); setTyped('') }
        }}
      />
      {error && <p className="wks-error" role="alert">{error}</p>}
      <div className="wks-actions">
        <button
          type="button"
          className="btn-ghost wks-btn"
          disabled={busy}
          onClick={() => { setOpen(false); setTyped(''); setError(null) }}
        >
          Cancel
        </button>
        <button type="submit" className="btn-danger wks-btn wks-btn-danger-solid" disabled={!matches || busy}>
          {busy ? 'Deleting…' : 'Delete forever'}
        </button>
      </div>
    </form>
  )
}

function LeaveWorld({ ctx }: { ctx: SettingsContext }) {
  const { project, setBusy, close } = ctx
  const navigate = useNavigate()
  const userId = useAuth((s) => s.session?.user.id ?? null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setLocalBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    if (busy) return
    setLocalBusy(true)
    setBusy(true)
    setError(null)
    try {
      let uid = userId
      if (!uid) {
        const { data } = await supabase.auth.getUser()
        uid = data.user?.id ?? null
      }
      if (!uid) throw new Error('You are not signed in.')
      await db.removeMember(project.id, uid)
      // RLS may silently ignore the delete; verify we are actually gone.
      const still = await db.getMyRole(project.id)
      if (still) throw new Error('The server did not let you leave. Ask an owner to remove you.')
      setBusy(false)
      close()
      navigate('/')
    } catch (e) {
      setBusy(false)
      setLocalBusy(false)
      setError((e as Error).message || 'Could not leave the world.')
    }
  }

  return (
    <div className="wks-stack-sm">
      <div className="wks-row-between">
        <div>
          <div className="wks-strong">Leave this world</div>
          <div className="wks-hint">You will lose access until an owner adds you again.</div>
        </div>
        {!confirming && (
          <button type="button" className="btn-danger wks-btn" onClick={() => setConfirming(true)}>
            Leave world…
          </button>
        )}
      </div>
      {confirming && (
        <div className="wks-confirm wks-confirm-inline">
          <span className="wks-hint">Leave “{ctx.name}”?</span>
          <div className="wks-actions">
            <button type="button" className="btn-ghost wks-btn" disabled={busy} onClick={() => { setConfirming(false); setError(null) }}>
              Cancel
            </button>
            <button type="button" className="btn-danger wks-btn wks-btn-danger-solid" disabled={busy} onClick={() => { void run() }}>
              {busy ? 'Leaving…' : 'Leave'}
            </button>
          </div>
        </div>
      )}
      {error && <p className="wks-error" role="alert">{error}</p>}
    </div>
  )
}
