/**
 * Orders page-picker matches: an exact (case-insensitive) title match first, then titles
 * starting with the query, then ones with a word starting with it, then other substring
 * matches; alphabetical within each group. Non-matches are dropped. Empty query: alphabetical.
 */
export function rankByTitle<T>(items: readonly T[], query: string, titleOf: (item: T) => string): T[] {
  const q = query.trim().toLowerCase()
  const scored: { item: T; title: string; rank: number }[] = []
  for (const item of items) {
    const title = titleOf(item).trim().toLowerCase()
    const rank = titleRank(title, q)
    if (rank >= 0) scored.push({ item, title, rank })
  }
  scored.sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title))
  return scored.map((s) => s.item)
}

/** 0 exact, 1 prefix, 2 word prefix, 3 substring, -1 no match (title and query lower-cased). */
function titleRank(title: string, q: string): number {
  if (!q) return 0
  if (title === q) return 0
  if (title.startsWith(q)) return 1
  const at = title.indexOf(q)
  if (at < 0) return -1
  return /[\s\-_(/]/.test(title[at - 1]) ? 2 : 3
}
