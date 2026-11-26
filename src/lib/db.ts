import { supabase } from './supabase'
import { remapDocIds, remapTab } from './transferFormat'
import { uniqueImportName } from './importName'
import { rankByTitle } from './titleRank'
import type {
  AnyProjectExport, Member, MemberWithProfile, Mention, Page, PageKind, PageTab, PageTemplate,
  Pin, Plugin, PluginExport, Project, ProjectExport, ProjectPrefs, ProjectRole, Region, Role, ThemeOverrides, WorldEvent,
} from './types'

function ok<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message)
  return data as T
}

// ---------- live-update notifications (v0.11, see CONTRACT.md "realtime") ----------

/**
 * What a successful write changed, announced to other clients of the open world.
 * `ids` are page ids for page-scoped kinds ('pages', 'content', 'pins', 'regions',
 * 'events' (= the map/timeline page), 'page_editors'), otherwise the row ids
 * ('plugins', 'project_roles', 'project') or user ids ('members').
 * 'content' = only content/tabs of those pages changed (autosave); 'pages' = anything
 * structural (create, rename, move, delete, secrecy, edit access…).
 */
export type ChangeKind =
  | 'pages' | 'content' | 'pins' | 'regions' | 'events'
  | 'page_editors' | 'plugins' | 'members' | 'project_roles' | 'project'

export type ChangeNotifier = (kind: ChangeKind, ids: string[]) => void

let changeNotifier: ChangeNotifier | null = null

/** Installed by src/state/realtime.ts while a world is open (null to remove). */
export function setChangeNotifier(fn: ChangeNotifier | null): void {
  changeNotifier = fn
}

/** Called by the mutation helpers below after the write succeeded. Never throws. */
function notify(kind: ChangeKind, ids: (string | null | undefined)[]): void {
  try {
    changeNotifier?.(kind, ids.filter((id): id is string => !!id))
  } catch {
    /* live updates are best-effort */
  }
}

/** Only content/tabs (autosave) — cheap 'content' notification instead of a structural one. */
const CONTENT_KEYS = new Set(['content', 'tabs'])

// ---------- projects ----------

export async function listProjects(): Promise<Project[]> {
  const { data, error } = await supabase.from('projects').select().order('created_at')
  return ok(data, error)
}

export async function getProject(id: string): Promise<Project> {
  const { data, error } = await supabase.from('projects').select().eq('id', id).single()
  return ok(data, error)
}

/** Shown when the server refuses a new world (allowlist, see world_creators migration). */
export const WORLD_CREATION_CLOSED = 'World creation is invite-only on this server. Ask the host to let you create worlds — you can still join worlds you are invited to.'

export async function createProject(name: string): Promise<Project> {
  const { data: u } = await supabase.auth.getUser()
  if (!u.user) throw new Error('not signed in')
  const { data, error } = await supabase
    .from('projects').insert({ name, owner_id: u.user.id }).select().single()
  // 42501 = RLS refused the insert: the account isn't on the world-creator allowlist.
  if (error?.code === '42501') throw new Error(WORLD_CREATION_CLOSED)
  return ok(data, error)
}

/**
 * v0.7: may the signed-in user create worlds? The server enforces this in RLS
 * (projects insert); this only drives the UI. Fails closed.
 */
export async function canCreateWorlds(): Promise<boolean> {
  const { data, error } = await supabase.rpc('can_create_worlds')
  if (error) return false
  return data === true
}

export async function renameProject(id: string, name: string): Promise<Project> {
  const { data, error } = await supabase.from('projects').update({ name }).eq('id', id).select().single()
  const row = ok(data, error)
  notify('project', [id])
  return row
}

/** Owner only (RLS). null resets to the default theme. */
export async function updateProjectTheme(projectId: string, theme: ThemeOverrides | null): Promise<Project> {
  const { data, error } = await supabase.from('projects').update({ theme }).eq('id', projectId).select().single()
  const row = ok(data, error)
  notify('project', [projectId])
  return row
}

/** v0.9, owner only (RLS): replaces the world's preferences (null = defaults). */
export async function updateProjectPrefs(projectId: string, prefs: ProjectPrefs | null): Promise<Project> {
  const { data, error } = await supabase.from('projects').update({ prefs }).eq('id', projectId).select().single()
  const row = ok(data, error)
  notify('project', [projectId])
  return row
}

/**
 * Owner only (RLS). Cascades to members, pages and everything under them. The world's
 * storage objects (map / document / cover images in `maps`, plugin HTML in `plugins`, all
 * under `<projectId>/`) are removed first, while we are still a member (storage RLS needs
 * it). Best-effort: a storage failure doesn't block the deletion; it comes back as
 * `storageError` (orphaned objects are harmless but take space).
 */
export async function deleteProject(id: string): Promise<{ storageError: string | null }> {
  if ((await getMyRole(id)) !== 'owner') throw new Error('Only the owner can delete this world.')
  let storageError: string | null = null
  for (const bucket of ['maps', 'plugins'] as const) {
    try {
      await removeStorageObjects(bucket, await listStorageTree(bucket, id))
    } catch (e) {
      console.warn(`Could not remove the world's files from ${bucket}:`, e)
      storageError ??= (e as Error).message || 'unknown error'
    }
  }
  const { error } = await supabase.from('projects').delete().eq('id', id)
  if (error) throw new Error(error.message)
  return { storageError }
}

/** Every object path under `prefix` in a bucket (recursing into folders, all pages). */
async function listStorageTree(bucket: string, prefix: string): Promise<string[]> {
  const PAGE = 100
  const out: string[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: PAGE, offset })
    if (error) throw new Error(error.message)
    const entries = data ?? []
    for (const f of entries) {
      const path = `${prefix}/${f.name}`
      // Folders come back with a null id.
      if (f.id) out.push(path)
      else out.push(...(await listStorageTree(bucket, path)))
    }
    if (entries.length < PAGE) return out
  }
}

/** Removes objects from a bucket, 100 per request. */
async function removeStorageObjects(bucket: string, paths: string[]): Promise<void> {
  for (const part of chunks(paths, 100)) {
    const { error } = await supabase.storage.from(bucket).remove(part)
    if (error) throw new Error(error.message)
  }
}

// ---------- members ----------

/** The signed-in user's role in the project, or null if not a member. */
export async function getMyRole(projectId: string): Promise<Role | null> {
  const { data: u } = await supabase.auth.getUser()
  if (!u.user) return null
  const { data, error } = await supabase
    .from('members').select('role').eq('project_id', projectId).eq('user_id', u.user.id).maybeSingle()
  const row = ok(data, error) as Pick<Member, 'role'> | null
  return row?.role ?? null
}

/** Members with emails and custom-role labels (owners first). Empty if the caller is not a member. */
export async function listMembers(projectId: string): Promise<MemberWithProfile[]> {
  const { data, error } = await supabase.rpc('project_members', { p: projectId })
  const rows = ok(data, error) as {
    user_id: string; role: Role; email: string
    custom_role_id: string | null; custom_role_name: string | null
    custom_role_edit_own_only: boolean | null
  }[]
  return rows.map((r) => ({
    project_id: projectId, user_id: r.user_id, role: r.role, email: r.email,
    custom_role_id: r.custom_role_id ?? null, custom_role_name: r.custom_role_name ?? null,
    custom_role_edit_own_only: !!r.custom_role_edit_own_only,
  }))
}

// ---------- custom roles (v0.7) ----------

export async function listProjectRoles(projectId: string): Promise<ProjectRole[]> {
  const { data, error } = await supabase
    .from('project_roles').select().eq('project_id', projectId).order('name')
  return ok(data, error)
}

/**
 * Owner only (RLS). A custom role is a label over a base capability.
 * v0.10: `editOwnOnly` (editor base only; ignored otherwise) limits writes to
 * pages the member created or was granted via page_editors.
 */
export async function createProjectRole(
  projectId: string, name: string, base: Role, editOwnOnly = false,
): Promise<ProjectRole> {
  const { data, error } = await supabase
    .from('project_roles')
    .insert({ project_id: projectId, name: name.trim(), base, edit_own_only: base === 'editor' && editOwnOnly })
    .select().single()
  const role = ok(data, error) as ProjectRole
  notify('project_roles', [role.id])
  return role
}

/** Owner only (RLS). v0.10: rename a role or toggle edit_own_only (editor base only, DB-checked). */
export async function updateProjectRole(
  id: string, patch: Partial<Pick<ProjectRole, 'name' | 'edit_own_only'>>,
): Promise<ProjectRole> {
  const row = { ...patch, ...(patch.name !== undefined ? { name: patch.name.trim() } : {}) }
  const { data, error } = await supabase.from('project_roles').update(row).eq('id', id).select().single()
  const role = ok(data, error)
  notify('project_roles', [id])
  return role
}

/** Owner only (RLS). Members holding it keep their base role (FK set-null). */
export async function deleteProjectRole(id: string): Promise<void> {
  const { error } = await supabase.from('project_roles').delete().eq('id', id)
  if (error) throw new Error(error.message)
  notify('project_roles', [id])
}

/** The signed-in user's membership in a project (see getMyMembership). */
export interface MyMembership {
  role: Role | null
  /** Display label: the custom role's name when one is assigned. */
  roleName: string | null
  /** v0.10: the custom role limits writes to own/granted pages (mirrors can_edit_page). */
  editOwnOnly: boolean
}

/** The signed-in user's base role plus their display label (custom name when assigned). */
export async function getMyMembership(projectId: string): Promise<MyMembership> {
  const none: MyMembership = { role: null, roleName: null, editOwnOnly: false }
  const { data: u } = await supabase.auth.getUser()
  if (!u.user) return none
  const { data, error } = await supabase
    .from('members').select('role,custom_role_id')
    .eq('project_id', projectId).eq('user_id', u.user.id).maybeSingle()
  const row = ok(data, error) as { role: Role; custom_role_id: string | null } | null
  if (!row) return none
  if (!row.custom_role_id) return { role: row.role, roleName: null, editOwnOnly: false }
  const { data: r } = await supabase
    .from('project_roles').select('name,edit_own_only').eq('id', row.custom_role_id).maybeSingle()
  const custom = r as { name: string; edit_own_only: boolean } | null
  return {
    role: row.role,
    roleName: custom?.name ?? null,
    editOwnOnly: row.role === 'editor' && !!custom?.edit_own_only,
  }
}

/** Owner only (RLS). Throws 'No account with that email' if nobody signed up with it. */
export async function addMemberByEmail(projectId: string, email: string, role: Role): Promise<void> {
  const { data, error } = await supabase.rpc('find_user_by_email', { lookup: email.trim() })
  const userId = ok(data, error) as string | null
  if (!userId) throw new Error('No account with that email')
  const ins = await supabase.from('members').insert({ project_id: projectId, user_id: userId, role })
  if (ins.error) {
    if (ins.error.code === '23505') throw new Error('Already a member')
    throw new Error(ins.error.message)
  }
  notify('members', [userId])
}

/**
 * Owner only (RLS). With a customRoleId the DB trigger forces `role` to that
 * custom role's base; without one the base role is set and any label cleared.
 */
export async function updateMemberRole(
  projectId: string, userId: string, role: Role, customRoleId: string | null = null,
): Promise<void> {
  const { error } = await supabase
    .from('members').update({ role, custom_role_id: customRoleId })
    .eq('project_id', projectId).eq('user_id', userId)
  if (error) throw new Error(error.message)
  notify('members', [userId])
}

/** Owner only (RLS). */
export async function removeMember(projectId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('members').delete().eq('project_id', projectId).eq('user_id', userId)
  if (error) throw new Error(error.message)
  notify('members', [userId])
}

// ---------- pages ----------

export async function listPages(projectId: string): Promise<Page[]> {
  const { data, error } = await supabase
    .from('pages').select().eq('project_id', projectId).order('position')
  return ok(data, error)
}

export async function getPage(id: string): Promise<Page> {
  const { data, error } = await supabase.from('pages').select().eq('id', id).single()
  return ok(data, error)
}

/** v0.11: the given pages that the caller can still read (missing ids = gone or hidden). */
export async function getPagesByIds(ids: string[]): Promise<Page[]> {
  if (ids.length === 0) return []
  return selectIn<Page>('pages', 'id', [...new Set(ids)])
}

export async function createPage(
  projectId: string,
  attrs: {
    title?: string; parent_id?: string | null; kind?: PageKind; position?: number
    /** v0.7: prefilled from a template. */
    icon?: string | null; content?: unknown; tabs?: PageTab[] | null
    /** Scripting API: created secret (no visible-then-hidden window for other members). */
    is_secret?: boolean
  },
): Promise<Page> {
  const { data, error } = await supabase
    .from('pages').insert({ project_id: projectId, ...attrs }).select().single()
  const page = ok(data, error) as Page
  notify('pages', [page.id])
  return page
}

export async function updatePage(id: string, attrs: Partial<Page>): Promise<Page> {
  const { data, error } = await supabase
    .from('pages').update(attrs).eq('id', id).select().single()
  const page = ok(data, error)
  const keys = Object.keys(attrs)
  notify(keys.length > 0 && keys.every((k) => CONTENT_KEYS.has(k)) ? 'content' : 'pages', [id])
  return page
}

export async function deletePage(id: string): Promise<void> {
  const { error } = await supabase.from('pages').delete().eq('id', id)
  if (error) throw new Error(error.message)
  notify('pages', [id])
}

// ---------- duplicate (copy a page and its subtree) ----------

/** RLS / permission refusals, as PostgREST and the DB triggers word them. */
const REFUSED = /row-level security|permission denied|42501|violates.*polic/i

/**
 * Copies a page and every subpage the caller can see, inserted as a sibling right after
 * the original. Only the root copy is retitled "<title> copy". Copied: title, icon, kind,
 * secret flag (a DB trigger may still force secrecy under a secret parent), tags, content
 * and every tab (plugin tab data rides along inside the tab), map image path/size (the
 * same storage object, not a copy), and the pins, regions and timeline events of copied
 * map/timeline pages. Mentions, map tabs and pin/region/event targets that point INTO the
 * subtree are remapped to the copies; references to pages outside it are left as-is.
 * Not copied: edit access / page editors (copies are 'inherit', owned by the caller).
 * Outgoing mentions are recorded like a save (pages the caller can't see are skipped).
 * All-or-nothing: if any step fails, the copies already made are deleted again.
 * Returns the copies, root first, parents before children.
 */
export async function duplicatePage(pageId: string): Promise<Page[]> {
  const original = await getPage(pageId)
  const pages = await listPages(original.project_id)
  const label = `'${original.title || 'Untitled'}'`

  // the subtree, level by level (parents before children); guarded against cycles
  const levels: Page[][] = [[original]]
  const seen = new Set([original.id])
  for (;;) {
    const prev = new Set(levels.at(-1)!.map((p) => p.id))
    const next = pages
      .filter((p) => p.parent_id && prev.has(p.parent_id) && !seen.has(p.id))
      .sort((a, b) => a.position - b.position)
    if (next.length === 0) break
    next.forEach((p) => seen.add(p.id))
    levels.push(next)
  }
  const idMap = new Map<string, string>()
  for (const p of levels.flat()) idMap.set(p.id, crypto.randomUUID())
  const noPlugins = new Map<string, string>()
  const remap = (id: string | null): string | null => (id ? idMap.get(id) ?? id : null)

  // right after the original among its siblings
  const siblings = pages.filter((p) => p.parent_id === original.parent_id).sort((a, b) => a.position - b.position)
  const after = siblings[siblings.findIndex((p) => p.id === original.id) + 1]
  const rootPosition = after ? (original.position + after.position) / 2 : original.position + 1

  const copyRow = (p: Page) => {
    const tabs = Array.isArray(p.tabs) && p.tabs.length ? p.tabs.map((t) => remapTab(t, idMap, noPlugins)) : null
    return {
      id: idMap.get(p.id)!,
      project_id: p.project_id,
      parent_id: p.id === original.id ? p.parent_id : remap(p.parent_id),
      position: p.id === original.id ? rootPosition : p.position,
      title: p.id === original.id ? `${p.title || 'Untitled'} copy` : p.title,
      icon: p.icon,
      kind: p.kind,
      is_secret: p.is_secret,
      // keeps the invariant content = tabs[0].content
      content: tabs ? tabs[0].content : remapDocIds(p.content, idMap, noPlugins),
      tabs,
      map_image_path: p.map_image_path,
      map_w: p.map_w,
      map_h: p.map_h,
      tags: Array.isArray(p.tags) ? p.tags : [],
    }
  }

  const created: Page[] = []
  const mapIds = levels.flat().filter((p) => p.kind === 'map').map((p) => p.id)
  const timelineIds = levels.flat().filter((p) => p.kind === 'timeline').map((p) => p.id)
  try {
    for (const level of levels) {
      for (const part of chunks(level, 500)) {
        const { data, error } = await supabase.from('pages').insert(part.map(copyRow)).select()
        created.push(...(ok(data, error) as Page[]))
      }
    }

    // outgoing mentions, as syncMentions would record them for each copy
    const contentsOf = (p: Page) => (Array.isArray(p.tabs) && p.tabs.length ? p.tabs.map((t) => t.content) : [p.content])
    const wanted = new Map(created.map((p) => [p.id, extractMentionIds(contentsOf(p))]))
    const allIds = [...new Set([...wanted.values()].flat())]
    const known = new Set(allIds.length
      ? (await selectIn<Pick<Page, 'id'>>('pages', 'id', allIds, 'id')).map((p) => p.id)
      : [])
    await insertBatched('mentions', [...wanted].flatMap(([from, tos]) =>
      tos.filter((to) => known.has(to)).map((to) => ({ from_page_id: from, to_page_id: to }))))

    const [pins, regions, events] = await Promise.all([
      mapIds.length ? selectIn<Pin>('pins', 'map_page_id', mapIds) : [],
      mapIds.length ? selectIn<Region>('regions', 'map_page_id', mapIds) : [],
      timelineIds.length ? selectIn<WorldEvent>('events', 'timeline_page_id', timelineIds) : [],
    ])
    await insertBatched('pins', pins.map((p) => ({
      map_page_id: remap(p.map_page_id), x: p.x, y: p.y, target_page_id: remap(p.target_page_id),
      label: p.label, color: p.color, icon: p.icon,
    })))
    await insertBatched('regions', regions.map((r) => ({
      map_page_id: remap(r.map_page_id), points: r.points, target_page_id: remap(r.target_page_id),
      label: r.label, color: r.color, opacity: r.opacity,
    })))
    await insertBatched('events', events.map((e) => ({
      timeline_page_id: remap(e.timeline_page_id), position: e.position, sort_key: e.sort_key,
      display_date: e.display_date, era: e.era, title: e.title,
      content: remapDocIds(e.content, idMap, noPlugins), target_page_id: remap(e.target_page_id),
    })))
  } catch (e) {
    if (created.length) {
      // roll back: deleting the root copy cascades to everything made under it
      const { error } = await supabase.from('pages').delete().eq('id', created[0].id)
      if (error) notify('pages', created.map((p) => p.id))
    }
    const msg = e instanceof Error ? e.message : String(e)
    if (REFUSED.test(msg)) throw new Error(`Permission denied by the server: you can't duplicate ${label}`)
    throw e
  }

  notify('pages', created.map((p) => p.id))
  return created
}

// ---------- page tabs ----------

/**
 * Saves a page's tabs. Keeps the invariant content = tabs[0].content and
 * re-syncs outgoing mentions from ALL tabs. Requires at least one tab.
 */
export async function savePageTabs(pageId: string, tabs: PageTab[]): Promise<Page> {
  if (tabs.length === 0) throw new Error('A page needs at least one tab')
  const page = await updatePage(pageId, { tabs, content: tabs[0].content })
  await syncMentions(pageId, tabs.map((t) => t.content))
  return page
}

// ---------- per-page edit access (v0.5) ----------

/** Owner only (DB trigger). */
export async function setPageEditAccess(pageId: string, access: 'inherit' | 'restricted'): Promise<Page> {
  return updatePage(pageId, { edit_access: access })
}

/** User ids explicitly allowed to edit a restricted page. */
export async function listPageEditors(pageId: string): Promise<string[]> {
  const { data, error } = await supabase.from('page_editors').select('user_id').eq('page_id', pageId)
  const rows = ok(data, error) as { user_id: string }[]
  return rows.map((r) => r.user_id)
}

/** Owner only (RLS). Adding an existing editor is a no-op. */
export async function addPageEditor(pageId: string, projectId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('page_editors').insert({ page_id: pageId, project_id: projectId, user_id: userId })
  if (error && error.code !== '23505') throw new Error(error.message)
  if (!error) notify('page_editors', [pageId])
}

/** Owner only (RLS). */
export async function removePageEditor(pageId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('page_editors').delete().eq('page_id', pageId).eq('user_id', userId)
  if (error) throw new Error(error.message)
  notify('page_editors', [pageId])
}

/**
 * Lightweight page list for @mention autocomplete: up to 10 titles containing `query`,
 * best first (exact match, then prefix, then substring — see titleRank.ts). Fetches a wider
 * candidate set so an exact match isn't cut off by the limit.
 */
export async function searchPages(projectId: string, query: string): Promise<Pick<Page, 'id' | 'title' | 'kind'>[]> {
  const { data, error } = await supabase
    .from('pages').select('id,title,kind')
    .eq('project_id', projectId).ilike('title', `%${query}%`).limit(100)
  return rankByTitle(ok(data, error), query, (p) => p.title ?? '').slice(0, 10)
}

// ---------- mentions / backlinks ----------

/** Replace all outgoing mentions of a page (call after saving its content). */
export async function replaceMentions(fromPageId: string, toPageIds: string[]): Promise<void> {
  const del = await supabase.from('mentions').delete().eq('from_page_id', fromPageId)
  if (del.error) throw new Error(del.error.message)
  if (toPageIds.length === 0) return
  const rows = [...new Set(toPageIds)].map((to) => ({ from_page_id: fromPageId, to_page_id: to }))
  const ins = await supabase.from('mentions').insert(rows)
  if (ins.error) throw new Error(ins.error.message)
}

/** Page ids of every mention node (`{type:'mention', attrs:{id}}`) in TipTap JSON (one doc or several). */
export function extractMentionIds(content: unknown): string[] {
  const ids = new Set<string>()
  const walk = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (!node || typeof node !== 'object') return
    const n = node as { type?: unknown; attrs?: { id?: unknown }; content?: unknown }
    if (n.type === 'mention' && typeof n.attrs?.id === 'string') ids.add(n.attrs.id)
    if (n.content) walk(n.content)
  }
  walk(content)
  return [...ids]
}

/**
 * Replaces a page's outgoing mentions with those found in the given contents
 * (e.g. every tab). Mentions of pages that no longer exist are skipped (FK).
 */
export async function syncMentions(pageId: string, contents: unknown[]): Promise<void> {
  const ids = extractMentionIds(contents)
  let known: string[] = []
  if (ids.length) known = (await selectIn<Pick<Page, 'id'>>('pages', 'id', ids, 'id')).map((p) => p.id)
  await replaceMentions(pageId, known)
}

/** Pages that mention the given page. */
export async function listBacklinks(pageId: string): Promise<Pick<Page, 'id' | 'title' | 'kind'>[]> {
  const { data, error } = await supabase
    .from('mentions').select('from:pages!mentions_from_page_id_fkey(id,title,kind)')
    .eq('to_page_id', pageId)
  const rows = ok(data, error) as unknown as { from: Pick<Page, 'id' | 'title' | 'kind'> }[]
  return rows.map((r) => r.from)
}

// ---------- map pins & regions ----------

export async function listPins(mapPageId: string): Promise<Pin[]> {
  const { data, error } = await supabase.from('pins').select().eq('map_page_id', mapPageId)
  return ok(data, error)
}

export async function createPin(pin: Omit<Pin, 'id'>): Promise<Pin> {
  const { data, error } = await supabase.from('pins').insert(pin).select().single()
  const row = ok(data, error) as Pin
  notify('pins', [row.map_page_id])
  return row
}

export async function updatePin(id: string, attrs: Partial<Pin>): Promise<Pin> {
  const { data, error } = await supabase.from('pins').update(attrs).eq('id', id).select().single()
  const row = ok(data, error) as Pin
  notify('pins', [row.map_page_id])
  return row
}

export async function deletePin(id: string): Promise<void> {
  // Returning the parent page id lets other clients refresh just that view.
  const { data, error } = await supabase.from('pins').delete().eq('id', id).select('map_page_id')
  if (error) throw new Error(error.message)
  notify('pins', ((data ?? []) as Pick<Pin, 'map_page_id'>[]).map((r) => r.map_page_id))
}

export async function listRegions(mapPageId: string): Promise<Region[]> {
  const { data, error } = await supabase.from('regions').select().eq('map_page_id', mapPageId)
  return ok(data, error)
}

export async function createRegion(region: Omit<Region, 'id'>): Promise<Region> {
  const { data, error } = await supabase.from('regions').insert(region).select().single()
  const row = ok(data, error) as Region
  notify('regions', [row.map_page_id])
  return row
}

export async function updateRegion(id: string, attrs: Partial<Region>): Promise<Region> {
  const { data, error } = await supabase.from('regions').update(attrs).eq('id', id).select().single()
  const row = ok(data, error) as Region
  notify('regions', [row.map_page_id])
  return row
}

export async function deleteRegion(id: string): Promise<void> {
  // Returning the parent page id lets other clients refresh just that view.
  const { data, error } = await supabase.from('regions').delete().eq('id', id).select('map_page_id')
  if (error) throw new Error(error.message)
  notify('regions', ((data ?? []) as Pick<Region, 'map_page_id'>[]).map((r) => r.map_page_id))
}

// ---------- map image upload ----------

/** Max size of a map image (also enforced by the `maps` bucket, v0.7 migration). */
export const MAP_IMAGE_MAX_BYTES = 10 * 1024 * 1024

/** Uploads a map image and returns its storage path + public URL. */
export async function uploadMapImage(projectId: string, file: File): Promise<{ path: string; url: string }> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file')
  if (file.size > MAP_IMAGE_MAX_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1)
    throw new Error(`That image is ${mb} MB — the limit is ${MAP_IMAGE_MAX_BYTES / (1024 * 1024)} MB. Try a compressed JPEG or WebP.`)
  }
  const path = `${projectId}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, '_')}`
  const { error } = await supabase.storage.from('maps').upload(path, file)
  if (error) throw new Error(error.message)
  return { path, url: mapImageUrl(path) }
}

export function mapImageUrl(path: string): string {
  return supabase.storage.from('maps').getPublicUrl(path).data.publicUrl
}

// ---------- document images (v0.9) ----------

/** Same cap as map images (the `maps` bucket enforces it server-side too). */
export const DOC_IMAGE_MAX_BYTES = MAP_IMAGE_MAX_BYTES

/** Why `file` can't be a document image, or null when it can. */
export function docImageProblem(file: File): string | null {
  if (!file.type.startsWith('image/')) return `“${file.name || 'That file'}” isn’t an image.`
  if (file.size > DOC_IMAGE_MAX_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1)
    return `That image is ${mb} MB — the limit is ${DOC_IMAGE_MAX_BYTES / (1024 * 1024)} MB. Try a compressed JPEG or WebP.`
  }
  return null
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/svg+xml': 'svg', 'image/avif': 'avif', 'image/bmp': 'bmp',
}

function imageExtension(file: File): string {
  const known = IMAGE_EXTENSIONS[file.type]
  if (known) return known
  const fromName = /\.([a-z0-9]{1,5})$/i.exec(file.name)?.[1]
  return fromName ? fromName.toLowerCase() : 'img'
}

/**
 * Uploads a document image to the public `maps` bucket under
 * `<projectId>/images/<uuid>.<ext>` and returns its storage path + public URL.
 */
export async function uploadDocImage(projectId: string, file: File): Promise<{ path: string; url: string }> {
  const problem = docImageProblem(file)
  if (problem) throw new Error(problem)
  const path = `${projectId}/images/${crypto.randomUUID()}.${imageExtension(file)}`
  // Public URLs are browser-cached for an hour: a deleted image can keep showing until then.
  const { error } = await supabase.storage.from('maps').upload(path, file, { contentType: file.type, cacheControl: '3600' })
  if (error) throw new Error(error.message)
  return { path, url: docImageUrl(path) }
}

/** Public URL of a document image path (same bucket as map images). */
export function docImageUrl(path: string): string {
  return mapImageUrl(path)
}

export interface DocImage { path: string; url: string; name: string; created_at: string }

/** The project's uploaded document images, newest first. */
export async function listProjectImages(projectId: string): Promise<DocImage[]> {
  const folder = `${projectId}/images`
  const { data, error } = await supabase.storage.from('maps').list(folder, {
    limit: 1000,
    sortBy: { column: 'created_at', order: 'desc' },
  })
  if (error) throw new Error(error.message)
  return (data ?? [])
    // Sub-folders come back with a null id; the placeholder object marks an empty folder.
    .filter((f) => f.id && f.name !== '.emptyFolderPlaceholder')
    .map((f) => {
      const path = `${folder}/${f.name}`
      return { path, url: docImageUrl(path), name: f.name, created_at: f.created_at ?? '' }
    })
}

/**
 * Bytes of any object in the `maps` bucket (map, document or cover image). Tries the
 * authenticated download first; falls back to the public URL, which also serves paths
 * outside worlds the caller belongs to (e.g. images carried over by an older JSON import).
 */
export async function downloadMapsObject(path: string): Promise<Uint8Array> {
  const { data, error } = await supabase.storage.from('maps').download(path, {}, { cache: 'no-store' })
  if (!error && data) return new Uint8Array(await data.arrayBuffer())
  const res = await fetch(mapImageUrl(path), { cache: 'no-store' })
  if (!res.ok) throw new Error(error?.message || `HTTP ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

/** Removes objects from the `maps` bucket (owner/editor of their world, RLS). */
export async function removeMapsObjects(paths: string[]): Promise<void> {
  await removeStorageObjects('maps', paths)
}

/** Removes an image from storage. Documents that use it keep the node (it renders as missing). */
export async function deleteProjectImage(path: string): Promise<void> {
  const { error } = await supabase.storage.from('maps').remove([path])
  if (error) throw new Error(error.message)
}

// ---------- world cover image (v0.7) ----------

/**
 * Uploads a world cover image (same bucket, caps and public URL as map
 * images) and returns its storage path + URL. Does not touch the project row.
 */
export async function uploadCoverImage(projectId: string, file: File): Promise<{ path: string; url: string }> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file')
  if (file.size > MAP_IMAGE_MAX_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1)
    throw new Error(`That image is ${mb} MB — the limit is ${MAP_IMAGE_MAX_BYTES / (1024 * 1024)} MB. Try a compressed JPEG or WebP.`)
  }
  const path = `${projectId}/cover-${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, '_')}`
  const { error } = await supabase.storage.from('maps').upload(path, file)
  if (error) throw new Error(error.message)
  return { path, url: mapImageUrl(path) }
}

/** Owner only (RLS). Sets or clears the world's cover; null = plain card. */
export async function updateProjectCover(projectId: string, coverPath: string | null): Promise<Project> {
  const { data, error } = await supabase
    .from('projects').update({ cover_path: coverPath }).eq('id', projectId).select().single()
  const row = ok(data, error)
  notify('project', [projectId])
  return row
}

// ---------- plugins (v0.6) ----------

/** Max size of a plugin's HTML source (also enforced by the `plugins` bucket). */
export const PLUGIN_MAX_BYTES = 256 * 1024

type PluginSource = File | Blob | string

/** Normalises a plugin source to an HTML Blob, enforcing PLUGIN_MAX_BYTES. */
function pluginBlob(file: PluginSource): Blob {
  const blob = typeof file === 'string' ? new Blob([file], { type: 'text/html' }) : file
  if (blob.size > PLUGIN_MAX_BYTES) {
    const kb = Math.ceil(blob.size / 1024)
    throw new Error(`Plugin file is too large (${kb} KB). The limit is ${PLUGIN_MAX_BYTES / 1024} KB.`)
  }
  return blob
}

/** Uploads (or overwrites) a plugin's HTML. cacheControl 0 so a re-upload is never served stale. */
async function uploadPluginSource(path: string, file: PluginSource, upsert: boolean): Promise<void> {
  const { error } = await supabase.storage.from('plugins')
    .upload(path, pluginBlob(file), { contentType: 'text/html', cacheControl: '0', upsert })
  if (error) throw new Error(error.message)
}

export async function listPlugins(projectId: string): Promise<Plugin[]> {
  const { data, error } = await supabase
    .from('plugins').select().eq('project_id', projectId).order('created_at')
  return ok(data, error)
}

/** Owner only (RLS). Uploads the HTML to plugins/<project_id>/<id>.html, then inserts the row. */
export async function createPlugin(
  projectId: string,
  opts: { name: string; icon: string | null; file: PluginSource },
): Promise<Plugin> {
  const id = crypto.randomUUID()
  const source_path = `${projectId}/${id}.html`
  await uploadPluginSource(source_path, opts.file, false)
  const { data, error } = await supabase
    .from('plugins').insert({ id, project_id: projectId, name: opts.name, icon: opts.icon, source_path })
    .select().single()
  if (error) {
    await supabase.storage.from('plugins').remove([source_path])
    throw new Error(error.message)
  }
  notify('plugins', [id])
  return data as Plugin
}

/** Owner only (RLS). Optionally replaces the HTML source (same path, upsert). */
export async function updatePlugin(
  pluginId: string,
  patch: { name?: string; icon?: string | null },
  file?: PluginSource,
): Promise<Plugin> {
  let plugin: Plugin
  if (Object.keys(patch).length) {
    const { data, error } = await supabase.from('plugins').update(patch).eq('id', pluginId).select().single()
    plugin = ok(data, error) as Plugin
  } else {
    const { data, error } = await supabase.from('plugins').select().eq('id', pluginId).single()
    plugin = ok(data, error) as Plugin
  }
  if (file !== undefined) await uploadPluginSource(plugin.source_path, file, true)
  notify('plugins', [pluginId])
  return plugin
}

/**
 * Owner only (RLS). Deletes the row and its storage object. Accepts the plugin
 * or its id. pluginBlock nodes that reference it stay in documents and render
 * as "plugin missing".
 */
export async function deletePlugin(plugin: Plugin | string): Promise<void> {
  let p: Plugin
  if (typeof plugin === 'string') {
    const { data, error } = await supabase.from('plugins').select().eq('id', plugin).single()
    p = ok(data, error) as Plugin
  } else p = plugin
  const { error } = await supabase.from('plugins').delete().eq('id', p.id)
  if (error) throw new Error(error.message)
  notify('plugins', [p.id])
  const rm = await supabase.storage.from('plugins').remove([p.source_path])
  if (rm.error) throw new Error(rm.error.message)
}

/**
 * Downloads a plugin's HTML. The bucket is private, so this goes through the
 * authenticated download API (no public CDN URL); `cache: 'no-store'` plus the
 * cacheControl 0 set on upload means a re-upload is visible immediately.
 */
export async function getPluginSource(plugin: Pick<Plugin, 'source_path'>): Promise<string> {
  const { data, error } = await supabase.storage.from('plugins')
    .download(plugin.source_path, {}, { cache: 'no-store' })
  if (error) throw new Error(error.message)
  return data.text()
}

// ---------- page templates (v0.7) ----------

export async function listPageTemplates(projectId: string): Promise<PageTemplate[]> {
  const { data, error } = await supabase
    .from('page_templates').select().eq('project_id', projectId).order('name')
  return ok(data, error)
}

/** Owner/editor (RLS). Snapshots a page's icon/content/tabs under a name. */
export async function createPageTemplate(
  projectId: string,
  t: { name: string; icon: string | null; kind: PageKind; content: unknown; tabs: PageTab[] | null },
): Promise<PageTemplate> {
  const { data, error } = await supabase
    .from('page_templates').insert({ project_id: projectId, ...t }).select().single()
  return ok(data, error)
}

/** Owner/editor (RLS). Pages already created from it are unaffected. */
export async function deletePageTemplate(id: string): Promise<void> {
  const { error } = await supabase.from('page_templates').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// ---------- timeline events ----------

export async function listEvents(timelinePageId: string): Promise<WorldEvent[]> {
  const { data, error } = await supabase
    .from('events').select().eq('timeline_page_id', timelinePageId)
    .order('sort_key').order('position')
  return ok(data, error)
}

export async function createEvent(ev: Omit<WorldEvent, 'id'>): Promise<WorldEvent> {
  const { data, error } = await supabase.from('events').insert(ev).select().single()
  const row = ok(data, error) as WorldEvent
  notify('events', [row.timeline_page_id])
  return row
}

export async function updateEvent(id: string, attrs: Partial<WorldEvent>): Promise<WorldEvent> {
  const { data, error } = await supabase.from('events').update(attrs).eq('id', id).select().single()
  const row = ok(data, error) as WorldEvent
  notify('events', [row.timeline_page_id])
  return row
}

export async function deleteEvent(id: string): Promise<void> {
  // Returning the parent page id lets other clients refresh just that view.
  const { data, error } = await supabase.from('events').delete().eq('id', id).select('timeline_page_id')
  if (error) throw new Error(error.message)
  notify('events', ((data ?? []) as Pick<WorldEvent, 'timeline_page_id'>[]).map((r) => r.timeline_page_id))
}

// ---------- export / import ----------

const CHUNK = 200

function chunks<T>(arr: T[], size = CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/** select * from table where col in (ids), chunked to keep URLs short. */
async function selectIn<T>(table: string, col: string, ids: string[], columns = '*'): Promise<T[]> {
  const out: T[] = []
  for (const part of chunks(ids)) {
    const { data, error } = await supabase.from(table).select(columns).in(col, part)
    out.push(...(ok(data, error) as T[]))
  }
  return out
}

async function insertBatched(table: string, rows: object[]): Promise<void> {
  for (const part of chunks(rows, 500)) {
    const { error } = await supabase.from(table).insert(part)
    if (error) throw new Error(error.message)
  }
}

/**
 * Full JSON export of a project. Contains only what the caller can read
 * (viewers don't get secret pages). Map images are not included;
 * plugins are, with their HTML source inlined.
 */
export async function exportProject(projectId: string): Promise<ProjectExport> {
  const { data: proj, error } = await supabase.from('projects').select().eq('id', projectId).single()
  const project = ok(proj, error) as Project
  const pages = await listPages(projectId)
  const ids = pages.map((p) => p.id)
  const [mentions, pins, regions, events, pluginRows] = await Promise.all([
    selectIn<Mention>('mentions', 'from_page_id', ids),
    selectIn<Pin>('pins', 'map_page_id', ids),
    selectIn<Region>('regions', 'map_page_id', ids),
    selectIn<WorldEvent>('events', 'timeline_page_id', ids),
    listPlugins(projectId),
  ])
  // a plugin whose source object is gone is skipped rather than failing the whole export
  const plugins: PluginExport[] = (await Promise.all(pluginRows.map(async (p) => {
    try {
      return { id: p.id, name: p.name, icon: p.icon, source: await getPluginSource(p) }
    } catch {
      return null
    }
  }))).filter((p): p is PluginExport => p !== null)
  return {
    format: 'archivarius-export',
    version: 2,
    project: { name: project.name, theme: project.theme ?? null },
    pages, mentions, pins, regions, events, plugins,
  }
}

/** True if `data` looks like an export importProject accepts (v2, or legacy v1). */
export function isSupportedExport(data: unknown): data is AnyProjectExport {
  if (!data || typeof data !== 'object') return false
  const d = data as { format?: unknown; version?: unknown }
  return (d.format === 'archivarius-export' && d.version === 2)
    || (d.format === 'worldkeeper-export' && d.version === 1)
}

/**
 * Creates a new project from an export (v2, or legacy v1 WorldKeeper). All ids
 * are regenerated; references (parent_id, mentions incl. inside every tab,
 * pin/region/event targets) are remapped, dangling ones dropped/nulled.
 * map_image_path is cleared (JSON exports carry no images) unless `opts.prepare`
 * (the .zip import, lib/transferZip.ts) supplied the image's new storage path. Plugins
 * (v0.6, optional) are re-uploaded and pluginBlock pluginIds remapped; map tabs point at
 * the imported map pages. Page editors aren't
 * exported, so restricted pages are editable only by the importer (owner).
 */
export async function importProject(
  input: AnyProjectExport, name?: string, opts?: ImportOptions,
): Promise<Project> {
  if (!isSupportedExport(input)) throw new Error('Not an Archivarius export file')
  // normalise v1 -> v2 shape
  const data: ProjectExport = input.format === 'archivarius-export' ? input : {
    ...input,
    format: 'archivarius-export',
    version: 2,
    project: { name: input.project?.name, theme: null },
    pages: (input.pages ?? []).map((p) => ({ ...p, edit_access: 'inherit', tabs: null })),
  }
  // No explicit name: the export's, disambiguated from the worlds already listed.
  const existing = name?.trim() ? [] : await listProjects().then((ps) => ps.map((p) => p.name), () => [])
  let project = await createProject(name?.trim() || uniqueImportName(data.project?.name || 'Imported world', existing))
  // first thing after the row exists, so a failing caller always learns which world to clean up
  const images = opts?.prepare ? await opts.prepare(project) : null
  if (data.project?.theme) project = await updateProjectTheme(project.id, data.project.theme)

  const idMap = new Map<string, string>()
  for (const p of data.pages ?? []) idMap.set(p.id, crypto.randomUUID())
  const remap = (id: string | null | undefined): string | null => (id ? idMap.get(id) ?? null : null)

  // plugins first, so pluginBlock nodes can be remapped while pages are built
  const pluginMap = new Map<string, string>()
  for (const p of data.plugins ?? []) {
    if (!p || typeof p.source !== 'string') continue
    const created = await createPlugin(project.id, { name: p.name || 'Plugin', icon: p.icon ?? null, file: p.source })
    pluginMap.set(p.id, created.id)
  }
  const remapContent = (content: unknown) => remapDocIds(content, idMap, pluginMap, images?.imagePaths)

  // order pages so parents precede children (depth levels); orphans become roots
  const byId = new Map((data.pages ?? []).map((p) => [p.id, p]))
  const depthCache = new Map<string, number>()
  const depth = (p: Page, seen = new Set<string>()): number => {
    const cached = depthCache.get(p.id)
    if (cached !== undefined) return cached
    const parent = p.parent_id ? byId.get(p.parent_id) : undefined
    const d = parent && !seen.has(parent.id) ? depth(parent, seen.add(p.id)) + 1 : 0
    depthCache.set(p.id, d)
    return d
  }
  const pageRows = (data.pages ?? [])
    .map((p) => ({
      row: {
        id: idMap.get(p.id)!,
        project_id: project.id,
        parent_id: remap(p.parent_id),
        position: p.position,
        title: p.title,
        icon: p.icon,
        kind: p.kind,
        is_secret: p.is_secret,
        content: remapContent(p.content),
        map_image_path: (p.map_image_path && images?.imagePaths.get(p.map_image_path)) || null,
        map_w: p.map_w,
        map_h: p.map_h,
        edit_access: p.edit_access === 'restricted' ? 'restricted' : 'inherit',
        tags: Array.isArray(p.tags) ? p.tags : [],
        tabs: Array.isArray(p.tabs)
          ? p.tabs.map((t) => remapTab(t, idMap, pluginMap, images?.imagePaths))
          : null,
      },
      d: depth(p),
    }))
    .sort((a, b) => a.d - b.d)
  // insert level by level so parent FKs always resolve
  let level: object[] = []
  let cur = 0
  for (const { row, d } of pageRows) {
    if (d !== cur && level.length) { await insertBatched('pages', level); level = [] }
    cur = d
    level.push(row)
  }
  if (level.length) await insertBatched('pages', level)

  const mentionRows = [...new Map(
    (data.mentions ?? [])
      .map((m) => ({ from_page_id: remap(m.from_page_id), to_page_id: remap(m.to_page_id) }))
      .filter((m) => m.from_page_id && m.to_page_id)
      .map((m) => [`${m.from_page_id}:${m.to_page_id}`, m]),
  ).values()]
  await insertBatched('mentions', mentionRows)

  await insertBatched('pins', (data.pins ?? []).filter((p) => idMap.has(p.map_page_id)).map((p) => ({
    map_page_id: remap(p.map_page_id), x: p.x, y: p.y, target_page_id: remap(p.target_page_id),
    label: p.label, color: p.color, icon: p.icon,
  })))
  await insertBatched('regions', (data.regions ?? []).filter((r) => idMap.has(r.map_page_id)).map((r) => ({
    map_page_id: remap(r.map_page_id), points: r.points, target_page_id: remap(r.target_page_id),
    label: r.label, color: r.color, opacity: r.opacity,
  })))
  await insertBatched('events', (data.events ?? []).filter((e) => idMap.has(e.timeline_page_id)).map((e) => ({
    timeline_page_id: remap(e.timeline_page_id), position: e.position, sort_key: e.sort_key,
    display_date: e.display_date, era: e.era, title: e.title,
    content: remapContent(e.content), target_page_id: remap(e.target_page_id),
  })))

  if (images?.coverPath) project = await updateProjectCover(project.id, images.coverPath)
  return project
}

/** Images a .zip import already uploaded into the new world (see importProject's `opts`). */
export interface ImportedImages {
  /** Source-world storage path → the new world's copy. Unlisted paths are left as-is. */
  imagePaths: ReadonlyMap<string, string>
  /** The new world's cover (already uploaded), or null. */
  coverPath: string | null
}

export interface ImportOptions {
  /**
   * Runs right after the new world row is created, before anything else is written:
   * the .zip import records the world (for cleanup) and uploads its images here.
   */
  prepare?: (project: Project) => Promise<ImportedImages>
}
