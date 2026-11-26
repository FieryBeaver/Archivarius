/**
 * Framework-free core of the editor autosave (useAutosave.ts wraps it in React state).
 * Kept pure so its hold/flush rules can be unit-tested (scripts/test-autosave-hold.mjs).
 *
 * - schedule(p): remember the newest payload, save it after `debounceMs` of quiet.
 * - flush(): save the pending payload now. Saves run strictly one after another.
 * - pause() / resume(): a short, counted suspension while a newer remote version is being
 *   looked at (so a debounced save can't land on top of it mid-check). resume() restarts
 *   the debounce timer instead of saving at once, so a pause that immediately follows
 *   (cleanup + re-run of the check) never lets a write slip through.
 * - hold(): a conflicting remote version is on offer (the "updated by someone else" banner).
 *   Until release(), nothing is written: the debounce timer is cancelled, later
 *   schedule()/flush() calls only update the pending payload, and dispose() drops it.
 * - release(save): end the hold. save=true ("Keep mine") writes the pending payload now
 *   (or once the pause ends), replacing the remote version; save=false ("Reload") drops it.
 * - dispose(): unmount. Flushes (even if paused), unless held: then the pending edits are
 *   dropped (returns true when something was dropped, so the caller can tell the user).
 */

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'held'

export interface AutosaverOptions<P> {
  /** Writes the payload; resolves to the saved row's updated_at. */
  persist(payload: P): Promise<string>
  /** Called synchronously when a payload is handed to persist (e.g. to patch a local cache). */
  onFlush?(payload: P): void
  onStatus(status: SaveStatus): void
  debounceMs: number
  initialSavedAt?: string
  setTimer?(fn: () => void, ms: number): unknown
  clearTimer?(handle: unknown): void
}

export interface Autosaver<P> {
  schedule(payload: P): void
  flush(): void
  pause(): void
  resume(): void
  hold(): void
  release(keep: boolean): void
  isHeld(): boolean
  discard(): void
  dispose(): boolean
  hasPending(): boolean
  settled(): Promise<void>
  getSavedAt(): string | undefined
  setSavedAt(at: string): void
}

export function createAutosaver<P>(opts: AutosaverOptions<P>): Autosaver<P> {
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
  const clearTimer = opts.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>))
  let pending: P | null = null
  let timer: unknown = undefined
  let held = false
  let paused = 0
  let queue: Promise<void> = Promise.resolve()
  let savedAt = opts.initialSavedAt

  function cancelTimer() {
    if (timer !== undefined) clearTimer(timer)
    timer = undefined
  }

  function flush() {
    cancelTimer()
    if (held || paused > 0) return
    save()
  }

  function save() {
    const payload = pending
    if (payload === null) return
    pending = null
    opts.onFlush?.(payload)
    queue = queue
      .then(() => opts.persist(payload))
      .then(
        (at) => {
          savedAt = at
          if (pending === null && !held) opts.onStatus('saved')
        },
        () => opts.onStatus('error'),
      )
  }

  function discard() {
    cancelTimer()
    pending = null
    opts.onStatus('idle')
  }

  return {
    schedule(payload) {
      pending = payload
      cancelTimer()
      if (held) { opts.onStatus('held'); return }
      opts.onStatus('saving')
      if (paused === 0) timer = setTimer(flush, opts.debounceMs)
    },
    flush,
    pause() {
      cancelTimer()
      paused++
    },
    resume() {
      if (paused === 0) return
      paused--
      if (paused === 0 && !held && pending !== null) timer = setTimer(flush, opts.debounceMs)
    },
    hold() {
      cancelTimer()
      held = true
      if (pending !== null) opts.onStatus('held')
    },
    release(keep) {
      if (!held) return
      held = false
      if (!keep) { discard(); return }
      if (pending !== null) {
        opts.onStatus('saving')
        flush()
      }
    },
    isHeld: () => held,
    discard,
    dispose() {
      cancelTimer()
      if (!held) { save(); return false }
      const dropped = pending !== null
      pending = null
      return dropped
    },
    hasPending: () => pending !== null,
    settled: () => queue,
    getSavedAt: () => savedAt,
    setSavedAt(at) { savedAt = at },
  }
}
