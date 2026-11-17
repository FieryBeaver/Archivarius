import { useEffect, useMemo, useState } from 'react'
import * as db from '../lib/db'
import type { MemberWithProfile, Page } from '../lib/types'
import { usePageEditors } from '../state/pageEditors'
import { usePages } from '../state/pages'
import { ancestorIds } from '../state/pageTree'
import Popover from './Popover'
import { ShieldGlyph } from './UiIcons'

type Access = Page['edit_access']

const CHOICES: { value: Access; title: string; hint: string }[] = [
  { value: 'inherit', title: 'All editors', hint: 'Everyone with the editor role can edit this page.' },
  { value: 'restricted', title: 'Restricted', hint: 'Only owners and the editors you pick below (plus their subpages).' },
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

  // v0.10 subtree grants: a listing on any ancestor also covers this page.
  const pages = usePages((s) => s.pages)
  const byPage = usePageEditors((s) => s.byPage)
  const ancestors = useMemo(() => {
    const byId = new Map(pages.map((p) => [p.id, p]))
    return ancestorIds(pages, page.id).flatMap((id) => byId.get(id) ?? [])
  }, [pages, page.id])
  useEffect(() => {
    const cached = usePageEditors.getState().byPage
    for (const a of ancestors) if (!(a.id in cached)) void loadEditors(a.id)
  }, [ancestors, loadEditors])
  /** user id → title of the nearest ancestor that grants them this page. */
  const inheritedVia = useMemo(() => {
    const via = new Map<string, string>()
    for (const a of ancestors) for (const uid of byPage[a.id] ?? []) if (!via.has(uid)) via.set(uid, a.title)
    return via
  }, [ancestors, byPage])
  const viaTitles = [...new Set(inheritedVia.values())]

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

  const RANK = { owner: 0, editor: 1, viewer: 2 } as const
  // Viewers can never edit, so they're only offered on secret pages, where a
  // grant lets them SEE the page and its subpages. Owners always can.
  const listed = (members ?? [])
    .filter((m) => m.role !== 'viewer' || page.is_secret)
    .sort((a, b) => RANK[a.role] - RANK[b.role] || a.email.localeCompare(b.email))
  const hasEditors = listed.some((m) => m.role === 'editor')
  // v0.10: on an "All editors" page, members who can't already reach it need
  // an explicit grant: edit-own-only members always; on a secret page every
  // non-owner (secrets are hidden from them otherwise).
  const ownOnly = listed.filter((m) => m.role !== 'owner'
    && (page.is_secret || (m.role === 'editor' && m.custom_role_edit_own_only)))

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
                const via = !editors.includes(m.user_id) ? inheritedVia.get(m.user_id) : undefined
                const fixed = owner || !!via
                return (
                  <li key={m.user_id}>
                    <label className={`access-member${fixed ? ' fixed' : ''}`}
                      title={via ? `Has access via “${via}”` : undefined}>
                      <input type="checkbox" checked={fixed || editors.includes(m.user_id)} disabled={fixed}
                        onChange={(e) => void toggleEditor(m.user_id, e.target.checked)} />
                      <span className="access-member-email" title={m.email}>{m.email}</span>
                      <span className="access-member-role">{via ? 'inherited' : m.role}</span>
                    </label>
                  </li>
                )
              })}
            </ul>
            <p className="access-note">
              {hasEditors
                ? 'Ticked members can edit this page and everything under it. Owners always can; viewers never can.'
                : 'No editors in this world yet — invite some in Settings → Members.'}
            </p>
          </>
        )
      )}
      {!restricted && ownOnly.length > 0 && (
        editors === undefined ? (
          <p className="access-note">Loading members…</p>
        ) : (
          <>
            <p className="access-pop-label">
              {page.is_secret ? 'Also give access' : 'Also let edit'} — applies to this page and everything under it
            </p>
            <ul className="access-members" aria-label="Members granted this page and its subpages">
              {ownOnly.map((m) => {
                const creator = m.user_id === page.created_by
                const via = !editors.includes(m.user_id) ? inheritedVia.get(m.user_id) : undefined
                const fixed = creator || !!via
                return (
                  <li key={m.user_id}>
                    <label className={`access-member${fixed ? ' fixed' : ''}`}
                      title={via ? `Has access via “${via}”` : undefined}>
                      <input type="checkbox" checked={fixed || editors.includes(m.user_id)} disabled={fixed}
                        onChange={(e) => void toggleEditor(m.user_id, e.target.checked)} />
                      <span className="access-member-email" title={m.email}>{m.email}</span>
                      <span className="access-member-role">{via ? 'inherited' : m.custom_role_name ?? m.role}</span>
                    </label>
                  </li>
                )
              })}
            </ul>
            <p className="access-note">
              {page.is_secret
                ? 'Ticked editors can see and edit this secret subtree; ticked viewers can see it.'
                : 'These members’ roles edit only their own pages; tick to grant this subtree.'}
            </p>
          </>
        )
      )}
      {page.is_secret && (
        <p className="access-note">
          This page is secret: members you grant here can also see it and its subpages.
        </p>
      )}
      {viaTitles.length > 0 && (
        <p className="access-note">
          Some members have access via {viaTitles.map((t) => `“${t}”`).join(', ')}.
        </p>
      )}
      {error && <p className="error-text">{error}</p>}
    </>
  )
}
