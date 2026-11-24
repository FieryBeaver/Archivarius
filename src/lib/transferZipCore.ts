/**
 * The pure half of the .zip world transfer: which images a world uses, the archive
 * layout, building/reading the zip (fflate, async = off the main thread for deflate)
 * and the guards an untrusted archive must pass. No Supabase here — lib/transferZip.ts
 * does the I/O — so scripts/test-transfer-zip.mjs runs this in node.
 *
 * Archive layout: `world.json` (ProjectExportV3) + `images/<nnnn>-<name>`. Anything
 * else in an archive is ignored on import.
 */
import { unzip, zip, type Unzipped, type Zippable } from 'fflate'
import { exportVersion, forEachImagePath } from './transferFormat.ts'
import type { ExportAsset, ExportAssetKind, Page, ProjectExport, ProjectExportV3, WorldEvent } from './types'

export const WORLD_JSON = 'world.json'
export const IMAGES_DIR = 'images/'

/** Import guards (zip bombs / junk archives). */
export interface ZipLimits {
  /** Cap on the summed uncompressed size of the entries we extract (and on the file itself). */
  maxTotalBytes: number
  /** Cap on the number of entries in the archive (all of them, extracted or not). */
  maxEntries: number
  /** Per-image cap — the `maps` bucket refuses bigger objects anyway (db.MAP_IMAGE_MAX_BYTES). */
  maxImageBytes: number
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxTotalBytes: 500 * 1024 * 1024,
  maxEntries: 2000,
  maxImageBytes: 10 * 1024 * 1024,
}

// ---------- export side ----------

const EXT_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp',
}

const TYPE_EXTS: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/svg+xml': 'svg', 'image/avif': 'avif', 'image/bmp': 'bmp',
}

/** Content type guessed from a storage path's extension (the import re-sniffs the bytes). */
export function contentTypeFromPath(path: string): string {
  const ext = /\.([a-z0-9]{1,5})$/i.exec(path)?.[1]?.toLowerCase()
  return (ext && EXT_TYPES[ext]) || 'application/octet-stream'
}

/** A storage path we are willing to fetch: relative, no traversal, no URL. */
export function isStoragePath(path: unknown): path is string {
  return typeof path === 'string' && path.length > 0 && path.length < 1024
    && !path.includes('://') && !path.startsWith('/') && !path.includes('\\')
    && !path.split('/').includes('..')
}

/** File name part of a storage path, minus the uuid / `cover-` prefixes our uploads add. */
export function baseName(path: string): string {
  const last = path.split('/').pop() || 'image'
  const stripped = last
    .replace(/^cover-/, '')
    .replace(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-)+/i, '')
  // `<uuid>.png` (document images) has nothing but the uuid to keep
  const safe = (stripped && !stripped.startsWith('.') ? stripped : last).replace(/[^\w.-]/g, '_').slice(-80)
  return safe.replace(/^\.+/, '') || 'image'
}

interface AssetSources {
  pages: Pick<Page, 'kind' | 'content' | 'tabs' | 'map_image_path'>[]
  events?: Pick<WorldEvent, 'content'>[]
  coverPath?: string | null
  /** Storage paths in the world's image library (`<projectId>/images/…`). */
  libraryPaths?: string[]
}

/**
 * Every image a world uses, once per storage path: the cover, map images, images in
 * documents (every tab of every page, and timeline events), then the library's
 * unused images. A path used several ways keeps its first kind in that order.
 */
export function collectAssets(src: AssetSources): ExportAsset[] {
  const seen = new Map<string, ExportAssetKind>()
  const add = (path: unknown, kind: ExportAssetKind) => {
    if (isStoragePath(path) && !seen.has(path)) seen.set(path, kind)
  }
  add(src.coverPath, 'cover')
  for (const p of src.pages) if (p.kind === 'map') add(p.map_image_path, 'map')
  for (const p of src.pages) {
    forEachImagePath(p.content, (path) => add(path, 'doc'))
    if (Array.isArray(p.tabs)) for (const t of p.tabs) forEachImagePath(t?.content, (path) => add(path, 'doc'))
  }
  for (const e of src.events ?? []) forEachImagePath(e.content, (path) => add(path, 'doc'))
  for (const path of src.libraryPaths ?? []) add(path, 'library')

  return [...seen].map(([originalPath, kind], i) => ({
    archivePath: `${IMAGES_DIR}${String(i + 1).padStart(4, '0')}-${baseName(originalPath)}`,
    originalPath,
    kind,
    contentType: contentTypeFromPath(originalPath),
  }))
}

/** The `world.json` of a .zip export: the v2 payload + cover + the images actually included. */
export function buildWorldJson(
  base: ProjectExport, coverPath: string | null, assets: ExportAsset[],
): ProjectExportV3 {
  const included = new Set(assets.map((a) => a.originalPath))
  return {
    ...base,
    version: 3,
    project: { ...base.project, cover_path: coverPath && included.has(coverPath) ? coverPath : null },
    assets,
  }
}

/** Zips world.json (deflated) + images (stored: they are already compressed). */
export function zipWorld(world: ProjectExportV3, files: ReadonlyMap<string, Uint8Array>): Promise<Uint8Array> {
  const entries: Zippable = {
    [WORLD_JSON]: [new TextEncoder().encode(JSON.stringify(world, null, 2)), { level: 6 }],
  }
  for (const [archivePath, bytes] of files) entries[archivePath] = [bytes, { level: 0 }]
  return new Promise((resolve, reject) => {
    zip(entries, (err, data) => (err ? reject(err) : resolve(data)))
  })
}

// ---------- import side ----------

/** Why an archive was refused (shown to the user as-is). */
export class ZipRejected extends Error {}

/**
 * What to do with an archive entry: the manifest, an image, or skip it. Throws for
 * names that try to escape the archive (`..`, absolute, backslashes) — such an
 * archive is refused as a whole.
 */
export function classifyEntry(name: string): 'world' | 'image' | 'ignore' {
  if (name.startsWith('/') || name.includes('\\') || /^[a-z]:/i.test(name)
    || name.split('/').includes('..') || name.includes('\0')) {
    throw new ZipRejected(`The archive contains an unsafe path (“${name.slice(0, 120)}”) and was refused.`)
  }
  if (name === WORLD_JSON) return 'world'
  if (name.startsWith(IMAGES_DIR) && name.length > IMAGES_DIR.length && !name.endsWith('/')) return 'image'
  return 'ignore'
}

export interface ReadWorldZip {
  world: ProjectExportV3
  /** archivePath → bytes, only entries under images/. */
  images: Map<string, Uint8Array>
}

/**
 * Validates and extracts a .zip export. Refuses: files over maxTotalBytes, more than
 * maxEntries entries, unsafe entry names, extracted content over maxTotalBytes, a
 * missing/invalid world.json, unknown versions.
 *
 * Sizes are checked from the central directory before anything is inflated. fflate
 * inflates every entry into a buffer of exactly its declared size (it never grows a
 * caller-sized buffer), so an entry that lies about its size can't allocate past the cap.
 */
export async function readWorldZip(
  bytes: Uint8Array, limits: ZipLimits = DEFAULT_ZIP_LIMITS,
): Promise<ReadWorldZip> {
  if (bytes.length > limits.maxTotalBytes) {
    throw new ZipRejected(`This archive is larger than ${mb(limits.maxTotalBytes)} and was refused.`)
  }
  let entries = 0
  let total = 0
  let refusal: Error | null = null
  const files = await new Promise<Unzipped>((resolve, reject) => {
    try {
      unzip(bytes, {
        filter: (f) => {
          if (refusal) return false
          try {
            if (++entries > limits.maxEntries) {
              throw new ZipRejected(`This archive has more than ${limits.maxEntries} files and was refused.`)
            }
            const kind = classifyEntry(f.name)
            if (kind === 'ignore') return false
            total += f.originalSize
            if (total > limits.maxTotalBytes) {
              throw new ZipRejected(`This archive unpacks to more than ${mb(limits.maxTotalBytes)} and was refused.`)
            }
            // an oversize image is skipped later with a warning; don't even inflate it
            return kind === 'world' || f.originalSize <= limits.maxImageBytes
          } catch (e) {
            refusal = e as Error
            return false
          }
        },
      }, (err, data) => (err ? reject(err) : resolve(data)))
    } catch (e) {
      reject(e)
    }
  }).catch((e: unknown) => {
    throw refusal ?? new ZipRejected(`This file is not a readable .zip archive (${(e as Error)?.message ?? e}).`)
  })
  if (refusal) throw refusal

  const raw = files[WORLD_JSON]
  if (!raw) throw new ZipRejected('This archive has no world.json — it is not an Archivarius .zip export.')
  let world: unknown
  try {
    world = JSON.parse(new TextDecoder().decode(raw))
  } catch {
    throw new ZipRejected('The world.json in this archive is not valid JSON.')
  }
  const problem = worldJsonProblem(world)
  if (problem) throw new ZipRejected(problem)

  const images = new Map<string, Uint8Array>()
  for (const [name, data] of Object.entries(files)) if (name !== WORLD_JSON) images.set(name, data)
  return { world: world as ProjectExportV3, images }
}

/** Why a parsed world.json can't be imported, or null. Only version 3 lives in a zip. */
export function worldJsonProblem(world: unknown): string | null {
  const version = exportVersion(world)
  const d = (world ?? {}) as { format?: unknown; version?: unknown; pages?: unknown; assets?: unknown }
  if (version === null) {
    return d.format === 'archivarius-export'
      ? `Unsupported export version (${String(d.version)}). This app reads .zip exports of version 3.`
      : 'The world.json in this archive is not an Archivarius export.'
  }
  if (version !== 3) return `Unsupported export version (${version}) inside a .zip. This app reads .zip exports of version 3.`
  if (!Array.isArray(d.pages)) return 'The export is damaged: it has no page list.'
  if (!Array.isArray(d.assets)) return 'The export is damaged: it has no image list.'
  return null
}

/** Real content type from magic bytes; null = not an image we accept. */
export function sniffImage(b: Uint8Array): string | null {
  const at = (i: number, ...xs: number[]) => xs.every((x, j) => b[i + j] === x)
  const ascii = (i: number, s: string) => at(i, ...[...s].map((c) => c.charCodeAt(0)))
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png'
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return 'image/gif'
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp'
  if (ascii(4, 'ftypavif') || ascii(4, 'ftypavis')) return 'image/avif'
  if (ascii(0, 'BM') && b.length > 26) return 'image/bmp'
  // SVG: text whose first element is <svg> (after an optional BOM, XML declaration,
  // comments and doctype). Uploads already accept SVG, so it is re-served as-is.
  const head = new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(0, 4096))
  if (/^﻿?\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head)) {
    return 'image/svg+xml'
  }
  return null
}

/** One image ready to upload into the new world. */
export interface PlannedImage {
  asset: ExportAsset
  bytes: Uint8Array
  contentType: string
  /** File name to upload under (extension matches the sniffed type). */
  fileName: string
}

/**
 * Matches world.json's asset list against the extracted images. Missing, oversize or
 * non-image entries are skipped with a warning (the referencing page keeps the old path,
 * a map loses its image); duplicates of a storage path are uploaded once.
 */
export function planImageUploads(
  read: ReadWorldZip, limits: ZipLimits = DEFAULT_ZIP_LIMITS,
): { uploads: PlannedImage[]; warnings: string[] } {
  const uploads: PlannedImage[] = []
  const warnings: string[] = []
  const seen = new Set<string>()
  for (const a of read.world.assets) {
    if (!a || typeof a !== 'object' || !isStoragePath(a.originalPath) || typeof a.archivePath !== 'string') continue
    if (seen.has(a.originalPath)) continue
    seen.add(a.originalPath)
    const label = baseName(a.originalPath)
    const bytes = read.images.get(a.archivePath)
    if (!bytes) {
      warnings.push(`${label}: missing from the archive${a.archivePath.startsWith(IMAGES_DIR) ? ' (or larger than the image limit)' : ''}`)
      continue
    }
    if (bytes.length > limits.maxImageBytes) {
      warnings.push(`${label}: larger than ${mb(limits.maxImageBytes)}`)
      continue
    }
    const contentType = sniffImage(bytes)
    if (!contentType) {
      warnings.push(`${label}: not a recognised image`)
      continue
    }
    const kind: ExportAssetKind = (['map', 'doc', 'cover', 'library'] as const).includes(a.kind) ? a.kind : 'doc'
    const stem = label.replace(/\.[a-z0-9]{1,5}$/i, '') || 'image'
    uploads.push({ asset: { ...a, kind, contentType }, bytes, contentType, fileName: `${stem}.${TYPE_EXTS[contentType]}` })
  }
  return { uploads, warnings }
}

/** world.json → the v2 shape importProject takes (assets/cover handled by the caller). */
export function toV2(world: ProjectExportV3): ProjectExport {
  const { assets: _assets, version: _version, project, ...rest } = world
  return { ...rest, format: 'archivarius-export', version: 2, project: { name: project?.name, theme: project?.theme ?? null } }
}

function mb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`
}
