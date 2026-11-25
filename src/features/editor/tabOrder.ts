/**
 * Moves the tab `id` right before / after the tab `targetId`. Works on the full tab list,
 * so tabs hidden from the current view keep their place relative to their neighbours.
 * Returns the same array when nothing changes (unknown ids, or a move onto itself).
 */
export function moveTab<T extends { id: string }>(tabs: T[], id: string, targetId: string, side: 'before' | 'after'): T[] {
  if (id === targetId) return tabs
  const moving = tabs.find((t) => t.id === id)
  if (!moving || !tabs.some((t) => t.id === targetId)) return tabs
  const rest = tabs.filter((t) => t.id !== id)
  const at = rest.findIndex((t) => t.id === targetId) + (side === 'after' ? 1 : 0)
  const next = [...rest.slice(0, at), moving, ...rest.slice(at)]
  return next.every((t, i) => t === tabs[i]) ? tabs : next
}

