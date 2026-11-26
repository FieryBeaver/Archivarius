// Tests for picker ordering (src/lib/titleRank.ts: exact match, then prefix, then substring)
// and imported-world naming (src/lib/importName.ts).
// Run: node scripts/test-ux-helpers.mjs   (Node >= 22.18: .ts type stripping is built in)
import assert from 'node:assert/strict'
import { uniqueImportName } from '../src/lib/importName.ts'
import { rankByTitle } from '../src/lib/titleRank.ts'

let passed = 0
const test = (name, fn) => { fn(); passed++; console.log(`ok - ${name}`) }
const rank = (titles, q) => rankByTitle(titles, q, (t) => t)

test('exact (case-insensitive) match comes first', () =>
  assert.deepEqual(rank(['Old Town', 'Townsfolk', 'town'], 'Town'), ['town', 'Townsfolk', 'Old Town']))
test('prefix beats word-prefix beats substring', () =>
  assert.deepEqual(rank(['Downtown', 'Old Town', 'Towers'], 'tow'), ['Towers', 'Old Town', 'Downtown']))
test('non-matches are dropped', () => assert.deepEqual(rank(['Alpha', 'Beta'], 'gam'), []))
test('alphabetical within a group', () =>
  assert.deepEqual(rank(['Kingsguard', 'King', 'Kingdom'], 'king'), ['King', 'Kingdom', 'Kingsguard']))
test('empty query keeps everything, alphabetical', () => assert.deepEqual(rank(['b', 'a'], '  '), ['a', 'b']))
test('query whitespace is trimmed', () => assert.deepEqual(rank(['Rivers', 'River'], ' river '), ['River', 'Rivers']))

test('import name: unique name kept', () => assert.equal(uniqueImportName('Eldoria', ['Other']), 'Eldoria'))
test('import name: duplicate gets "(imported)"', () =>
  assert.equal(uniqueImportName('Eldoria', ['eldoria ']), 'Eldoria (imported)'))
test('import name: further duplicates are numbered', () =>
  assert.equal(uniqueImportName('Eldoria', ['Eldoria', 'Eldoria (imported)']), 'Eldoria (imported 2)'))

console.log(`\n${passed} passed`)
