import { create } from 'zustand'
import type { ProjectPrefs } from '../lib/types'

/**
 * Bump to make ProjectLayout refetch the current project (name, theme). Settings already
 * trigger this on close; call `refreshProject()` to re-apply e.g. a saved theme right away.
 */
interface ProjectRefreshState {
  version: number
  refreshProject(): void
}

export const useProjectRefresh = create<ProjectRefreshState>((set) => ({
  version: 0,
  refreshProject: () => set((s) => ({ version: s.version + 1 })),
}))

/**
 * v0.9: the open world's preferences (projects.prefs), set by ProjectLayout when the project
 * loads and by Settings after a save. Readers outside React use getState().
 */
interface ProjectPrefsState {
  projectId: string | null
  prefs: ProjectPrefs | null
  setPrefs(projectId: string | null, prefs: ProjectPrefs | null): void
}

export const useProjectPrefs = create<ProjectPrefsState>((set) => ({
  projectId: null,
  prefs: null,
  setPrefs: (projectId, prefs) => set({ projectId, prefs }),
}))

/** Preferences for `projectId` — the stored ones when that world is open, else null (defaults). */
export function prefsFor(projectId: string | null | undefined): ProjectPrefs | null {
  const s = useProjectPrefs.getState()
  return projectId && s.projectId === projectId ? s.prefs : null
}
