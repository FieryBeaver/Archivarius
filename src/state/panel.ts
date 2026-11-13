import { create } from 'zustand'

/**
 * Page preview in the right-hand context panel (see CONTRACT.md v0.5).
 * Any feature may call `openPreview`; only ProjectLayout renders the panel.
 */
interface PanelState {
  previewPageId: string | null
  openPreview(pageId: string): void
  closePreview(): void
}

export const usePanelStore = create<PanelState>((set) => ({
  previewPageId: null,
  openPreview: (pageId) => set({ previewPageId: pageId }),
  closePreview: () => set({ previewPageId: null }),
}))
