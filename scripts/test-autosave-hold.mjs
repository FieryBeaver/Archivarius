// Tests for the autosave hold rules (src/features/editor/autosaveCore.ts): while the
// "updated by someone else" banner is up, nothing may be written until Reload / Keep mine.
// Run: node scripts/test-autosave-hold.mjs   (Node >= 22.18: .ts type stripping is built in)
import assert from 'node:assert/strict'
import { createAutosaver } from '../src/features/editor/autosaveCore.ts'

let passed = 0
const test = async (name, fn) => { await fn(); passed++; console.log(`ok - ${name}`) }

/** A saver with a manual clock: tick() fires the debounce timer if one is armed. */
function setup() {
  const saved = []
  const statuses = []
  let armed = null
  let n = 0
  const saver = createAutosaver({
    persist: async (p) => { saved.push(p); return `t${++n}` },
    onStatus: (s) => statuses.push(s),
    debounceMs: 800,
    initialSavedAt: 't0',
    setTimer: (fn) => { armed = fn; return fn },
    clearTimer: (h) => { if (armed === h) armed = null },
  })
  const tick = async () => { const fn = armed; armed = null; fn?.(); await saver.settled() }
  return { saver, saved, statuses, tick, armed: () => armed !== null }
}

await test('debounced save writes the latest payload', async () => {
  const { saver, saved, tick } = setup()
  saver.schedule('a')
  saver.schedule('b')
  await tick()
  assert.deepEqual(saved, ['b'])
  assert.equal(saver.getSavedAt(), 't1')
})

await test('hold cancels the pending debounce: nothing is written', async () => {
  const { saver, saved, tick, armed } = setup()
  saver.schedule('mine')
  saver.hold()
  assert.equal(armed(), false)
  await tick()
  assert.deepEqual(saved, [])
  assert.equal(saver.hasPending(), true)
})

await test('typing, flush() (tab switch / structural commit) while held do not write', async () => {
  const { saver, saved, tick, armed, statuses } = setup()
  saver.schedule('mine')
  saver.hold()
  saver.schedule('mine2')
  assert.equal(armed(), false)
  saver.flush()
  await tick()
  assert.deepEqual(saved, [])
  assert.equal(statuses.at(-1), 'held')
})

await test('unmount while held drops the edits instead of writing them', async () => {
  const { saver, saved } = setup()
  saver.schedule('mine')
  saver.hold()
  assert.equal(saver.dispose(), true)
  await saver.settled()
  assert.deepEqual(saved, [])
})

await test('Keep mine: release(true) writes the held edits at once', async () => {
  const { saver, saved } = setup()
  saver.schedule('mine')
  saver.hold()
  saver.schedule('mine2')
  saver.release(true)
  await saver.settled()
  assert.deepEqual(saved, ['mine2'])
  assert.equal(saver.isHeld(), false)
  // Saving works normally afterwards.
  saver.schedule('later')
  saver.flush()
  await saver.settled()
  assert.deepEqual(saved, ['mine2', 'later'])
})

await test('Reload: release(false) discards the held edits; later edits save normally', async () => {
  const { saver, saved, tick, statuses } = setup()
  saver.schedule('mine')
  saver.hold()
  saver.release(false)
  assert.equal(saver.hasPending(), false)
  assert.equal(statuses.at(-1), 'idle')
  await tick()
  assert.deepEqual(saved, [])
  saver.schedule('after reload')
  await tick()
  assert.deepEqual(saved, ['after reload'])
})

await test('pause (remote check in progress) blocks the timer and flush; resume re-arms it', async () => {
  const { saver, saved, tick, armed } = setup()
  saver.schedule('mine')
  saver.pause()
  assert.equal(armed(), false)
  saver.flush()
  saver.schedule('mine2')
  assert.equal(armed(), false)
  await tick()
  assert.deepEqual(saved, [])
  saver.resume()
  assert.equal(armed(), true)
  await tick()
  assert.deepEqual(saved, ['mine2'])
})

await test('back-to-back checks (cleanup resume + new pause) never let a write through', async () => {
  const { saver, saved, tick } = setup()
  saver.schedule('mine')
  saver.pause()
  saver.resume() // cleanup of the superseded check
  saver.pause() // the new check starts in the same commit
  await tick()
  assert.deepEqual(saved, [])
  saver.hold() // the new check found a conflict
  saver.resume()
  await tick()
  assert.deepEqual(saved, [])
})

await test('Keep mine during a running check saves once the check ends', async () => {
  const { saver, saved, tick } = setup()
  saver.schedule('mine')
  saver.hold()
  saver.pause()
  saver.release(true)
  await tick()
  assert.deepEqual(saved, [])
  saver.resume()
  await tick()
  assert.deepEqual(saved, ['mine'])
})

await test('unmount while only paused still saves (edits are not lost)', async () => {
  const { saver, saved } = setup()
  saver.schedule('mine')
  saver.pause()
  assert.equal(saver.dispose(), false)
  await saver.settled()
  assert.deepEqual(saved, ['mine'])
})

console.log(`\n${passed} passed`)
