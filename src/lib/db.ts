import { supabase } from './supabase'
import type { Page, PageKind, Pin, Project, Region, WorldEvent } from './types'

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
