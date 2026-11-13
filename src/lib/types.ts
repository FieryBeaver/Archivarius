export type Role = 'owner' | 'editor' | 'viewer'
export type PageKind = 'doc' | 'map' | 'timeline'

export interface Project {
  id: string
  name: string
  owner_id: string
  created_at: string
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
