// Tests for tab reordering (src/features/editor/tabOrder.ts) and the content = tabs[0] mirror.
// Run: node scripts/test-tab-order.mjs   (Node >= 22.18: .ts type stripping is built in)
import assert from 'node:assert/strict'
import { moveTab } from '../src/features/editor/tabOrder.ts'

let passed = 0
const test = (name, fn) => { fn(); passed++; console.log(`ok - ${name}`) }
const ids = (tabs) => tabs.map((t) => t.id).join('')
const EMPTY = { type: 'doc', content: [{ type: 'paragraph' }] }
const tabs = [
  { id: 'a', content: { type: 'doc', text: 'A' } },
  { id: 'b', content: EMPTY, plugin: { pluginId: 'p', data: 1 } },
  { id: 'c', content: { type: 'doc', text: 'C' } },
  { id: 'd', content: EMPTY, map: { mapPageId: 'm' } },
]
// What savePageTabs / patchCache store as pages.content.
const mirror = (t) => t[0].content

test('move right past the next tab', () => assert.equal(ids(moveTab(tabs, 'a', 'b', 'after')), 'bacd'))
test('move left before the previous tab', () => assert.equal(ids(moveTab(tabs, 'c', 'b', 'before')), 'acbd'))
test('drag first to last', () => assert.equal(ids(moveTab(tabs, 'a', 'd', 'after')), 'bcda'))
test('drag last to first', () => assert.equal(ids(moveTab(tabs, 'd', 'a', 'before')), 'dabc'))
test('drag across several tabs leftwards', () => assert.equal(ids(moveTab(tabs, 'd', 'b', 'before')), 'adbc'))
test('no-op moves return the same array', () => {
  assert.equal(moveTab(tabs, 'a', 'a', 'after'), tabs)
  assert.equal(moveTab(tabs, 'a', 'b', 'before'), tabs)
  assert.equal(moveTab(tabs, 'b', 'a', 'after'), tabs)
  assert.equal(moveTab(tabs, 'x', 'a', 'after'), tabs)
  assert.equal(moveTab(tabs, 'a', 'x', 'after'), tabs)
})
test('input untouched, tab objects kept (plugin data, map link, unsaved content)', () => {
  const next = moveTab(tabs, 'c', 'a', 'before')
  assert.equal(ids(tabs), 'abcd')
  assert.equal(next.length, 4)
  for (const t of tabs) assert.equal(next.find((n) => n.id === t.id), t)
})
test('hidden tab keeps its slot relative to visible neighbours', () => {
  // shown strip: a c d (b hidden). "Move right" on a => after c.
  assert.equal(ids(moveTab(tabs, 'a', 'c', 'after')), 'bcad')
})
test('mirror follows the new first tab', () => {
  assert.equal(mirror(moveTab(tabs, 'c', 'a', 'before')).text, 'C')
  assert.deepEqual(mirror(moveTab(tabs, 'a', 'b', 'after')), EMPTY) // plugin tab first: empty doc
  assert.deepEqual(mirror(moveTab(tabs, 'd', 'a', 'before')), EMPTY) // map tab first: empty doc
})

console.log(`\n${passed} passed`)
