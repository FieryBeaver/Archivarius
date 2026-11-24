/**
 * World export/import as a .zip carrying images (world.json v3 + images/…). Loaded on
 * demand by the Transfer settings tab (dynamic import), so fflate stays out of the
 * main bundle. Pure parts live in transferZipCore.ts.
 */
import * as db from './db'
import type { Project } from './types'
import {
  buildWorldJson, collectAssets, planImageUploads, toV2, zipWorld,
  type ReadWorldZip,
} from './transferZipCore'

export { readWorldZip, ZipRejected, type ReadWorldZip } from './transferZipCore'

/** (done, total) images. */
export type Progress = (done: number, total: number) => void

const CONCURRENCY = 4

/**
 * Runs `fn` over `items` with a few in flight at once. On the first failure no new
 * items start; it rejects with that error once the in-flight ones have settled (so a
 * cleanup that follows sees every upload that happened).
 */
async function pool<T>(items: T[], fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  let failure: { error: unknown } | null = null
  const worker = async () => {
    while (!failure && next < items.length) {
      try {
        await fn(items[next++])
      } catch (error) {
        failure ??= { error }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker))
  if (failure) throw (failure as { error: unknown }).error
}

const reason = (e: unknown) => (e as Error)?.message || String(e)

export interface ZipExportResult {
  blob: Blob
  pageCount: number
  imageCount: number
  /** Images that couldn't be downloaded (left out of the archive). */
  warnings: string[]
}

/**
 * Exports the world as a zip: the JSON export (what the caller can read) plus every
 * image it references — map images, document images in every tab and timeline event,
 * the cover — and the image library. One failed download is skipped with a warning.
 */
export async function exportWorldZip(projectId: string, onProgress?: Progress): Promise<ZipExportResult> {
  const [base, project] = await Promise.all([db.exportProject(projectId), db.getProject(projectId)])
  const warnings: string[] = []
  let libraryPaths: string[] = []
  try {
    libraryPaths = (await db.listProjectImages(projectId)).map((i) => i.path)
  } catch (e) {
    warnings.push(`Image library couldn’t be listed (${reason(e)}); only images used in pages are included.`)
  }
  const planned = collectAssets({
    pages: base.pages, events: base.events, coverPath: project.cover_path, libraryPaths,
  })

  const files = new Map<string, Uint8Array>()
  let done = 0
  onProgress?.(0, planned.length)
  await pool(planned, async (a) => {
    try {
      files.set(a.archivePath, await db.downloadMapsObject(a.originalPath))
    } catch (e) {
      warnings.push(`${a.originalPath.split('/').pop()} (${a.kind}): ${reason(e)}`)
    }
    onProgress?.(++done, planned.length)
  })

  const assets = planned.filter((a) => files.has(a.archivePath))
  const world = buildWorldJson(base, project.cover_path, assets)
  const bytes = await zipWorld(world, files)
  return {
    blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' }),
    pageCount: base.pages.length,
    imageCount: assets.length,
    warnings,
  }
}

export interface ZipImportResult {
  project: Project
  /** Images that were skipped (missing, oversize, not an image). */
  warnings: string[]
}

/**
 * Creates a new world from a read .zip export: uploads its images into the new world
 * (map / document+library / cover helpers), rewrites map_image_path, imageBlock paths in
 * every tab and event, and the cover to the new copies, then runs the normal import.
 * On any failure the half-built world (rows, uploaded images, plugin sources) is
 * deleted; if that fails too the error names the world to delete by hand.
 */
export async function importWorldZip(read: ReadWorldZip, onProgress?: Progress): Promise<ZipImportResult> {
  const { uploads, warnings } = planImageUploads(read)
  let created: Project | null = null
  const uploaded: string[] = []
  try {
    const project = await db.importProject(toV2(read.world), undefined, {
      prepare: async (p) => {
        created = p
        const imagePaths = new Map<string, string>()
        let done = 0
        onProgress?.(0, uploads.length)
        await pool(uploads, async (u) => {
          const file = new File([u.bytes as Uint8Array<ArrayBuffer>], u.fileName, { type: u.contentType })
          const upload = u.asset.kind === 'map' ? db.uploadMapImage
            : u.asset.kind === 'cover' ? db.uploadCoverImage
              : db.uploadDocImage
          const { path } = await upload(p.id, file)
          uploaded.push(path)
          imagePaths.set(u.asset.originalPath, path)
          onProgress?.(++done, uploads.length)
        })
        const cover = read.world.project?.cover_path
        return { imagePaths, coverPath: (cover && imagePaths.get(cover)) || null }
      },
    })
    return { project, warnings }
  } catch (e) {
    const msg = reason(e)
    const partial = created as Project | null
    if (!partial) throw new Error(`Import failed: ${msg}`)
    try {
      await discardWorld(partial.id, uploaded)
    } catch {
      throw new Error(`Import failed: ${msg}. A partially created world “${partial.name}” was left behind — delete it manually (open it, then Settings → General → Delete world).`)
    }
    throw new Error(`Import failed: ${msg}. Nothing was kept.`)
  }
}

/** Deletes a half-imported world: storage first (needs membership), then the row (cascades). */
async function discardWorld(projectId: string, uploaded: string[]): Promise<void> {
  // `uploaded` is complete (pool waits for in-flight uploads); the listing is a safety net
  const listed = await db.listProjectImages(projectId).then((l) => l.map((i) => i.path), () => [])
  const paths = [...new Set([...uploaded, ...listed])]
  if (paths.length) await db.removeMapsObjects(paths).catch(() => { /* orphaned objects are harmless */ })
  const plugins = await db.listPlugins(projectId).catch(() => [])
  for (const p of plugins) await db.deletePlugin(p).catch(() => { /* row goes with the project */ })
  await db.deleteProject(projectId)
}
