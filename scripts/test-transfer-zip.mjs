// Tests for the world transfer helpers (src/lib/transferFormat.ts, src/lib/transferZipCore.ts):
// asset collection, old->new remapping, zip guards and version routing.
// Run: node scripts/test-transfer-zip.mjs   (Node >= 22.18: .ts type stripping is built in)
import assert from 'node:assert/strict'
import { strToU8, zipSync } from 'fflate'
import { detectTransferFile, exportVersion, remapDocIds, remapTab } from '../src/lib/transferFormat.ts'
import {
  buildWorldJson, classifyEntry, collectAssets, planImageUploads, readWorldZip, sniffImage, toV2,
  worldJsonProblem, zipWorld, ZipRejected,
} from '../src/lib/transferZipCore.ts'

let passed = 0
const tests = []
const test = (name, fn) => tests.push([name, fn])

// ---------- fixtures ----------

const P = 'proj-old'
const img = (path, extra = {}) => ({ type: 'imageBlock', attrs: { path, width: 100, align: 'center', caption: '', ...extra } })
const doc = (...content) => ({ type: 'doc', content })
const para = (...content) => ({ type: 'paragraph', content })
const mention = (id) => ({ type: 'mention', attrs: { id, label: 'x' } })

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3])
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70])
const SVG = strToU8('<?xml version="1.0"?>\n<!-- made by hand -->\n<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"></svg>')
const JUNK = strToU8('<html><script>alert(1)</script></html>')

const MAP_IMG = `${P}/0b8f2a3e-1111-4222-8333-444455556666-old map.png`
const COVER = `${P}/cover-0b8f2a3e-1111-4222-8333-444455556667-cover.jpg`
const DOC1 = `${P}/images/aaaaaaaa-1111-4222-8333-444455556666.png`
const DOC2 = `${P}/images/bbbbbbbb-1111-4222-8333-444455556666.svg`
const LIB_ONLY = `${P}/images/cccccccc-1111-4222-8333-444455556666.webp`

const pages = [
  { id: 'm1', kind: 'map', title: 'Realm', parent_id: null, position: 0, map_image_path: MAP_IMG, map_w: 800, map_h: 600, content: doc(), tabs: null },
  {
    id: 'd1', kind: 'doc', title: 'Notes', parent_id: null, position: 1, map_image_path: null,
    content: doc(para(mention('m1')), img(DOC1)),
    tabs: [
      { id: 't1', title: 'Main', content: doc(para(mention('m1')), img(DOC1)) },
      // nested image (secret block etc.), plus one used both as map image and in a doc
      { id: 't2', title: 'Lore', content: doc({ type: 'secretBlock', content: [img(DOC2), img(MAP_IMG)] }) },
      { id: 't3', title: 'Map', content: doc(), map: { mapPageId: 'm1' } },
      { id: 't4', title: 'Elsewhere', content: doc(), map: { mapPageId: 'gone' } },
      { id: 't5', title: 'Dice', content: doc(), plugin: { pluginId: 'plug-old', data: { imageBlock: { path: 'no' } } } },
      // plugin data is opaque: an imageBlock-looking object inside it is not an image
      { id: 't6', title: 'P', content: doc({ type: 'pluginBlock', attrs: { pluginId: 'plug-old', data: img('ignored/x.png') } }) },
      // unsafe / foreign paths are never fetched
      { id: 't7', title: 'Bad', content: doc(img('../etc/passwd'), img('https://evil.example/x.png'), img('')) },
    ],
  },
]
const events = [{ id: 'e1', timeline_page_id: 'd1', content: doc(img(`${P}/images/dddddddd-1111-4222-8333-444455556666.gif`)) }]
const library = [DOC1, LIB_ONLY, DOC2]

const baseExport = {
  format: 'archivarius-export', version: 2, project: { name: 'Old world', theme: null },
  pages, mentions: [], pins: [], regions: [], events, plugins: [],
}

// ---------- asset collection ----------

test('collectAssets: cover, map, doc (all tabs + events), library; deduped; unsafe skipped', () => {
  const assets = collectAssets({ pages, events, coverPath: COVER, libraryPaths: library })
  assert.deepEqual(assets.map((a) => [a.originalPath, a.kind]), [
    [COVER, 'cover'],
    [MAP_IMG, 'map'],
    [DOC1, 'doc'],
    [DOC2, 'doc'],
    [`${P}/images/dddddddd-1111-4222-8333-444455556666.gif`, 'doc'],
    [LIB_ONLY, 'library'],
  ])
  const archive = assets.map((a) => a.archivePath)
  assert.equal(new Set(archive).size, archive.length, 'archive paths unique')
  assert.ok(archive.every((p) => p.startsWith('images/') && !p.includes('..')))
  assert.equal(assets[0].archivePath, 'images/0001-cover.jpg', 'uuid/cover prefixes stripped')
  assert.equal(assets[1].archivePath, 'images/0002-old_map.png')
  assert.equal(assets[1].contentType, 'image/png')
  assert.equal(assets[2].archivePath, 'images/0003-aaaaaaaa-1111-4222-8333-444455556666.png', 'bare uuid name kept')
  assert.equal(assets[3].contentType, 'image/svg+xml')
})

test('collectAssets: no cover / no library / map pages without image', () => {
  const assets = collectAssets({ pages: [{ kind: 'map', map_image_path: null, content: null, tabs: null }] })
  assert.deepEqual(assets, [])
})

test('buildWorldJson: version 3, cover kept only when its image is included', () => {
  const assets = collectAssets({ pages, events, coverPath: COVER })
  const w = buildWorldJson(baseExport, COVER, assets)
  assert.equal(w.version, 3)
  assert.equal(w.format, 'archivarius-export')
  assert.equal(w.project.cover_path, COVER)
  assert.equal(w.assets.length, assets.length)
  const w2 = buildWorldJson(baseExport, COVER, assets.filter((a) => a.kind !== 'cover'))
  assert.equal(w2.project.cover_path, null)
})

// ---------- remapping ----------

test('remapTab / remapDocIds: page ids, plugin ids, image paths; map tab mapPageId preserved', () => {
  const idMap = new Map([['m1', 'm1-new'], ['d1', 'd1-new']])
  const pluginMap = new Map([['plug-old', 'plug-new']])
  const imagePaths = new Map([[MAP_IMG, 'proj-new/map.png'], [DOC1, 'proj-new/images/1.png'], [DOC2, 'proj-new/images/2.svg']])
  const tabs = pages[1].tabs.map((t) => remapTab(t, idMap, pluginMap, imagePaths))

  assert.deepEqual(tabs[0].content.content[0].content[0].attrs, { id: 'm1-new', label: 'x' })
  assert.deepEqual(tabs[0].content.content[1].attrs, { path: 'proj-new/images/1.png', width: 100, align: 'center', caption: '' })
  assert.equal(tabs[1].content.content[0].content[0].attrs.path, 'proj-new/images/2.svg')
  assert.equal(tabs[1].content.content[0].content[1].attrs.path, 'proj-new/map.png', 'map image used in a doc follows too')
  assert.deepEqual(tabs[2].map, { mapPageId: 'm1-new' }, 'map tab points at the imported map')
  assert.deepEqual(tabs[3].map, { mapPageId: 'gone' }, 'unknown map page keeps its id')
  assert.equal(tabs[4].plugin.pluginId, 'plug-new')
  assert.deepEqual(tabs[4].plugin.data, { imageBlock: { path: 'no' } }, 'plugin tab data untouched')
  assert.equal(tabs[5].content.content[0].attrs.pluginId, 'plug-new')
  assert.equal(tabs[5].content.content[0].attrs.data.attrs.path, 'ignored/x.png', 'pluginBlock data untouched')
  assert.equal(tabs[6].content.content[0].attrs.path, '../etc/passwd', 'unknown paths left as-is')
  // input not mutated
  assert.equal(pages[1].tabs[0].content.content[1].attrs.path, DOC1)
  assert.deepEqual(pages[1].tabs[2].map, { mapPageId: 'm1' })
})

test('remapDocIds without imagePaths (v2 JSON import) leaves image paths alone', () => {
  const out = remapDocIds(doc(img(DOC1)), new Map(), new Map())
  assert.equal(out.content[0].attrs.path, DOC1)
})

// ---------- zip round trip ----------

async function makeExportZip({ cover = true, files } = {}) {
  const assets = collectAssets({ pages, events, coverPath: cover ? COVER : null, libraryPaths: library })
  const bytesFor = { [COVER]: JPG, [MAP_IMG]: PNG, [DOC1]: PNG, [DOC2]: SVG, [LIB_ONLY]: JUNK }
  const map = new Map()
  for (const a of assets) if (bytesFor[a.originalPath]) map.set(a.archivePath, bytesFor[a.originalPath])
  const included = assets.filter((a) => map.has(a.archivePath) || a.originalPath.endsWith('.gif'))
  const world = buildWorldJson(baseExport, cover ? COVER : null, included)
  return { zip: await zipWorld(world, files ?? map), world }
}

test('zip round trip: world.json + images, sniffed types, skipped junk/missing with warnings', async () => {
  const { zip } = await makeExportZip()
  assert.equal(detectTransferFile(zip.subarray(0, 4)), 'zip')
  const read = await readWorldZip(zip)
  assert.equal(read.world.version, 3)
  assert.equal(read.world.pages.length, 2)
  const { uploads, warnings } = planImageUploads(read)
  assert.deepEqual(uploads.map((u) => [u.asset.originalPath, u.asset.kind, u.contentType, u.fileName]), [
    [COVER, 'cover', 'image/jpeg', 'cover.jpg'],
    [MAP_IMG, 'map', 'image/png', 'old_map.png'],
    [DOC1, 'doc', 'image/png', 'aaaaaaaa-1111-4222-8333-444455556666.png'],
    [DOC2, 'doc', 'image/svg+xml', 'bbbbbbbb-1111-4222-8333-444455556666.svg'],
  ])
  assert.equal(warnings.length, 2)
  assert.match(warnings.join('\n'), /dddddddd.*missing/)
  assert.match(warnings.join('\n'), /cccccccc.*not a recognised image/)
  const v2 = toV2(read.world)
  assert.equal(exportVersion(v2), 2)
  assert.equal('assets' in v2, false)
  assert.deepEqual(v2.project, { name: 'Old world', theme: null })
})

test('sniffImage: magic bytes, svg text, junk refused', () => {
  assert.equal(sniffImage(PNG), 'image/png')
  assert.equal(sniffImage(JPG), 'image/jpeg')
  assert.equal(sniffImage(strToU8('GIF89a....')), 'image/gif')
  assert.equal(sniffImage(new Uint8Array([...strToU8('RIFF'), 0, 0, 0, 0, ...strToU8('WEBPVP8 ')])), 'image/webp')
  assert.equal(sniffImage(new Uint8Array([0, 0, 0, 28, ...strToU8('ftypavif')])), 'image/avif')
  assert.equal(sniffImage(SVG), 'image/svg+xml')
  assert.equal(sniffImage(strToU8('<svg xmlns="http://www.w3.org/2000/svg"/>')), 'image/svg+xml')
  assert.equal(sniffImage(JUNK), null)
  assert.equal(sniffImage(strToU8('{"format":"archivarius-export"}')), null)
  assert.equal(sniffImage(new Uint8Array()), null)
})

// ---------- guards ----------

const LIMITS = { maxTotalBytes: 64 * 1024, maxEntries: 10, maxImageBytes: 16 * 1024 }
const worldBytes = (w = buildWorldJson(baseExport, null, [])) => strToU8(JSON.stringify(w))
const rejects = (p, re) => assert.rejects(p, (e) => e instanceof ZipRejected && re.test(e.message))

test('guard: file larger than the cap', async () => {
  const z = zipSync({ 'world.json': worldBytes(), 'images/a.png': [new Uint8Array(70 * 1024).fill(7), { level: 0 }] })
  await rejects(readWorldZip(z, LIMITS), /larger than/)
})

test('guard: uncompressed total over the cap (zip bomb)', async () => {
  // 4 x 16 KB of zeros deflate to almost nothing, but unpack past 64 KB
  const files = { 'world.json': worldBytes() }
  for (let i = 0; i < 5; i++) files[`images/${i}.png`] = new Uint8Array(16 * 1024)
  const z = zipSync(files, { level: 9 })
  assert.ok(z.length < 4096)
  await rejects(readWorldZip(z, LIMITS), /unpacks to more than/)
})

test('guard: entry count cap (ignored entries count too)', async () => {
  const files = { 'world.json': worldBytes() }
  for (let i = 0; i < 12; i++) files[`junk/${i}.txt`] = strToU8('x')
  await rejects(readWorldZip(zipSync(files), LIMITS), /more than 10 files/)
})

test('guard: path traversal / absolute names refuse the archive', async () => {
  for (const bad of ['images/../../evil.png', '../world.json', '/etc/passwd', 'images\\..\\x.png', 'C:/x.png']) {
    assert.throws(() => classifyEntry(bad), ZipRejected, bad)
    await rejects(readWorldZip(zipSync({ 'world.json': worldBytes(), [bad]: PNG })), /unsafe path/)
  }
  assert.equal(classifyEntry('world.json'), 'world')
  assert.equal(classifyEntry('images/0001-a.png'), 'image')
  assert.equal(classifyEntry('images/'), 'ignore')
  assert.equal(classifyEntry('__MACOSX/._world.json'), 'ignore')
  assert.equal(classifyEntry('notes/readme.txt'), 'ignore')
})

test('guard: an entry lying about its size cannot inflate past its declared size', async () => {
  const big = new Uint8Array(2 * 1024 * 1024).fill(1)
  const z = zipSync({ 'world.json': worldBytes(), 'images/bomb.png': big }, { level: 9 })
  // patch the central-directory uncompressed size of images/bomb.png to 1000 bytes
  const dv = new DataView(z.buffer, z.byteOffset, z.byteLength)
  let patched = false
  for (let i = 0; i < z.length - 46; i++) {
    if (dv.getUint32(i, true) !== 0x02014b50) continue
    const nameLen = dv.getUint16(i + 28, true)
    const name = new TextDecoder().decode(z.subarray(i + 46, i + 46 + nameLen))
    if (name === 'images/bomb.png') { dv.setUint32(i + 24, 1000, true); patched = true }
  }
  assert.ok(patched)
  const read = await readWorldZip(z).catch((e) => e)
  // either refused as corrupt, or extracted bounded by the declared size — never 2 MB
  if (read instanceof Error) return
  assert.ok((read.images.get('images/bomb.png')?.length ?? 0) <= 1000)
})

test('guard: oversize single image is skipped (not inflated) with a warning', async () => {
  const assets = [{ archivePath: 'images/0001-huge.png', originalPath: `${P}/images/huge.png`, kind: 'doc', contentType: 'image/png' }]
  const huge = new Uint8Array(20 * 1024); huge.set(PNG)
  const z = zipSync({ 'world.json': worldBytes(buildWorldJson(baseExport, null, assets)), 'images/0001-huge.png': huge })
  const read = await readWorldZip(z, { ...LIMITS, maxTotalBytes: 1024 * 1024 })
  assert.equal(read.images.has('images/0001-huge.png'), false)
  const plan = planImageUploads(read, LIMITS)
  assert.equal(plan.uploads.length, 0)
  assert.match(plan.warnings[0], /huge\.png: missing from the archive \(or larger than the image limit\)/)
})

// ---------- version routing ----------

test('routing: detectTransferFile by content', () => {
  assert.equal(detectTransferFile(strToU8('PK\x03\x04')), 'zip')
  assert.equal(detectTransferFile(strToU8('PK\x05\x06')), 'zip')
  assert.equal(detectTransferFile(strToU8('{"format"')), 'json')
  assert.equal(detectTransferFile(new Uint8Array()), 'json')
})

test('routing: exportVersion v1 / v2 / v3 / unknown', () => {
  assert.equal(exportVersion({ format: 'worldkeeper-export', version: 1 }), 1)
  assert.equal(exportVersion({ format: 'archivarius-export', version: 2 }), 2)
  assert.equal(exportVersion({ format: 'archivarius-export', version: 3 }), 3)
  assert.equal(exportVersion({ format: 'archivarius-export', version: 4 }), null)
  assert.equal(exportVersion({ format: 'other', version: 2 }), null)
  assert.equal(exportVersion(null), null)
})

test('routing: only version 3 is accepted inside a zip', async () => {
  assert.equal(worldJsonProblem(buildWorldJson(baseExport, null, [])), null)
  assert.match(worldJsonProblem(baseExport), /Unsupported export version \(2\) inside a \.zip/)
  assert.match(worldJsonProblem({ format: 'archivarius-export', version: 9, pages: [] }), /Unsupported export version \(9\)/)
  assert.match(worldJsonProblem({ format: 'nope' }), /not an Archivarius export/)
  assert.match(worldJsonProblem({ format: 'archivarius-export', version: 3, pages: [] }), /no image list/)
  await rejects(readWorldZip(zipSync({ 'world.json': strToU8(JSON.stringify(baseExport)) })), /version \(2\)/)
  await rejects(readWorldZip(zipSync({ 'world.json': strToU8(JSON.stringify({ format: 'archivarius-export', version: 4, pages: [], assets: [] })) })), /version \(4\)/)
  await rejects(readWorldZip(zipSync({ 'images/a.png': PNG })), /no world\.json/)
  await rejects(readWorldZip(zipSync({ 'world.json': strToU8('{nope') })), /not valid JSON/)
  await rejects(readWorldZip(strToU8('PK\x03\x04 definitely not a zip')), /not a readable \.zip/)
})

for (const [name, fn] of tests) {
  try {
    await fn()
    passed++
  } catch (e) {
    console.error(`FAIL ${name}\n`, e)
    process.exitCode = 1
  }
}
console.log(`${passed}/${tests.length} passed`)
