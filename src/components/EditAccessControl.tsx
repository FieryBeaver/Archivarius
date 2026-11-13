import { useEffect, useState } from 'react'
import * as db from '../lib/db'
import type { MemberWithProfile, Page } from '../lib/types'
import { usePageEditors } from '../state/pageEditors'
import { usePages } from '../state/pages'
import Popover from './Popover'
import { ShieldGlyph } from './UiIcons'

type Access = Page['edit_access']

const CHOICES: { value: Access; title: string; hint: string }[] = [
  { value: 'inherit', title: 'All editors', hint: 'Everyone with the editor role can edit this page.' },
  { value: 'restricted', title: 'Restricted', hint: 'Only owners and the editors you pick below.' },
]

/**
 * Header pill for per-page edit access. Owners get a popover to switch between
 * "All editors" and "Restricted" (with a member checklist); everyone else only sees
 * a static indicator, and only on restricted pages.
 */
export default function EditAccessControl({ page, isOwner }: { page: Page; isOwner: boolean }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const restricted = page.edit_access === 'restricted'

  if (!isOwner) {
    return restricted ? (
      <span className="page-secret-toggle page-access-toggle on static" title="Only chosen editors can edit this page">
        <ShieldGlyph /><span className="page-access-label">Restricted</span>
      </span>
    ) : null
  }

  return (
    <>
      <button type="button" className={`page-secret-toggle page-access-toggle${restricted ? ' on' : ''}`}
        aria-haspopup="dialog" aria-expanded={!!anchor} aria-label="Edit access"
        title={restricted ? 'Edit access: restricted to chosen editors' : 'Edit access: all editors'}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget.getBoundingClientRect())}>
        <ShieldGlyph />
        <span className="page-access-label">{restricted ? 'Restricted' : 'All editors'}</span>
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={300} role="dialog"
          className="popover-padded access-pop">
          <AccessPanel page={page} />
        </Popover>
      )}
    </>
  )
}

function AccessPanel({ page }: { page: Page }) {
  const patchLocal = usePages((s) => s.patchLocal)
  const editors = usePageEditors((s) => s.byPage[page.id])
  const loadEditors = usePageEditors((s) => s.load)
  const setEditors = usePageEditors((s) => s.set)
  const [members, setMembers] = useState<MemberWithProfile[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const restricted = page.edit_access === 'restricted'

  useEffect(() => {
    let live = true
    db.listMembers(page.project_id).then(
      (rows) => live && setMembers(rows),
      (e: Error) => { if (live) { setMembers([]); setError(e.message) } },
    )
    void loadEditors(page.id)
    return () => { live = false }
  }, [page.project_id, page.id, loadEditors])

  async function setAccess(access: Access) {
    if (access === page.edit_access) return
    const prev = page.edit_access
    setError(null)
    patchLocal(page.id, { edit_access: access })
    try {
      await db.setPageEditAccess(page.id, access)
    } catch (e) {
      patchLocal(page.id, { edit_access: prev })
      setError((e as Error).message)
    }
  }

  async function toggleEditor(userId: string, allow: boolean) {
    const prev = editors ?? []
    setError(null)
    setEditors(page.id, allow ? [...prev.filter((id) => id !== userId), userId] : prev.filter((id) => id !== userId))
    try {
      if (allow) await db.addPageEditor(page.id, page.project_id, userId)
      else await db.removePageEditor(page.id, userId)
    } catch (e) {
      setEditors(page.id, prev)
      setError((e as Error).message)
    }
  }

  // Viewers can never edit, so they aren't offered; owners always can.
  const listed = (members ?? [])
    .filter((m) => m.role !== 'viewer')
    .sort((a, b) => (a.role === b.role ? a.email.localeCompare(b.email) : a.role === 'owner' ? -1 : 1))
  const hasEditors = listed.some((m) => m.role === 'editor')

  return (
    <>
      <p className="access-pop-label">Who can edit</p>
      <div className="access-choices" role="radiogroup" aria-label="Edit access">
        {CHOICES.map((c) => (
          <button key={c.value} type="button" role="radio" aria-checked={page.edit_access === c.value}
            className="popover-item access-choice" onClick={() => void setAccess(c.value)}>
            <span aria-hidden="true">{page.edit_access === c.value ? '✓' : ''}</span>
            <span className="access-choice-text">
              <span className="access-choice-title">{c.title}</span>
              <span className="access-choice-hint">{c.hint}</span>
            </span>
          </button>
        ))}
      </div>

      {restricted && (
        members === null || editors === undefined ? (
          <p className="access-note">Loading members…</p>
        ) : (
          <>
            <ul className="access-members" aria-label="Allowed editors">
              {listed.map((m) => {
                const owner = m.role === 'owner'
                return (
                  <li key={m.user_id}>
                    <label className={`access-member${owner ? ' fixed' : ''}`}>
                      <input type="checkbox" checked={owner || editors.includes(m.user_id)} disabled={owner}
                        onChange={(e) => void toggleEditor(m.user_id, e.target.checked)} />
                      <span className="access-member-email" title={m.email}>{m.email}</span>
                      <span className="access-member-role">{m.role}</span>
                    </label>
                  </li>
                )
              })}
            </ul>
            <p className="access-note">
              {hasEditors
                ? 'Owners can always edit. Viewers never can.'
                : 'No editors in this world yet — invite some in Settings → Members.'}
            </p>
          </>
        )
      )}
      {error && <p className="error-text">{error}</p>}
    </>
  )
}
