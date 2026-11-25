/*
 * The scripting API (API.md): a small, friendly layer over src/lib/db.ts for creating and
 * editing notes from the DevTools console, a bookmarklet or other scripts.
 *
 * Framework-free: no React, no zustand. Everything goes through the db.ts helpers, so
 * writes are exactly what the editor does (savePageTabs / updatePage + mention syncing,
 * RLS on the server, live-update broadcasts to other members). The host (browser.ts)
 * supplies the open world and is told about every successful write.
 */
import * as db from '../lib/db'
import type { Page, PageTab } from '../lib/types'
import { childrenOf, positionBetween } from '../state/pageTree'
import {
  EMPTY_DOC, docToMarkdown, markdownToBlocks, markdownToDoc,
  type JsonNode, type PageRef,
} from './markdown'

export type { JsonNode } from './markdown'

// ---------- public types ----------

export interface WorldInfo {
  id: string
  name: string
}

export interface CreateNoteOptions {
  title: string
  /** Initial body, in the Markdown subset (see API.md). */
  text?: string
  /** Parent page: its id or exact title. Omit for a top-level page. */
  parent?: string | null
  /** An emoji or icon name, as in the icon picker. */
  icon?: string | null
  /** Create it secret (hidden from players, with everything under it). */
  secret?: boolean
}

export interface ListNotesOptions {
  /** Only the direct children of this page (id or title); null = top-level pages. Omit for all. */
  parent?: string | null
}

export type Replacer = string | ((match: string, ...args: unknown[]) => string)

export interface Notes {
  /** Creates a note (a document page). */
  create(opts: CreateNoteOptions): Promise<Note>
  /** A note by id or exact title (case-insensitive if no exact match). */
  get(idOrTitle: string): Promise<Note>
  /** Notes whose title contains `query` (case-insensitive, up to 10). */
  find(query: string): Promise<Note[]>
  /** Every page you can see, or the children of `parent`, in sidebar order. */
  list(opts?: ListNotesOptions): Promise<Note[]>
}

export interface World {
  /** The world's id (resolves the name on first use). */
  id(): Promise<string>
  info(): Promise<WorldInfo>
  readonly notes: Notes
}

export interface Note {
  readonly id: string
  readonly worldId: string
  readonly title: string
  readonly icon: string | null
  readonly parentId: string | null
  readonly kind: Page['kind']
  /** The page's own secret flag (a secret ancestor hides it too). */
  readonly secret: boolean
  readonly updatedAt: string
  /** App path of the page, e.g. /project/<world>/page/<id>. */
  readonly path: string

  /** The note's body as Markdown (fetched fresh). */
  text(): Promise<string>
  /** The note's body as the editor's ProseMirror JSON (fetched fresh). */
  json(): Promise<JsonNode>
  /** Adds Markdown blocks at the end. */
  append(markdown: string): Promise<Note>
  /** Adds Markdown blocks at the start. */
  prepend(markdown: string): Promise<Note>
  /** Replaces the whole body. */
  setText(markdown: string): Promise<Note>
  /** Find-and-replace on the Markdown rendering (string = every occurrence), then saves. */
  replace(find: string | RegExp, replaceWith: Replacer): Promise<Note>
  rename(title: string): Promise<Note>
  /** Moves under another page (id or title), or to the top level with null. */
  move(parent: string | null): Promise<Note>
  /** Marks the page secret. */
  hide(): Promise<Note>
  /** Clears the page's secret flag. */
  show(): Promise<Note>
  /** Copies the page AND everything under it, next to it; resolves to the copy ("<title> copy"). */
  duplicate(): Promise<Note>
  /** Deletes the page AND everything under it. */
  delete(): Promise<void>
  /** Re-reads the page's metadata. */
  refresh(): Promise<Note>
}

export interface Archivarius {
  /** A world by name or id; no argument = the world open in the app. */
  world(nameOrId?: string): World
  /** Worlds you can access. */
  worlds(): Promise<WorldInfo[]>
  /** Shortcut for world().notes (the open world). */
  readonly notes: Notes
  /** The Markdown converters, for scripts that work with raw JSON. */
  readonly markdown: {
    toJson(markdown: string): JsonNode
    fromJson(doc: unknown): string
  }
}

/** A successful write, reported to the host so it can refresh its views. */
export interface ApiChange {
  worldId: string
  /** 'content' = only the body of `pages` changed; 'pages' = structure / metadata. */
  kind: 'pages' | 'content'
  pageIds: string[]
  /** The saved rows, when the write returned them. */
  pages: Page[]
}

export interface ArchivariusHost {
  /** The world open in the app, or null. */
  currentWorldId(): string | null
  /** Called after every successful write (errors thrown here are ignored). */
  onChange?(change: ApiChange): void | Promise<void>
}

// ---------- errors ----------

const PERMISSION = /row-level security|permission denied|42501|violates.*polic|JSON object requested|multiple \(or no\) rows|coerce the result to a single JSON object/i

/** Runs a db.ts write; RLS refusals become a clear "Permission denied" error. */
async function write<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (PERMISSION.test(msg)) throw new Error(`Permission denied by the server: you can't ${what}`)
    throw new Error(`Couldn't ${what}: ${msg}`)
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function quote(s: string): string {
  return `'${s}'`
}

// ---------- implementation ----------

export function createArchivarius(host: ArchivariusHost): Archivarius {
  async function report(change: ApiChange): Promise<void> {
    try {
      await host.onChange?.(change)
    } catch {
      /* view refresh is best-effort */
    }
  }

  async function resolveWorld(nameOrId: string | undefined): Promise<WorldInfo> {
    const projects = await db.listProjects()
    if (nameOrId === undefined) {
      const id = host.currentWorldId()
      if (!id) throw new Error("No world is open. Open one in the app, or use archivarius.world('World name').")
      const p = projects.find((x) => x.id === id)
      if (!p) throw new Error('The open world is not accessible to you')
      return { id: p.id, name: p.name }
    }
    const key = String(nameOrId).trim()
    const byId = projects.find((p) => p.id === key)
    if (byId) return { id: byId.id, name: byId.name }
    let hits = projects.filter((p) => p.name === key)
    if (hits.length === 0) hits = projects.filter((p) => p.name.toLowerCase() === key.toLowerCase())
    if (hits.length === 1) return { id: hits[0].id, name: hits[0].name }
    if (hits.length > 1) {
      throw new Error(`Several worlds are named ${quote(key)}; use the id instead: ${hits.map((p) => p.id).join(', ')}`)
    }
    throw new Error(`No world named ${quote(key)} that you can access`)
  }

  function makeWorld(nameOrId: string | undefined): World {
    // A named world is resolved once; the default one follows whatever world is open.
    let cached: Promise<WorldInfo> | null = null
    const info = () => {
      if (nameOrId === undefined) return resolveWorld(undefined)
      cached ??= resolveWorld(nameOrId).catch((e) => { cached = null; throw e })
      return cached
    }
    const worldId = async () => (await info()).id
    return {
      id: worldId,
      info,
      notes: makeNotes(worldId),
    }
  }

  // ----- page lookup -----

  function findPage(pages: Page[], idOrTitle: string): Page {
    const key = String(idOrTitle ?? '').trim()
    if (!key) throw new Error('A page id or title is required')
    const byId = pages.find((p) => p.id === key)
    if (byId) return byId
    let hits = pages.filter((p) => p.title === key)
    if (hits.length === 0) hits = pages.filter((p) => p.title.trim().toLowerCase() === key.toLowerCase())
    if (hits.length === 1) return hits[0]
    if (hits.length > 1) {
      throw new Error(`Several pages are titled ${quote(key)}; use the id instead: ${hits.map((p) => p.id).join(', ')}`)
    }
    if (UUID.test(key)) throw new Error(`No page with id ${key} in this world (or it is hidden from you)`)
    throw new Error(`No page titled ${quote(key)} in this world`)
  }

  /** [[Title]] -> page: exact title first, then case-insensitive; null when none. */
  function pageResolver(pages: Page[]): (title: string) => PageRef | null {
    return (title) => {
      const t = title.trim()
      const hit = pages.find((p) => p.title === t)
        ?? pages.find((p) => p.title.trim().toLowerCase() === t.toLowerCase())
      return hit ? { id: hit.id, title: hit.title } : null
    }
  }

  function titleLookup(pages: Page[]): (id: string) => string | undefined {
    const byId = new Map(pages.map((p) => [p.id, p.title]))
    return (id) => byId.get(id)
  }

  // ----- document access -----

  /** Index of the tab the API reads/writes: the first document (non-plugin) tab; -1 = legacy single doc. */
  function docTabIndex(page: Page): number {
    if (!page.tabs?.length) return -1
    const i = page.tabs.findIndex((t) => !t.plugin)
    if (i < 0) throw new Error(`${quote(page.title)} has no document tab`)
    return i
  }

  function asDoc(content: unknown): JsonNode {
    if (content && typeof content === 'object' && (content as JsonNode).type === 'doc') {
      return structuredClone(content as JsonNode)
    }
    return structuredClone(EMPTY_DOC)
  }

  function readDoc(page: Page): JsonNode {
    const i = docTabIndex(page)
    return asDoc(i < 0 ? page.content : page.tabs![i].content)
  }

  /** Drops empty paragraphs at the edges (a fresh page is one empty paragraph). */
  function trimEmpty(blocks: JsonNode[]): JsonNode[] {
    const empty = (b: JsonNode) => b.type === 'paragraph' && !(b.content?.length)
    let s = 0
    let e = blocks.length
    while (s < e && empty(blocks[s])) s++
    while (e > s && empty(blocks[e - 1])) e--
    return blocks.slice(s, e)
  }

  // ----- notes -----

  function makeNotes(worldId: () => Promise<string>): Notes {
    return {
      async create(opts) {
        if (!opts || typeof opts !== 'object') throw new Error("create() takes an object, e.g. { title: 'Ravenholm' }")
        const wid = await worldId()
        const title = String(opts.title ?? '').trim() || 'Untitled'
        const pages = await db.listPages(wid)
        const parent = opts.parent ? findPage(pages, opts.parent) : null
        const content = opts.text
          ? markdownToDoc(opts.text, { resolvePage: pageResolver(pages) })
          : undefined
        const page = await write(`create a page in this world`, () => db.createPage(wid, {
          title,
          kind: 'doc',
          parent_id: parent?.id ?? null,
          position: positionBetween(childrenOf(pages, parent?.id ?? null).at(-1)),
          ...(opts.icon ? { icon: opts.icon } : {}),
          ...(opts.secret ? { is_secret: true } : {}),
          ...(content ? { content } : {}),
        }))
        if (content) {
          // Same as an editor save of a fresh page: record its outgoing [[links]].
          await write(`save the links of ${quote(title)}`, () => db.syncMentions(page.id, [content]))
        }
        await report({ worldId: wid, kind: 'pages', pageIds: [page.id], pages: [page] })
        return new NoteImpl(page)
      },

      async get(idOrTitle) {
        const wid = await worldId()
        return new NoteImpl(findPage(await db.listPages(wid), idOrTitle))
      },

      async find(query) {
        const wid = await worldId()
        const rows = await db.searchPages(wid, String(query ?? ''))
        if (rows.length === 0) return []
        const full = await db.getPagesByIds(rows.map((r) => r.id))
        const byId = new Map(full.map((p) => [p.id, p]))
        return rows.map((r) => byId.get(r.id)).filter((p): p is Page => !!p).map((p) => new NoteImpl(p))
      },

      async list(opts) {
        const wid = await worldId()
        const pages = await db.listPages(wid)
        if (!opts || opts.parent === undefined) return pages.map((p) => new NoteImpl(p))
        const parentId = opts.parent === null ? null : findPage(pages, opts.parent).id
        return childrenOf(pages, parentId).map((p) => new NoteImpl(p))
      },
    }
  }

  class NoteImpl implements Note {
    id!: string
    worldId!: string
    title!: string
    icon!: string | null
    parentId!: string | null
    kind!: Page['kind']
    secret!: boolean
    updatedAt!: string
    path!: string

    constructor(page: Page) {
      this.sync(page)
    }

    private sync(page: Page): this {
      this.id = page.id
      this.worldId = page.project_id
      this.title = page.title
      this.icon = page.icon
      this.parentId = page.parent_id
      this.kind = page.kind
      this.secret = page.is_secret
      this.updatedAt = page.updated_at
      this.path = `/project/${page.project_id}/page/${page.id}`
      return this
    }

    private async fresh(): Promise<Page> {
      const [row] = await db.getPagesByIds([this.id])
      if (!row) throw new Error(`${quote(this.title)} no longer exists (or is hidden from you)`)
      return row
    }

    async refresh(): Promise<Note> {
      return this.sync(await this.fresh())
    }

    async json(): Promise<JsonNode> {
      const page = await this.fresh()
      this.sync(page)
      return readDoc(page)
    }

    async text(): Promise<string> {
      const page = await this.fresh()
      this.sync(page)
      const pages = await db.listPages(page.project_id)
      return docToMarkdown(readDoc(page), { pageTitle: titleLookup(pages) })
    }

    /** Reads the body, applies `edit`, and saves it the way the editor does. */
    private async editDoc(edit: (doc: JsonNode, pages: Page[]) => JsonNode | null): Promise<Note> {
      const page = await this.fresh()
      if (page.kind !== 'doc') {
        throw new Error(`${quote(page.title)} is a ${page.kind} page; only notes (document pages) have text`)
      }
      const pages = await db.listPages(page.project_id)
      const next = edit(readDoc(page), pages)
      if (!next) return this.sync(page)
      const i = docTabIndex(page)
      let saved: Page
      if (i < 0) {
        // Legacy single doc (tabs = null): what useAutosave's 'doc' save does.
        saved = await write(`edit ${quote(page.title)}`, () => db.updatePage(page.id, { content: next }))
        await write(`save the links of ${quote(page.title)}`, () => db.syncMentions(page.id, [next]))
      } else {
        const tabs: PageTab[] = page.tabs!.map((t, k) => (k === i ? { ...t, content: next } : t))
        // Also mirrors tabs[0] into content and re-syncs mentions across every tab.
        saved = await write(`edit ${quote(page.title)}`, () => db.savePageTabs(page.id, tabs))
      }
      await report({ worldId: saved.project_id, kind: 'content', pageIds: [saved.id], pages: [saved] })
      return this.sync(saved)
    }

    append(markdown: string): Promise<Note> {
      return this.editDoc((doc, pages) => {
        const blocks = markdownToBlocks(String(markdown ?? ''), { resolvePage: pageResolver(pages) })
        if (blocks.length === 0) return null
        return { ...doc, content: [...trimEmpty(doc.content ?? []), ...blocks] }
      })
    }

    prepend(markdown: string): Promise<Note> {
      return this.editDoc((doc, pages) => {
        const blocks = markdownToBlocks(String(markdown ?? ''), { resolvePage: pageResolver(pages) })
        if (blocks.length === 0) return null
        return { ...doc, content: [...blocks, ...trimEmpty(doc.content ?? [])] }
      })
    }

    setText(markdown: string): Promise<Note> {
      return this.editDoc((doc, pages) => ({
        ...doc,
        content: markdownToDoc(String(markdown ?? ''), { resolvePage: pageResolver(pages) }).content,
      }))
    }

    replace(find: string | RegExp, replaceWith: Replacer): Promise<Note> {
      if (typeof find !== 'string' && !(find instanceof RegExp)) {
        throw new Error('replace(find, replaceWith): find must be a string or a RegExp')
      }
      if (find === '') throw new Error('replace(): the text to find is empty')
      return this.editDoc((doc, pages) => {
        // Blocks outside the Markdown subset (images, plugins, callouts…) ride along as placeholders.
        const embeds: JsonNode[] = []
        const md = docToMarkdown(doc, { pageTitle: titleLookup(pages), embeds })
        let out: string
        if (typeof find === 'string') {
          // a string replaces every occurrence, literally (no $-patterns)
          out = typeof replaceWith === 'function'
            ? md.replaceAll(find, (m) => replaceWith(m))
            : md.split(find).join(String(replaceWith))
        } else {
          out = md.replace(find, replaceWith as never)
        }
        if (out === md) return null
        return { ...doc, content: markdownToDoc(out, { resolvePage: pageResolver(pages), embeds }).content }
      })
    }

    private async patch(what: string, attrs: Partial<Page>): Promise<Note> {
      const saved = await write(what, () => db.updatePage(this.id, attrs))
      await report({ worldId: saved.project_id, kind: 'pages', pageIds: [saved.id], pages: [saved] })
      return this.sync(saved)
    }

    rename(title: string): Promise<Note> {
      const clean = String(title ?? '').trim()
      if (!clean) return Promise.reject(new Error('rename(): the new title is empty'))
      return this.patch(`rename ${quote(this.title)}`, { title: clean })
    }

    async move(parent: string | null): Promise<Note> {
      const pages = await db.listPages(this.worldId)
      const target = parent === null || parent === undefined ? null : findPage(pages, parent)
      if (target) {
        // Refuse cycles: the target may not be this page or one of its descendants.
        const byId = new Map(pages.map((p) => [p.id, p]))
        for (let cur: Page | undefined = target, n = 0; cur && n < 1000; cur = cur.parent_id ? byId.get(cur.parent_id) : undefined, n++) {
          if (cur.id === this.id) throw new Error(`Can't move ${quote(this.title)} into itself or one of its subpages`)
        }
      }
      const siblings = childrenOf(pages, target?.id ?? null).filter((p) => p.id !== this.id)
      return this.patch(`move ${quote(this.title)}`, {
        parent_id: target?.id ?? null,
        position: positionBetween(siblings.at(-1)),
      })
    }

    hide(): Promise<Note> {
      return this.patch(`hide ${quote(this.title)}`, { is_secret: true })
    }

    show(): Promise<Note> {
      return this.patch(`show ${quote(this.title)}`, { is_secret: false })
    }

    async duplicate(): Promise<Note> {
      const copies = await write(`duplicate ${quote(this.title)}`, () => db.duplicatePage(this.id))
      await report({ worldId: this.worldId, kind: 'pages', pageIds: copies.map((p) => p.id), pages: copies })
      return new NoteImpl(copies[0])
    }

    async delete(): Promise<void> {
      // deletePage reports success even when RLS silently matched no row: check it is gone.
      await write(`delete ${quote(this.title)}`, () => db.deletePage(this.id))
      const [still] = await db.getPagesByIds([this.id])
      if (still) throw new Error(`Permission denied by the server: you can't delete ${quote(this.title)}`)
      await report({ worldId: this.worldId, kind: 'pages', pageIds: [this.id], pages: [] })
    }
  }

  return {
    world: (nameOrId?: string) => makeWorld(nameOrId),
    worlds: async () => (await db.listProjects()).map((p) => ({ id: p.id, name: p.name })),
    get notes() { return makeWorld(undefined).notes },
    markdown: {
      toJson: (markdown: string) => markdownToDoc(String(markdown ?? '')),
      fromJson: (doc: unknown) => docToMarkdown(doc),
    },
  }
}
