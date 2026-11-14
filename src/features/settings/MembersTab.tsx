import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as db from '../../lib/db'
import { useAuth } from '../../state/auth'
import type { MemberWithProfile, ProjectRole, Role } from '../../lib/types'
import type { SettingsContext } from './SettingsDialog'
import { LAST_OWNER_TIP, ROLES, ROLE_LABEL } from './roles'

const ROLE_ORDER: Record<Role, number> = { owner: 0, editor: 1, viewer: 2 }

function sortMembers(list: MemberWithProfile[]): MemberWithProfile[] {
  return [...list].sort(
    (a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || (a.email ?? '').localeCompare(b.email ?? ''),
  )
}

export function MembersTab({ ctx }: { ctx: SettingsContext }) {
  const { project, role, setRole, close } = ctx
  const isOwner = role === 'owner'
  const me = useAuth((s) => s.session?.user.id ?? null)
  const navigate = useNavigate()

  const [members, setMembers] = useState<MemberWithProfile[] | null>(null)
  const [customRoles, setCustomRoles] = useState<ProjectRole[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ userId: string; message: string } | null>(null)
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [list, roles] = await Promise.all([
        db.listMembers(project.id),
        db.listProjectRoles(project.id).catch(() => [] as ProjectRole[]),
      ])
      setMembers(sortMembers(list))
      setCustomRoles(roles)
      setLoadError(null)
    } catch (e) {
      setLoadError((e as Error).message || 'Could not load members.')
    }
  }, [project.id])

  useEffect(() => { void load() }, [load])

  const ownerCount = members?.filter((m) => m.role === 'owner').length ?? 0
  const isLastOwner = (m: MemberWithProfile) => m.role === 'owner' && ownerCount <= 1

  const setPend = (id: string, v: boolean) =>
    setPending((p) => { const n = { ...p }; if (v) n[id] = true; else delete n[id]; return n })

  /** `value` is "base:<role>" or "custom:<project_roles.id>" from the select. */
  const changeRole = async (m: MemberWithProfile, value: string) => {
    if (!members) return
    const custom = value.startsWith('custom:') ? customRoles.find((r) => r.id === value.slice(7)) : undefined
    const nextBase = custom ? custom.base : (value.slice(5) as Role)
    const nextCustomId = custom?.id ?? null
    if (nextBase === m.role && nextCustomId === m.custom_role_id) return
    if (isLastOwner(m) && nextBase !== 'owner') return
    const prev = members
    setRowError(null)
    setMembers(sortMembers(members.map((x) => (x.user_id === m.user_id
      ? { ...x, role: nextBase, custom_role_id: nextCustomId, custom_role_name: custom?.name ?? null }
      : x))))
    setPend(m.user_id, true)
    try {
      await db.updateMemberRole(project.id, m.user_id, nextBase, nextCustomId)
      if (m.user_id === me) setRole(nextBase)
    } catch (e) {
      setMembers(prev)
      setRowError({ userId: m.user_id, message: (e as Error).message || 'Could not change role.' })
    } finally {
      setPend(m.user_id, false)
    }
  }

  const remove = async (m: MemberWithProfile) => {
    if (!members || isLastOwner(m)) return
    const prev = members
    setConfirmRemove(null)
    setRowError(null)
    setMembers(members.filter((x) => x.user_id !== m.user_id))
    setPend(m.user_id, true)
    try {
      await db.removeMember(project.id, m.user_id)
      if (m.user_id === me) {
        close()
        navigate('/')
      }
    } catch (e) {
      setMembers(prev)
      setRowError({ userId: m.user_id, message: (e as Error).message || 'Could not remove member.' })
    } finally {
      setPend(m.user_id, false)
    }
  }

  return (
    <div className="wks-stack">
      {isOwner && <InviteRow projectId={project.id} onAdded={load} />}

      <div className="wks-field">
        <div className="wks-label">
          Members{members ? ` · ${members.length}` : ''}
        </div>
        {loadError && (
          <div className="wks-row-between">
            <p className="wks-error" role="alert">{loadError}</p>
            <button type="button" className="wks-btn" onClick={() => { void load() }}>Retry</button>
          </div>
        )}
        {!members && !loadError && <div className="wks-hint">Loading members…</div>}
        {members && (
          <ul className="wks-members">
            {members.map((m) => {
              const lastOwner = isLastOwner(m)
              const isMe = m.user_id === me
              const busy = !!pending[m.user_id]
              return (
                <li key={m.user_id} className="wks-member">
                  <div className="wks-member-main">
                    <div className="wks-member-email" title={m.email}>
                      {m.email || 'Unknown account'}
                      {isMe && <span className="wks-you"> (you)</span>}
                    </div>
                    {!isOwner && (
                      <span className={`wks-badge wks-badge-${m.role}`}
                        title={m.custom_role_name ? `${m.custom_role_name} (${ROLE_LABEL[m.role]} permissions)` : undefined}>
                        {m.custom_role_name ?? ROLE_LABEL[m.role]}
                      </span>
                    )}
                  </div>
                  {isOwner && (
                    <div className="wks-member-controls">
                      {confirmRemove === m.user_id ? (
                        <>
                          <span className="wks-hint">{isMe ? 'Remove yourself?' : 'Remove?'}</span>
                          <button type="button" className="btn-ghost wks-btn" onClick={() => setConfirmRemove(null)}>
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="btn-danger wks-btn wks-btn-danger-solid"
                            onClick={() => { void remove(m) }}
                          >
                            Remove
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="wks-tip" title={lastOwner ? LAST_OWNER_TIP : undefined}>
                            <select
                              className="wks-select"
                              value={m.custom_role_id ? `custom:${m.custom_role_id}` : `base:${m.role}`}
                              disabled={lastOwner || busy}
                              aria-label={`Role for ${m.email}`}
                              onChange={(e) => { void changeRole(m, e.target.value) }}
                            >
                              {ROLES.map((r) => <option key={r} value={`base:${r}`}>{ROLE_LABEL[r]}</option>)}
                              {customRoles.length > 0 && (
                                <optgroup label="Custom roles">
                                  {customRoles.map((r) => (
                                    <option key={r.id} value={`custom:${r.id}`}>
                                      {r.name} ({ROLE_LABEL[r.base].toLowerCase()})
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                            </select>
                          </span>
                          <span className="wks-tip" title={lastOwner ? LAST_OWNER_TIP : undefined}>
                            <button
                              type="button"
                              className="btn-danger wks-btn wks-icon-btn"
                              disabled={lastOwner || busy}
                              aria-label={`Remove ${m.email}`}
                              title={lastOwner ? LAST_OWNER_TIP : 'Remove from world'}
                              onClick={() => setConfirmRemove(m.user_id)}
                            >
                              <span aria-hidden="true">×</span>
                            </button>
                          </span>
                        </>
                      )}
                    </div>
                  )}
                  {lastOwner && isOwner && <div className="wks-hint wks-member-note">{LAST_OWNER_TIP}.</div>}
                  {rowError?.userId === m.user_id && (
                    <p className="wks-error wks-member-note" role="alert">{rowError.message}</p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {isOwner && <ManageRoles projectId={project.id} roles={customRoles} onChanged={load} />}

      <p className="wks-hint">
        Viewers can read everything except secrets and notes. Custom roles are
        names over the three base capabilities — permissions always follow the base.
      </p>
    </div>
  )
}

/** v0.7: owners define custom role labels mapped onto a base capability. */
function ManageRoles(props: { projectId: string; roles: ProjectRole[]; onChanged: () => Promise<void> }) {
  const [name, setName] = useState('')
  const [base, setBase] = useState<Role>('editor')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const add = async () => {
    const value = name.trim()
    if (!value || busy) return
    if (props.roles.some((r) => r.name.toLowerCase() === value.toLowerCase())) {
      setError('A role with that name already exists.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await db.createProjectRole(props.projectId, value, base)
      setName('')
      await props.onChanged()
    } catch (e) {
      setError((e as Error).message || 'Could not create the role.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (r: ProjectRole) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await db.deleteProjectRole(r.id)
      await props.onChanged()
    } catch (e) {
      setError((e as Error).message || 'Could not delete the role.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="wks-field" onSubmit={(e) => { e.preventDefault(); void add() }}>
      <div className="wks-label">Custom roles</div>
      {props.roles.length > 0 && (
        <ul className="wks-members">
          {props.roles.map((r) => (
            <li key={r.id} className="wks-member">
              <div className="wks-member-main">
                <div className="wks-member-email">{r.name}</div>
                <span className={`wks-badge wks-badge-${r.base}`}>{ROLE_LABEL[r.base]} permissions</span>
              </div>
              <div className="wks-member-controls">
                <button type="button" className="btn-danger wks-btn wks-icon-btn" disabled={busy}
                  aria-label={`Delete role ${r.name}`} title="Delete role (members keep its base role)"
                  onClick={() => { void remove(r) }}>
                  <span aria-hidden="true">×</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="wks-invite">
        <input className="wks-input wks-invite-email" placeholder="Role name, e.g. Co-GM"
          maxLength={40} value={name} disabled={busy}
          onChange={(e) => { setName(e.target.value); setError(null) }} />
        <select className="wks-select" value={base} disabled={busy} aria-label="Base permissions"
          onChange={(e) => setBase(e.target.value as Role)}>
          <option value="owner">Owner permissions</option>
          <option value="editor">Editor permissions</option>
          <option value="viewer">Viewer permissions</option>
        </select>
        <button type="submit" className="btn-primary wks-btn" disabled={busy || !name.trim()}>
          {busy ? 'Adding…' : 'Add role'}
        </button>
      </div>
      {error && <p className="wks-error" role="alert">{error}</p>}
      {!error && (
        <div className="wks-hint">
          A custom role renames one of the base capabilities (shown on members and
          passed to plugins); deleting one keeps its members at the base role.
        </div>
      )}
    </form>
  )
}

function InviteRow(props: { projectId: string; onAdded: () => Promise<void> }) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('editor')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<string | null>(null)

  const submit = async () => {
    const value = email.trim()
    if (!value || busy) return
    if (!/^[^\s@]+@[^\s@]+$/.test(value)) {
      setError('That does not look like an email address.')
      return
    }
    setBusy(true)
    setError(null)
    setAdded(null)
    try {
      await db.addMemberByEmail(props.projectId, value, role)
      setEmail('')
      setAdded(value)
      await props.onAdded()
    } catch (e) {
      setError((e as Error).message || 'Could not add member.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="wks-field" onSubmit={(e) => { e.preventDefault(); void submit() }}>
      <label className="wks-label" htmlFor="wks-invite-email">Add a member</label>
      <div className="wks-invite">
        <input
          id="wks-invite-email"
          className="wks-input wks-invite-email"
          type="email"
          inputMode="email"
          autoComplete="off"
          placeholder="friend@example.com"
          value={email}
          disabled={busy}
          onChange={(e) => { setEmail(e.target.value); setError(null); setAdded(null) }}
        />
        <select
          className="wks-select"
          value={role}
          disabled={busy}
          aria-label="Role for new member"
          onChange={(e) => setRole(e.target.value as Role)}
        >
          <option value="editor">Editor</option>
          <option value="viewer">Viewer</option>
          <option value="owner">Owner</option>
        </select>
        <button type="submit" className="btn-primary wks-btn" disabled={busy || !email.trim()}>
          {busy ? 'Adding…' : 'Add'}
        </button>
      </div>
      {error && <p className="wks-error" role="alert">{error}</p>}
      {!error && added && <div className="wks-hint" aria-live="polite">Added {added}.</div>}
      {!error && !added && (
        <div className="wks-hint">They need an Archivarius account first.</div>
      )}
    </form>
  )
}
