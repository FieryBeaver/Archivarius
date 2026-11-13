import type { Role } from '../../lib/types'

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner',
  editor: 'Editor',
  viewer: 'Viewer',
}

export const ROLES: Role[] = ['owner', 'editor', 'viewer']

export const LAST_OWNER_TIP = 'A world needs at least one owner'
