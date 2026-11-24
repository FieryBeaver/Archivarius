import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { useEffect } from 'react'
import { create } from 'zustand'
import { invalidatePlugins } from '../features/editor/pluginBlock'
import * as db from '../lib/db'
import { supabase } from '../lib/supabase'
import type { Page } from '../lib/types'
import { useAuth } from './auth'
import { usePageEditors } from './pageEditors'
import { usePages } from './pages'
import { useProjectRefresh } from './project'

/*
 * v0.11 live updates (CONTRACT.md "v0.11 contracts — realtime").
 *
 * Per open world, two channels:
 *  - `live-pg:<projectId>:<n>`: postgres_changes on pages / page_editors / plugins / members /
 *    project_roles filtered by project_id (RLS-checked by Realtime with the user's JWT).
 *  - `project:<projectId>` (private broadcast, RLS on realtime.messages = project members):
 *    every client announces its own successful writes ({ v, kind, ids, from }, sent from the
 *    db.ts mutation helpers). This is the main signal: it also covers deletes and rows that
 *    just became invisible, for which postgres_changes sends nothing.
 * Signals are batched (~300 ms) and turned into idempotent refreshes of the stores.
 * postgres_changes events that a broadcast already explained (or our own writes' echoes)
 * are dropped; the rest count as structural changes (full page-list reload).
 */

/** Distinguishes this tab's broadcasts from everyone else's (own echoes are ignored). */
const CLIENT_ID = crypto.randomUUID()

const BATCH_MS = 300
/** postgres_changes wait this long for the matching broadcast before acting on their own. */
const PG_GRACE_MS = 1200
/** How long a broadcast (sent or received) "explains" matching postgres_changes events. */
const COVER_MS = 5000
/** Focus / visibility safety-net refreshes at most this often. */
const FOCUS_MIN_MS = 5000

type ChangeKind = db.ChangeKind

interface BroadcastPayload {
  v: 1
  kind: ChangeKind
  ids: string[]
  from: string
}

const KINDS: ReadonlySet<string> = new Set<ChangeKind>([
  'pages', 'content', 'pins', 'regions', 'events', 'page_editors', 'plugins', 'members', 'project_roles', 'project',
])

// ---------- store: what views subscribe to ----------

interface LiveState {
  /** Per page id: bumped when that page (its row, pins/regions/events) changed elsewhere. */
  bumps: Record<string, number>
  /** Bumped when the world's members/roles or plugins changed elsewhere. */
  versions: { members: number; plugins: number }
  /** Pages that vanished from the list during the last live refresh (deleted / now hidden). */
  vanished: Record<string, true>
  /** A short note for the layout toast (e.g. the open page was removed). */
  notice: string | null
  setNotice(notice: string | null): void
}

export const useLive = create<LiveState>((set) => ({
  bumps: {},
  versions: { members: 0, plugins: 0 },
  vanished: {},
  notice: null,
  setNotice: (notice) => set({ notice }),
}))

/** Changes whenever the page was changed by someone else (0 = never). */
export function usePageBump(pageId: string | undefined): number {
  return useLive((s) => (pageId ? s.bumps[pageId] ?? 0 : 0))
}

/** Changes whenever members/roles ('members') or plugins ('plugins') changed elsewhere. */
export function useLiveVersion(kind: 'members' | 'plugins'): number {
  return useLive((s) => s.versions[kind])
}

/**
 * Signals that these pages changed (views re-read them). Also used by the scripting API
 * (src/api/browser.ts) for its own writes, which realtime ignores as this tab's echoes.
 */
export function bumpPages(ids: Iterable<string>) {
  const list = [...ids]
  if (list.length === 0) return
  useLive.setState((s) => {
    const bumps = { ...s.bumps }
    for (const id of list) bumps[id] = (bumps[id] ?? 0) + 1
    return { bumps }
  })
}

function bumpVersion(kind: 'members' | 'plugins') {
  useLive.setState((s) => ({ versions: { ...s.versions, [kind]: s.versions[kind] + 1 } }))
}

// ---------- one session per open world ----------

/** The postgres_changes table a change kind shows up as. */
function tableOf(kind: ChangeKind): string {
  return kind === 'content' ? 'pages' : kind
}

let pgSeq = 0
/** Resolves when the previous session's channels are fully gone (same topic can't be reused before). */
let lastTeardown: Promise<unknown> = Promise.resolve()

function startSession(projectId: string): () => void {
  let stopped = false
  const covered = new Map<string, number>() // `${table}:${id}` -> expiry
  const pending = new Map<ChangeKind, Set<string>>()
  let fullRefresh = false
  let batchTimer: ReturnType<typeof setTimeout> | undefined
  const pgQueue: { table: string; id: string | null; at: number }[] = []
  let pgTimer: ReturnType<typeof setTimeout> | undefined
  let running: Promise<void> = Promise.resolve()
  let lastFocusRefresh = Date.now()
  let bc: RealtimeChannel | null = null
  let pg: RealtimeChannel | null = null
  let subscribedOnce = false

  const cover = (kind: ChangeKind, ids: string[]) => {
    const now = Date.now()
    if (covered.size > 500) for (const [key, until] of covered) if (until <= now) covered.delete(key)
    for (const id of ids) covered.set(`${tableOf(kind)}:${id}`, now + COVER_MS)
  }
  const isCovered = (table: string, id: string | null) => {
    if (!id) return false
    const until = covered.get(`${table}:${id}`)
    return until !== undefined && until > Date.now()
  }

  const enqueue = (kind: ChangeKind, ids: string[]) => {
    let set = pending.get(kind)
    if (!set) pending.set(kind, (set = new Set()))
    for (const id of ids) set.add(id)
    clearTimeout(batchTimer)
    batchTimer = setTimeout(flush, BATCH_MS)
  }

  const refreshAll = () => {
    fullRefresh = true
    clearTimeout(batchTimer)
    batchTimer = setTimeout(flush, BATCH_MS)
  }

  function flush() {
    if (stopped) return
    const batch = new Map(pending)
    const full = fullRefresh
    pending.clear()
    fullRefresh = false
    // Serialize: a slow refresh never races a newer one.
    running = running.then(() => apply(batch, full)).catch(() => { /* next signal retries */ })
  }

  async function apply(batch: Map<ChangeKind, Set<string>>, full: boolean) {
    if (stopped || usePages.getState().projectId !== projectId) return
    const ids = (k: ChangeKind) => [...(batch.get(k) ?? [])]
    const structural = full || ['pages', 'page_editors', 'members', 'project_roles'].some((k) => batch.has(k as ChangeKind))
    const before = new Map(usePages.getState().pages.map((p) => [p.id, p]))
    const toBump = new Set<string>([...ids('pins'), ...ids('regions'), ...ids('events'), ...ids('content'), ...ids('pages')])

    if (structural) {
      // Like usePages.load() for the same project (expanded/viewAs/hideSecrets are kept), but a
      // failed background refresh throws here instead of putting the store into 'error'.
      const [after, membership] = await Promise.all([db.listPages(projectId), db.getMyMembership(projectId)])
      if (stopped || usePages.getState().projectId !== projectId) return
      usePages.setState({
        pages: after, role: membership.role, roleName: membership.roleName, editOwnOnly: membership.editOwnOnly,
        status: 'ready', error: null,
      })
      const afterIds = new Set(after.map((p) => p.id))
      for (const p of after) {
        const old = before.get(p.id)
        if (!old || old.updated_at !== p.updated_at) toBump.add(p.id)
      }
      const vanished: Record<string, true> = {}
      for (const id of before.keys()) if (!afterIds.has(id)) vanished[id] = true
      useLive.setState({ vanished })
    } else if (batch.has('content')) {
      // Autosaves: fetch just those rows and patch them in (no full reload per keystroke burst).
      const rows: Page[] = await db.getPagesByIds(ids('content')).catch(() => [])
      if (stopped || usePages.getState().projectId !== projectId) return
      const { patchLocal, pages } = usePages.getState()
      const known = new Set(pages.map((p) => p.id))
      for (const row of rows) if (known.has(row.id)) patchLocal(row.id, row)
    }

    if (batch.has('page_editors') || full) {
      // Grants changed: refresh cached editor lists (the named pages, or every cached one).
      const { byPage, load } = usePageEditors.getState()
      const named = ids('page_editors')
      const targets = named.length && !full ? named.filter((id) => id in byPage) : Object.keys(byPage)
      targets.forEach((id) => void load(id))
    }
    if (batch.has('members') || batch.has('project_roles') || full) bumpVersion('members')
    if (batch.has('plugins') || full) {
      invalidatePlugins(projectId)
      bumpVersion('plugins')
    }
    if (batch.has('project') || full) useProjectRefresh.getState().refreshProject()
    bumpPages(toBump)
  }

  // ----- outgoing: db.ts mutation helpers report successful writes -----

  db.setChangeNotifier((kind, ids) => {
    if (stopped) return
    cover(kind, ids)
    const payload: BroadcastPayload = { v: 1, kind, ids, from: CLIENT_ID }
    if (bc && bc.state === 'joined') {
      void bc.send({ type: 'broadcast', event: 'change', payload })
    } else if (bc) {
      void bc.httpSend('change', payload).catch(() => { /* best-effort */ })
    }
  })

  // ----- incoming -----

  const onBroadcast = (msg: { payload?: unknown }) => {
    const p = msg.payload as Partial<BroadcastPayload> | undefined
    if (!p || p.from === CLIENT_ID || typeof p.kind !== 'string' || !KINDS.has(p.kind)) return
    const ids = Array.isArray(p.ids) ? p.ids.filter((x): x is string => typeof x === 'string').slice(0, 500) : []
    cover(p.kind, ids)
    enqueue(p.kind, ids)
  }

  const onPg = (table: string, idOf: (row: Record<string, unknown>) => unknown) =>
    (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
      const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) ?? {}
      const id = idOf(row)
      pgQueue.push({ table, id: typeof id === 'string' ? id : null, at: Date.now() })
      if (pgTimer === undefined) pgTimer = setTimeout(drainPg, PG_GRACE_MS)
    }

  function drainPg() {
    pgTimer = undefined
    if (stopped) return
    const now = Date.now()
    const later: typeof pgQueue = []
    for (const ev of pgQueue.splice(0)) {
      if (isCovered(ev.table, ev.id)) continue // explained by a broadcast / our own write
      if (now - ev.at < PG_GRACE_MS) { later.push(ev); continue }
      // Unexplained (a write from outside the app, or a lost broadcast): treat as structural.
      enqueue(ev.table as ChangeKind, ev.id ? [ev.id] : [])
    }
    if (later.length) {
      pgQueue.push(...later)
      pgTimer = setTimeout(drainPg, PG_GRACE_MS)
    }
  }

  const filter = `project_id=eq.${projectId}`
  const start = async () => {
    await lastTeardown
    if (stopped) return
    bc = supabase
      .channel(`project:${projectId}`, { config: { private: true, broadcast: { self: false } } })
      .on('broadcast', { event: 'change' }, onBroadcast)
    bc.subscribe((status) => {
      // A (re)join after a drop may have missed events: catch up once.
      if (status === 'SUBSCRIBED') {
        if (subscribedOnce) refreshAll()
        subscribedOnce = true
      }
    })
    pg = supabase
      .channel(`live-pg:${projectId}:${++pgSeq}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pages', filter }, onPg('pages', (r) => r.id))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'page_editors', filter }, onPg('page_editors', (r) => r.page_id))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'plugins', filter }, onPg('plugins', (r) => r.id))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'members', filter }, onPg('members', (r) => r.user_id))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_roles', filter }, onPg('project_roles', (r) => r.id))
    pg.subscribe()
  }
  void start()

  // ----- safety net: cheap re-check when the tab comes back -----

  const onFocus = () => {
    if (document.visibilityState === 'hidden') return
    if (Date.now() - lastFocusRefresh < FOCUS_MIN_MS) return
    lastFocusRefresh = Date.now()
    refreshAll()
  }
  window.addEventListener('focus', onFocus)
  document.addEventListener('visibilitychange', onFocus)

  return () => {
    stopped = true
    clearTimeout(batchTimer)
    clearTimeout(pgTimer)
    window.removeEventListener('focus', onFocus)
    document.removeEventListener('visibilitychange', onFocus)
    db.setChangeNotifier(null)
    const channels = [bc, pg].filter((c): c is RealtimeChannel => c !== null)
    lastTeardown = Promise.all([lastTeardown, ...channels.map((c) => supabase.removeChannel(c))]).catch(() => {})
    useLive.setState({ vanished: {}, notice: null })
  }
}

/**
 * Live updates for the open world. Call once from ProjectLayout; the session is torn down
 * on project switch, unmount and sign-out (session user changes).
 */
export function useRealtime(projectId: string | undefined): void {
  const userId = useAuth((s) => s.session?.user.id)
  useEffect(() => {
    if (!projectId || !userId) return
    let stop: (() => void) | null = null
    // Deferred a tick: StrictMode's mount/unmount/mount never opens a throwaway session.
    const t = setTimeout(() => { stop = startSession(projectId) }, 0)
    return () => {
      clearTimeout(t)
      stop?.()
    }
  }, [projectId, userId])
}
