// Tests for src/features/editor/newPageTitle.ts (titles for pages created from the link pickers).
// Run: node scripts/test-new-page-title.mjs   (Node >= 22.18: .ts type stripping is built in)
import assert from 'node:assert/strict'
import { createTitleFor, titleFromText } from '../src/features/editor/newPageTitle.ts'

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed++
  } catch (e) {
    console.error(`FAIL ${name}\n`, e.message)
    process.exitCode = 1
  }
}

test('titleFromText collapses whitespace and trims', () => {
  assert.equal(titleFromText('  Old \n  Town  '), 'Old Town')
})
test('titleFromText: blank → Untitled', () => {
  assert.equal(titleFromText(' \n\t '), 'Untitled')
})
test('titleFromText caps at 80 chars with an ellipsis', () => {
  const t = titleFromText('a'.repeat(200))
  assert.equal(t.length, 80)
  assert.ok(t.endsWith('…'))
})

test('createTitleFor: blank query → no row', () => {
  assert.equal(createTitleFor('', ['A']), null)
  assert.equal(createTitleFor('   ', ['A']), null)
})
test('createTitleFor: no match → trimmed title', () => {
  assert.equal(createTitleFor('  Ravi ', ['Old Town']), 'Ravi')
})
test('createTitleFor: exact match is case-insensitive', () => {
  assert.equal(createTitleFor('old town', ['Old Town']), null)
  assert.equal(createTitleFor('OLD  TOWN', ['Old Town']), null)
})
test('createTitleFor: partial match still offers the row', () => {
  assert.equal(createTitleFor('Old', ['Old Town']), 'Old')
})
test('createTitleFor: blank existing title counts as Untitled', () => {
  assert.equal(createTitleFor('untitled', ['', null]), null)
  assert.equal(createTitleFor('Untitle', ['']), 'Untitle')
})
test('createTitleFor: long query compared after capping', () => {
  const long = 'b'.repeat(120)
  assert.equal(createTitleFor(long, [titleFromText(long)]), null)
  assert.equal(createTitleFor(long, []), titleFromText(long))
})

console.log(`${passed} passed`)
