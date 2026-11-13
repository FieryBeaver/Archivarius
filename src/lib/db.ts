import { supabase } from './supabase'
import type {
  AnyProjectExport, Member, MemberWithProfile, Mention, Page, PageKind, PageTab, Pin, Plugin, PluginExport,
  Project, ProjectExport, Region, Role, ThemeOverrides, WorldEvent,
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

/** Owner only (RLS). null resets to the default theme. */
export async function updateProjectTheme(projectId: string, theme: ThemeOverrides | null): Promise<Project> {
  const { data, error } = await supabase.from('projects').update({ theme }).eq('id', projectId).select().single()
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
}

/** Owner only (RLS). */
export async function removePageEditor(pageId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('page_editors').delete().eq('page_id', pageId).eq('user_id', userId)
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
 * map_image_path is cleared (images aren't exported). Plugins (v0.6, optional)
 * are re-uploaded and pluginBlock pluginIds remapped. Page editors aren't
 * exported, so restricted pages are editable only by the importer (owner).
 */
export async function importProject(input: AnyProjectExport, name?: string): Promise<Project> {
  if (!isSupportedExport(input)) throw new Error('Not an Archivarius export file')
  // normalise v1 -> v2 shape
  const data: ProjectExport = input.format === 'archivarius-export' ? input : {
    ...input,
    format: 'archivarius-export',
    version: 2,
    project: { name: input.project?.name, theme: null },
    pages: (input.pages ?? []).map((p) => ({ ...p, edit_access: 'inherit', tabs: null })),
  }
  let project = await createProject(name?.trim() || data.project?.name || 'Imported world')
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
  const remapContent = (content: unknown) => remapDocIds(content, idMap, pluginMap)

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
        map_image_path: null,
        map_w: p.map_w,
        map_h: p.map_h,
        edit_access: p.edit_access === 'restricted' ? 'restricted' : 'inherit',
        tabs: Array.isArray(p.tabs)
          ? p.tabs.map((t) => ({ ...t, content: remapContent(t.content) }))
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

  return project
}

/**
 * Deep-copies TipTap JSON, remapping mention node ids (attrs.id) to new page ids
 * and pluginBlock plugin ids (attrs.pluginId) to new plugin ids. Unknown ids are
 * left as-is (they render as missing). pluginBlock `data` is copied untouched.
 */
function remapDocIds(content: unknown, idMap: Map<string, string>, pluginMap: Map<string, string>): unknown {
  if (Array.isArray(content)) return content.map((c) => remapDocIds(c, idMap, pluginMap))
  if (!content || typeof content !== 'object') return content
  const node = content as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node)) {
    // never walk into plugin data: it is opaque user JSON, not TipTap
    out[k] = node.type === 'pluginBlock' && k === 'attrs' ? v : remapDocIds(v, idMap, pluginMap)
  }
  if (node.type === 'mention' && out.attrs && typeof out.attrs === 'object') {
    const attrs = out.attrs as Record<string, unknown>
    if (typeof attrs.id === 'string' && idMap.has(attrs.id)) out.attrs = { ...attrs, id: idMap.get(attrs.id) }
  }
  if (node.type === 'pluginBlock' && out.attrs && typeof out.attrs === 'object') {
    const attrs = out.attrs as Record<string, unknown>
    if (typeof attrs.pluginId === 'string' && pluginMap.has(attrs.pluginId)) {
      out.attrs = { ...attrs, pluginId: pluginMap.get(attrs.pluginId) }
    }
  }
  return out
}
