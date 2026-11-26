/*
 * Titles for pages created from editor text: "New subpage from selection" and the
 * "+ Create “…”" row of the page pickers (@ mention suggestion, "Link to existing page…").
 * Pure — no React/TipTap — so scripts/test-new-page-title.mjs can run it under node.
 */

const TITLE_MAX = 80

/** Text → page title: whitespace collapsed, trimmed, capped; "Untitled" if empty. */
export function titleFromText(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return 'Untitled'
  return clean.length > TITLE_MAX ? `${clean.slice(0, TITLE_MAX - 1).trimEnd()}…` : clean
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * The title a picker's create row would use for `query`, or null when no row should show:
 * the query is blank, or an existing page already has that exact title (case-insensitive,
 * whitespace-collapsed; a blank title counts as "Untitled").
 */
export function createTitleFor(query: string, existingTitles: Iterable<string | null | undefined>): string | null {
  const q = norm(query)
  if (!q) return null
  const title = titleFromText(query)
  const t = title.toLowerCase()
  for (const existing of existingTitles) {
    const e = norm(existing || 'Untitled')
    if (e === q || e === t) return null
  }
  return title
}
