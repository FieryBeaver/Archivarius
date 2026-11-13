export type Role = 'owner' | 'editor' | 'viewer'
export type PageKind = 'doc' | 'map' | 'timeline'

export interface Project {
  id: string
  name: string
  owner_id: string
  created_at: string
  /** v0.5: per-project theme overrides (CSS color strings); null = default theme */
  theme: ThemeOverrides | null
}

export interface Member {
  project_id: string
  user_id: string
  role: Role
}

export interface Page {
  id: string
  project_id: string
  parent_id: string | null
  position: number
  title: string
  icon: string | null
  kind: PageKind
  is_secret: boolean
  content: unknown | null
  map_image_path: string | null
  map_w: number | null
  map_h: number | null
  created_at: string
  updated_at: string
  /** v0.5: 'restricted' = only owners and listed page editors may write */
  edit_access: 'inherit' | 'restricted'
  /** v0.5: null = legacy single doc in `content`; else `content` mirrors tabs[0].content */
  tabs: PageTab[] | null
}

export interface Mention {
  from_page_id: string
  to_page_id: string
}

export interface Pin {
  id: string
  map_page_id: string
  x: number
  y: number
  target_page_id: string | null
  label: string | null
  color: string | null
  icon: string | null
}

export interface Region {
  id: string
  map_page_id: string
  /** polygon vertices as [x, y] in map image pixel coordinates */
  points: [number, number][]
  target_page_id: string | null
  label: string | null
  color: string | null
  opacity: number
}

export interface WorldEvent {
  id: string
  timeline_page_id: string
  position: number
  sort_key: number
  display_date: string
  era: string | null
  title: string
  content: unknown | null
  target_page_id: string | null
}

// ---------- v0.4 ----------

export interface Profile {
  id: string
  email: string
  created_at: string
}

export type MemberWithProfile = Member & { email: string }

// ---------- v0.5 ----------

export interface ThemeOverrides {
  accent?: string
  accent2?: string
  bg?: string
  panel?: string
  panel2?: string
  border?: string
  text?: string
  muted?: string
}

export interface PageTab {
  id: string
  title: string
  content: unknown
}

export interface PageEditor {
  page_id: string
  user_id: string
  project_id: string
}

/** JSON export of a whole project (map images and page editors are NOT included). */
export interface ProjectExport {
  format: 'archivarius-export'
  version: 2
  project: { name: string; theme: ThemeOverrides | null }
  pages: Page[]
  mentions: Mention[]
  pins: Pin[]
  regions: Region[]
  events: WorldEvent[]
  /** v0.6: project plugins with their HTML source inlined. Absent in older exports. */
  plugins?: PluginExport[]
}

/** Legacy v1 export (WorldKeeper). Pages lack edit_access/tabs; project has no theme. */
export interface ProjectExportV1 {
  format: 'worldkeeper-export'
  version: 1
  project: { name: string }
  pages: Omit<Page, 'edit_access' | 'tabs'>[]
  mentions: Mention[]
  pins: Pin[]
  regions: Region[]
  events: WorldEvent[]
}

/** Anything importProject accepts. */
export type AnyProjectExport = ProjectExport | ProjectExportV1

// ---------- v0.6 ----------

/** A user-uploaded plugin: one HTML file in storage at `plugins/<project_id>/<id>.html`. */
export interface Plugin {
  id: string
  project_id: string
  name: string
  icon: string | null
  source_path: string
  created_at: string
}

/** A plugin inside a ProjectExport (HTML inlined). */
export interface PluginExport {
  id: string
  name: string
  icon: string | null
  source: string
}
