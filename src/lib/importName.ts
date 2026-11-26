/**
 * Name for an imported world: `base` as is, or "<base> (imported)" / "(imported 2)" … when
 * a world with that name (case-insensitive, trimmed) already exists, so the copies can be
 * told apart on the Your-worlds screen.
 */
export function uniqueImportName(base: string, existing: readonly string[]): string {
  const taken = new Set(existing.map((n) => n.trim().toLowerCase()))
  const name = base.trim()
  if (!taken.has(name.toLowerCase())) return name
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? `${name} (imported)` : `${name} (imported ${i})`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}
