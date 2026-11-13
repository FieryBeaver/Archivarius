import { create } from 'zustand'

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
