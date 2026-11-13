import { supabase } from './supabase'
import type {
  Member, MemberWithProfile, Mention, Page, PageKind, Pin, Project, ProjectExport, Region, Role, WorldEvent,
} from './types'

function ok<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message)
  return data as T
}

// ---------- projects ----------

export async function listProjects(): Promise<Project[]> {
  const { data, error } = await supabase.from('projects').select().order('created_at')
  return ok(data, error)
}

export async function createProject(name: string): Promise<Project> {
  const { data: u } = await supabase.auth.getUser()
  if (!u.user) throw new Error('not signed in')
  const { data, error } = await supabase
    .from('projects').insert({ name, owner_id: u.user.id }).select().single()
  return ok(data, error)
}

export async function renameProject(id: string, name: string): Promise<Project> {
  const { data, error } = await supabase.from('projects').update({ name }).eq('id', id).select().single()
  return ok(data, error)
}

/** Owner only (RLS). Cascades to members, pages and everything under them. */
export async function deleteProject(id: string): Promise<void> {
  const { error } = await supabase.from('projects').delete().eq('id', id)
  if (error) throw new Error(error.message)
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

/** Members with emails (owners first). Empty if the caller is not a member. */
export async function listMembers(projectId: string): Promise<MemberWithProfile[]> {
  const { data, error } = await supabase.rpc('project_members', { p: projectId })
  const rows = ok(data, error) as { user_id: string; role: Role; email: string }[]
  return rows.map((r) => ({ project_id: projectId, user_id: r.user_id, role: r.role, email: r.email }))
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
}

/** Owner only (RLS). */
export async function updateMemberRole(projectId: string, userId: string, role: Role): Promise<void> {
  const { error } = await supabase
    .from('members').update({ role }).eq('project_id', projectId).eq('user_id', userId)
  if (error) throw new Error(error.message)
}

/** Owner only (RLS). */
export async function removeMember(projectId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('members').delete().eq('project_id', projectId).eq('user_id', userId)
  if (error) throw new Error(error.message)
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

export async function createPage(
  projectId: string,
  attrs: { title?: string; parent_id?: string | null; kind?: PageKind; position?: number },
): Promise<Page> {
  const { data, error } = await supabase
    .from('pages').insert({ project_id: projectId, ...attrs }).select().single()
  return ok(data, error)
}

export async function updatePage(id: string, attrs: Partial<Page>): Promise<Page> {
  const { data, error } = await supabase
    .from('pages').update(attrs).eq('id', id).select().single()
  return ok(data, error)
}

export async function deletePage(id: string): Promise<void> {
  const { error } = await supabase.from('pages').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/** Lightweight page list for @mention autocomplete. */
export async function searchPages(projectId: string, query: string): Promise<Pick<Page, 'id' | 'title' | 'kind'>[]> {
  const { data, error } = await supabase
    .from('pages').select('id,title,kind')
    .eq('project_id', projectId).ilike('title', `%${query}%`).limit(10)
  return ok(data, error)
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
  return ok(data, error)
}

export async function updatePin(id: string, attrs: Partial<Pin>): Promise<Pin> {
  const { data, error } = await supabase.from('pins').update(attrs).eq('id', id).select().single()
  return ok(data, error)
}

export async function deletePin(id: string): Promise<void> {
  const { error } = await supabase.from('pins').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function listRegions(mapPageId: string): Promise<Region[]> {
  const { data, error } = await supabase.from('regions').select().eq('map_page_id', mapPageId)
  return ok(data, error)
}

export async function createRegion(region: Omit<Region, 'id'>): Promise<Region> {
  const { data, error } = await supabase.from('regions').insert(region).select().single()
  return ok(data, error)
}

export async function updateRegion(id: string, attrs: Partial<Region>): Promise<Region> {
  const { data, error } = await supabase.from('regions').update(attrs).eq('id', id).select().single()
  return ok(data, error)
}

export async function deleteRegion(id: string): Promise<void> {
  const { error } = await supabase.from('regions').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// ---------- map image upload ----------

/** Uploads a map image and returns its storage path + public URL. */
export async function uploadMapImage(projectId: string, file: File): Promise<{ path: string; url: string }> {
  const path = `${projectId}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, '_')}`
  const { error } = await supabase.storage.from('maps').upload(path, file)
  if (error) throw new Error(error.message)
  return { path, url: mapImageUrl(path) }
}

export function mapImageUrl(path: string): string {
  return supabase.storage.from('maps').getPublicUrl(path).data.publicUrl
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
  return ok(data, error)
}

export async function updateEvent(id: string, attrs: Partial<WorldEvent>): Promise<WorldEvent> {
  const { data, error } = await supabase.from('events').update(attrs).eq('id', id).select().single()
  return ok(data, error)
}

export async function deleteEvent(id: string): Promise<void> {
  const { error } = await supabase.from('events').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// ---------- export / import ----------

const CHUNK = 200

function chunks<T>(arr: T[], size = CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/** select * from table where col in (ids), chunked to keep URLs short. */
async function selectIn<T>(table: string, col: string, ids: string[]): Promise<T[]> {
  const out: T[] = []
  for (const part of chunks(ids)) {
    const { data, error } = await supabase.from(table).select().in(col, part)
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
 * (viewers don't get secret pages). Map images are not included.
 */
export async function exportProject(projectId: string): Promise<ProjectExport> {
  const { data: proj, error } = await supabase.from('projects').select().eq('id', projectId).single()
  const project = ok(proj, error) as Project
  const pages = await listPages(projectId)
  const ids = pages.map((p) => p.id)
  const [mentions, pins, regions, events] = await Promise.all([
    selectIn<Mention>('mentions', 'from_page_id', ids),
    selectIn<Pin>('pins', 'map_page_id', ids),
    selectIn<Region>('regions', 'map_page_id', ids),
    selectIn<WorldEvent>('events', 'timeline_page_id', ids),
  ])
  return { format: 'worldkeeper-export', version: 1, project: { name: project.name }, pages, mentions, pins, regions, events }
}

/**
 * Creates a new project from an export. All ids are regenerated; references
 * (parent_id, mentions, pin/region/event targets) are remapped, dangling ones
 * dropped/nulled. map_image_path is cleared (images aren't exported in v1).
 */
export async function importProject(data: ProjectExport, name?: string): Promise<Project> {
  if (data?.format !== 'worldkeeper-export' || data.version !== 1) {
    throw new Error('Not a WorldKeeper export file')
  }
  const project = await createProject(name?.trim() || data.project?.name || 'Imported world')

  const idMap = new Map<string, string>()
  for (const p of data.pages ?? []) idMap.set(p.id, crypto.randomUUID())
  const remap = (id: string | null | undefined): string | null => (id ? idMap.get(id) ?? null : null)

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
        content: remapContent(p.content, idMap),
        map_image_path: null,
        map_w: p.map_w,
        map_h: p.map_h,
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
    content: remapContent(e.content, idMap), target_page_id: remap(e.target_page_id),
  })))

  return project
}

/** Deep-copies TipTap JSON, remapping mention node ids (attrs.id) to new page ids. */
function remapContent(content: unknown, idMap: Map<string, string>): unknown {
  if (Array.isArray(content)) return content.map((c) => remapContent(c, idMap))
  if (!content || typeof content !== 'object') return content
  const node = content as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node)) out[k] = remapContent(v, idMap)
  if (node.type === 'mention' && out.attrs && typeof out.attrs === 'object') {
    const attrs = out.attrs as Record<string, unknown>
    if (typeof attrs.id === 'string' && idMap.has(attrs.id)) out.attrs = { ...attrs, id: idMap.get(attrs.id) }
  }
  return out
}
