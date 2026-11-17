/**
 * Plugin market: fetching and validating provider registries (index.json) and plugin files.
 *
 * Provider contract (see PLUGINS.md → "Plugin market & providers"):
 *   A provider is the URL of an index.json; relative `file` paths inside it resolve against
 *   that URL (new URL(file, indexUrl)).
 *   index.json = { name, description?, homepage?, plugins: [ { slug, name, version, author,
 *   blurb, tags: string[], license, file, bytes, icon? } ] }
 *
 * SECURITY:
 * - Requests are plain anonymous GETs (no credentials, no referrer, no query string, no
 *   user/world data). Providers learn only the viewer's IP and that the catalog was opened.
 * - Everything a provider returns is untrusted data. Strings are rendered as React text only
 *   (never as HTML), icons only through renderIcon's curated gi:* map or as a short emoji.
 * - A plugin file is NEVER executed or rendered by the market UI: its bytes are checked
 *   (size, looks like HTML) and uploaded via db.createPlugin. It runs later exactly like any
 *   uploaded plugin, in the sandboxed iframe (sandbox="allow-scripts", no same-origin).
 */
import { PLUGIN_MAX_BYTES } from '../../lib/db'
import { getIconComponent, isGameIcon } from '../../lib/icons'
import type { ProjectPrefs } from '../../lib/types'

/** The built-in registry (always present, not removable, shown as "Official"). */
export const OFFICIAL_PROVIDER_URL = 'https://cdn.jsdelivr.net/gh/FieryBeaver/Archivarius-Plugins@main/index.json'
/** One-time fallback when the jsDelivr fetch fails (jsDelivr can 403/404 a new repo for a while). */
export const OFFICIAL_PROVIDER_FALLBACK_URL = 'https://raw.githubusercontent.com/FieryBeaver/Archivarius-Plugins/main/index.json'
export const OFFICIAL_REGISTRY_REPO = 'https://github.com/FieryBeaver/Archivarius-Plugins'

/** Custom providers a world can keep (besides Official). */
export const MAX_CUSTOM_PROVIDERS = 10
/** index.json larger than this is refused. */
const INDEX_MAX_BYTES = 1024 * 1024
const MAX_ENTRIES = 500
const FETCH_TIMEOUT_MS = 15000

export interface MarketEntry {
  slug: string
  name: string
  version: string
  author: string
  blurb: string
  tags: string[]
  license: string
  file: string
  /** Declared size; 0 when missing. The real size is enforced after download. */
  bytes: number
  /** A renderable icon string (known gi:* or a short emoji), else null. */
  icon: string | null
}

export interface MarketIndex {
  name: string
  description: string
  /** https only, else ''. */
  homepage: string
  plugins: MarketEntry[]
  /** Entries dropped because they lacked slug/name/file. */
  skipped: number
  /** The URL the index was actually read from — file paths resolve against this. */
  baseUrl: string
}

/* ---------- prefs ---------- */

/** Validates a provider URL string; returns an error message or null. */
export function providerUrlProblem(raw: string): string | null {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return 'That is not a valid URL.'
  }
  if (u.protocol !== 'https:') return 'Provider URLs must start with https://.'
  if (u.username || u.password) return 'Provider URLs cannot contain a username or password.'
  return null
}

function isOfficial(url: string): boolean {
  return url === OFFICIAL_PROVIDER_URL || url === OFFICIAL_PROVIDER_FALLBACK_URL
}

/** The world's custom providers, cleaned (https only, deduped, no Official, capped). */
export function customProviders(prefs: ProjectPrefs | null | undefined): string[] {
  const raw = prefs?.pluginProviders
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const v of raw) {
    if (typeof v !== 'string') continue
    const url = v.trim()
    if (!url || providerUrlProblem(url) || isOfficial(url) || out.includes(url)) continue
    out.push(url)
    if (out.length >= MAX_CUSTOM_PROVIDERS) break
  }
  return out
}

/* ---------- fetching ---------- */

async function getText(url: string, maxBytes: number, what: string): Promise<{ text: string; url: string }> {
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  let res: Response
  try {
    // Plain anonymous GET: no cookies/credentials, no referrer, nothing about the user or world.
    res = await fetch(url, {
      method: 'GET',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-cache',
      redirect: 'follow',
      signal: ctrl.signal,
    })
  } catch (e) {
    window.clearTimeout(timer)
    if ((e as Error)?.name === 'AbortError') throw new Error(`The ${what} did not respond in time.`)
    throw new Error(`Could not reach the ${what}. Check the URL and that it allows cross-origin requests (CORS).`)
  }
  try {
    if (!res.ok) throw new Error(`The ${what} answered ${res.status}${res.statusText ? ` ${res.statusText}` : ''}.`)
    const declared = Number(res.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > maxBytes) throw new Error(tooLarge(what, declared, maxBytes))
    const buf = await res.arrayBuffer()
    if (buf.byteLength > maxBytes) throw new Error(tooLarge(what, buf.byteLength, maxBytes))
    return { text: new TextDecoder('utf-8').decode(buf), url: res.url || url }
  } finally {
    window.clearTimeout(timer)
  }
}

function tooLarge(what: string, bytes: number, max: number): string {
  return `The ${what} is too large (${Math.ceil(bytes / 1024)} KB; the limit is ${max / 1024} KB).`
}

const str = (v: unknown, max = 200): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

function safeIcon(v: unknown): string | null {
  const s = str(v, 64)
  if (!s) return null
  if (isGameIcon(s)) return getIconComponent(s) ? s : null
  // A short emoji/glyph only; anything longer is ignored.
  return [...s].length <= 4 && !/[<>&"'\s]/.test(s) ? s : null
}

/** Parses and validates index.json text. Throws a user-facing message on an invalid index. */
export function parseIndex(text: string, baseUrl: string): MarketIndex {
  let json: unknown
  try {
    json = JSON.parse(text.replace(/^﻿/, ''))
  } catch {
    throw new Error('The provider did not return a valid index.json (not JSON).')
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('The provider’s index.json is not an object.')
  }
  const o = json as Record<string, unknown>
  if (!Array.isArray(o.plugins)) throw new Error('The provider’s index.json has no "plugins" array.')
  const plugins: MarketEntry[] = []
  const slugs = new Set<string>()
  let skipped = 0
  for (const raw of o.plugins.slice(0, MAX_ENTRIES)) {
    const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const slug = str(p.slug, 100)
    const name = str(p.name, 80)
    const file = str(p.file, 500)
    if (!slug || !name || !file || slugs.has(slug)) { skipped++; continue }
    slugs.add(slug)
    const bytes = Number(p.bytes)
    plugins.push({
      slug,
      name,
      file,
      version: str(p.version, 40),
      author: str(p.author, 100),
      blurb: str(p.blurb, 400),
      license: str(p.license, 60),
      tags: Array.isArray(p.tags) ? p.tags.map((t) => str(t, 30)).filter(Boolean).slice(0, 12) : [],
      bytes: Number.isFinite(bytes) && bytes > 0 ? bytes : 0,
      icon: safeIcon(p.icon),
    })
  }
  skipped += Math.max(0, o.plugins.length - MAX_ENTRIES)
  const homepage = str(o.homepage, 500)
  let host = ''
  try { host = new URL(baseUrl).host } catch { /* keep '' */ }
  return {
    name: str(o.name, 80) || host || 'Unnamed provider',
    description: str(o.description, 400),
    homepage: /^https:\/\//i.test(homepage) ? homepage : '',
    plugins,
    skipped,
    baseUrl,
  }
}

async function fetchIndexFrom(url: string): Promise<MarketIndex> {
  const { text, url: finalUrl } = await getText(url, INDEX_MAX_BYTES, 'provider')
  return parseIndex(text, finalUrl)
}

/** Session cache: provider URL → index (or the in-flight request). */
const indexCache = new Map<string, Promise<MarketIndex>>()

/**
 * Loads a provider's index, cached per session. `refresh` drops the cached copy first.
 * Official: jsDelivr first, then raw.githubusercontent.com once if that fails for any reason.
 * Failures are not cached, so the next call retries.
 */
export function loadIndex(providerUrl: string, refresh = false): Promise<MarketIndex> {
  if (refresh) indexCache.delete(providerUrl)
  const cached = indexCache.get(providerUrl)
  if (cached) return cached
  const p = (async () => {
    if (providerUrl !== OFFICIAL_PROVIDER_URL) return fetchIndexFrom(providerUrl)
    try {
      return await fetchIndexFrom(OFFICIAL_PROVIDER_URL)
    } catch (first) {
      try {
        return await fetchIndexFrom(OFFICIAL_PROVIDER_FALLBACK_URL)
      } catch {
        throw first
      }
    }
  })()
  indexCache.set(providerUrl, p)
  p.catch(() => { if (indexCache.get(providerUrl) === p) indexCache.delete(providerUrl) })
  return p
}

/** Seeds the cache (used after validating a newly added provider). */
export function primeIndex(providerUrl: string, index: MarketIndex): void {
  indexCache.set(providerUrl, Promise.resolve(index))
}

/** Validates a candidate provider: https URL whose index parses. Uncached. */
export async function probeProvider(url: string): Promise<MarketIndex> {
  const problem = providerUrlProblem(url)
  if (problem) throw new Error(problem)
  return fetchIndexFrom(url.trim())
}

/* ---------- plugin files ---------- */

function looksLikeHtml(text: string): boolean {
  if (text.includes('\u0000')) return false
  const head = text.replace(/^﻿/, '').trimStart().slice(0, 4096)
  if (!head.startsWith('<')) return false
  return /<(!doctype\s+html|html|head|body|meta|title|style|script|div|main)\b/i.test(head)
}

/**
 * Downloads a plugin's HTML (resolved against the index URL) and returns it as a File ready for
 * db.createPlugin. Only checks and wraps the bytes — the HTML is never parsed into the DOM or run.
 */
export async function downloadPlugin(index: MarketIndex, entry: MarketEntry): Promise<File> {
  if (entry.bytes > PLUGIN_MAX_BYTES) throw new Error(oversize(entry.name, entry.bytes))
  let url: URL
  try {
    url = new URL(entry.file, index.baseUrl)
  } catch {
    throw new Error(`“${entry.name}” has an invalid file path.`)
  }
  if (url.protocol !== 'https:') throw new Error(`“${entry.name}” is not served over https.`)
  let text: string
  try {
    ;({ text } = await getText(url.href, PLUGIN_MAX_BYTES, 'plugin file'))
  } catch (e) {
    const msg = (e as Error)?.message ?? ''
    throw new Error(msg.includes('too large') ? oversize(entry.name, PLUGIN_MAX_BYTES + 1) : `${entry.name}: ${msg}`)
  }
  if (!text.trim()) throw new Error(`“${entry.name}” is empty.`)
  if (!looksLikeHtml(text)) throw new Error(`“${entry.name}” does not look like an HTML file.`)
  const fileName = `${entry.slug.replace(/[^a-z0-9._-]+/gi, '-') || 'plugin'}.html`
  return new File([text], fileName, { type: 'text/html' })
}

function oversize(name: string, bytes: number): string {
  return `“${name}” is larger than the ${PLUGIN_MAX_BYTES / 1024} KB plugin limit${bytes > PLUGIN_MAX_BYTES + 1 ? ` (${Math.ceil(bytes / 1024)} KB)` : ''}.`
}
