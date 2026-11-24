/**
 * Pure helpers shared by the JSON and .zip world transfer (no Supabase, no fflate), so
 * the main bundle can use them and scripts/test-transfer-zip.mjs can run them in node.
 */
import type { PageTab } from './types'

type IdMap = ReadonlyMap<string, string>

/**
 * Deep-copies TipTap JSON, remapping mention node ids (attrs.id) to new page ids,
 * pluginBlock plugin ids (attrs.pluginId) to new plugin ids and, when `imagePaths`
 * is given, imageBlock storage paths (attrs.path) to the new world's copies. Unknown
 * ids/paths are left as-is (they render as missing). pluginBlock `data` is copied untouched.
 */
export function remapDocIds(
  content: unknown, idMap: IdMap, pluginMap: IdMap, imagePaths?: IdMap,
): unknown {
  if (Array.isArray(content)) return content.map((c) => remapDocIds(c, idMap, pluginMap, imagePaths))
  if (!content || typeof content !== 'object') return content
  const node = content as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node)) {
    // never walk into plugin data: it is opaque user JSON, not TipTap
    out[k] = node.type === 'pluginBlock' && k === 'attrs' ? v : remapDocIds(v, idMap, pluginMap, imagePaths)
  }
  if (node.type === 'mention' && out.attrs && typeof out.attrs === 'object') {
    const attrs = out.attrs as Record<string, unknown>
    if (typeof attrs.id === 'string' && idMap.has(attrs.id)) out.attrs = { ...attrs, id: idMap.get(attrs.id) }
  }
  if (node.type === 'pluginBlock' && out.attrs && typeof out.attrs === 'object') {
    const attrs = out.attrs as Record<string, unknown>
    if (typeof attrs.pluginId === 'string' && pluginMap.has(attrs.pluginId)) {
      out.attrs = { ...attrs, pluginId: pluginMap.get(attrs.pluginId) }
    }
  }
  if (imagePaths && node.type === 'imageBlock' && out.attrs && typeof out.attrs === 'object') {
    const attrs = out.attrs as Record<string, unknown>
    if (typeof attrs.path === 'string' && imagePaths.has(attrs.path)) {
      out.attrs = { ...attrs, path: imagePaths.get(attrs.path) }
    }
  }
  return out
}

/**
 * One imported tab: content remapped like remapDocIds; plugin tabs point at the
 * re-uploaded plugin (data copied untouched); map tabs point at the imported copy of
 * the map page. A map that wasn't in the export keeps its old id and renders
 * "Map unavailable" (MapTabView checks the project).
 */
export function remapTab(t: PageTab, idMap: IdMap, pluginMap: IdMap, imagePaths?: IdMap): PageTab {
  const tab: PageTab = { ...t, content: remapDocIds(t.content, idMap, pluginMap, imagePaths) }
  if (tab.plugin && typeof tab.plugin === 'object' && typeof tab.plugin.pluginId === 'string') {
    tab.plugin = { ...tab.plugin, pluginId: pluginMap.get(tab.plugin.pluginId) ?? tab.plugin.pluginId }
  }
  if (tab.map && typeof tab.map === 'object' && typeof tab.map.mapPageId === 'string') {
    tab.map = { mapPageId: idMap.get(tab.map.mapPageId) ?? tab.map.mapPageId }
  }
  return tab
}

/** Calls `cb` with the storage path of every imageBlock node in TipTap JSON (one doc or several). */
export function forEachImagePath(content: unknown, cb: (path: string) => void): void {
  if (Array.isArray(content)) { content.forEach((c) => forEachImagePath(c, cb)); return }
  if (!content || typeof content !== 'object') return
  const node = content as { type?: unknown; attrs?: { path?: unknown }; content?: unknown }
  if (node.type === 'imageBlock' && typeof node.attrs?.path === 'string' && node.attrs.path) cb(node.attrs.path)
  if (node.content) forEachImagePath(node.content, cb)
}

/** What kind of world file the user picked, by content (not by extension). */
export type TransferFileKind = 'zip' | 'json'

/** A zip starts with a local file header (PK\3\4) or, when empty, the end record (PK\5\6). */
export function detectTransferFile(head: Uint8Array): TransferFileKind {
  return head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b
    && ((head[2] === 3 && head[3] === 4) || (head[2] === 5 && head[3] === 6))
    ? 'zip' : 'json'
}

/**
 * Which export a parsed JSON object is: 1 (WorldKeeper), 2 (plain JSON export),
 * 3 (`world.json` from a .zip), or null when it isn't an Archivarius export or has a
 * version this app doesn't read.
 */
export function exportVersion(data: unknown): 1 | 2 | 3 | null {
  if (!data || typeof data !== 'object') return null
  const d = data as { format?: unknown; version?: unknown }
  if (d.format === 'worldkeeper-export' && d.version === 1) return 1
  if (d.format === 'archivarius-export' && (d.version === 2 || d.version === 3)) return d.version
  return null
}
