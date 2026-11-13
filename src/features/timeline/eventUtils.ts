import type { WorldEvent } from '../../lib/types'

/**
 * Event body storage shape in the `content` jsonb column: `{ text: string }`.
 * Reads are defensive: a bare string or any object with a string `text` is accepted.
 */
export interface EventContent {
  text: string
}

export function readEventText(content: unknown): string {
  if (typeof content === 'string') return content
  if (content && typeof content === 'object' && 'text' in content) {
    const t = (content as { text: unknown }).text
    if (typeof t === 'string') return t
  }
  return ''
}

export function toEventContent(text: string): EventContent | null {
  const trimmed = text.replace(/\s+$/, '')
  return trimmed ? { text: trimmed } : null
}

export function compareEvents(a: WorldEvent, b: WorldEvent): number {
  return a.sort_key - b.sort_key || a.position - b.position
}

/**
 * Pick a value for inserting between `prev` and `next` (either may be missing).
 * Midpoint between neighbours, prev+10 at the end, next-10 at the start, 0 when empty.
 */
export function between(prev: number | undefined, next: number | undefined): number {
  if (prev !== undefined && next !== undefined) {
    if (prev === next) return prev
    return roundNice((prev + next) / 2, prev, next)
  }
  if (prev !== undefined) return Math.floor(prev) + 10
  if (next !== undefined) return Math.ceil(next) - 10
  return 0
}

/** Prefer an integer (or a short decimal) strictly between lo and hi when one exists. */
function roundNice(mid: number, a: number, b: number): number {
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  for (const step of [1, 0.5, 0.25, 0.1, 0.01]) {
    const r = Math.round(mid / step) * step
    const fixed = Number(r.toFixed(4))
    if (fixed > lo && fixed < hi) return fixed
  }
  return mid
}

/** Insertion values for a new event placed at list index `index` (before events[index]). */
export function insertionKeys(events: WorldEvent[], index: number): { sort_key: number; position: number } {
  const prev = events[index - 1]
  const next = events[index]
  const sort_key = between(prev?.sort_key, next?.sort_key)
  // position only breaks ties among equal sort_keys
  let position = 0
  const prevSame = prev && prev.sort_key === sort_key ? prev.position : undefined
  const nextSame = next && next.sort_key === sort_key ? next.position : undefined
  if (prevSame !== undefined || nextSame !== undefined) position = between(prevSame, nextSame)
  return { sort_key, position }
}

export interface EraGroup {
  era: string | null
  /** index of the first event of this group within the flat list */
  start: number
  events: WorldEvent[]
}

/** Consecutive events with the same era form one group. */
export function groupByEra(events: WorldEvent[]): EraGroup[] {
  const groups: EraGroup[] = []
  events.forEach((ev, i) => {
    const era = normEra(ev.era)
    const last = groups[groups.length - 1]
    if (last && last.era === era) last.events.push(ev)
    else groups.push({ era, start: i, events: [ev] })
  })
  return groups
}

export function normEra(era: string | null | undefined): string | null {
  const t = (era ?? '').trim()
  return t ? t : null
}

export function countDuplicateKeys(events: WorldEvent[]): number {
  const seen = new Map<number, number>()
  for (const ev of events) seen.set(ev.sort_key, (seen.get(ev.sort_key) ?? 0) + 1)
  let dupes = 0
  for (const n of seen.values()) if (n > 1) dupes += 1
  return dupes
}
