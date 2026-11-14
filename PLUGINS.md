# Writing Archivarius plugins

A plugin is a small interactive widget — a character sheet, a dice roller, an
initiative tracker — that lives inside a page as a block. You write it as
**one self-contained `.html` file**, upload it in **Settings → Plugins**, and
then insert it into any page from the editor's `/` menu. Each block stores
its own data (e.g. one character sheet per NPC page) inside the page document.

A plugin can also fill a whole **page tab** (the tab strip's **+ → Plugin
tab…**). The bridge below is identical; the tab's data is stored on the tab
instead of a block. One plugin can power both without changes.

## The file

- **One `.html` file**, max **256 KB**. Put your CSS in `<style>` and your
  JavaScript in `<script>` inside the same file. Images: inline as `data:` URLs
  or SVG.
- **No external network guarantees.** CDN scripts, web fonts and `fetch()` may
  or may not work and may break at any time. Don't depend on them.
- Only project **owners** can upload, replace or delete plugins. Everyone in
  the project can see plugin blocks; only people who can edit the page can
  change their data.

## The sandbox

Your plugin runs in an iframe with `sandbox="allow-scripts"` and nothing else:

- Scripts run, but the frame has an **opaque (null) origin**.
- No cookies, `localStorage`, `sessionStorage` or IndexedDB (they throw or are
  empty). No access to the app, its DOM, the user's session or the database.
- No popups, no top-level navigation, no form submission, no `alert()`.
- The **only** way to talk to Archivarius is `postMessage` (below). The only
  place to persist anything is the block's `data`.

## The bridge

Every message is a plain object whose `type` starts with `archivarius:`.
Because the frame is origin-less, send with target origin `'*'`:

```js
window.parent.postMessage({ type: 'archivarius:ready' }, '*')
```

### Plugin → host

| Message | Shape | Effect |
|---|---|---|
| ready | `{ type: 'archivarius:ready' }` | "I'm loaded." The host answers with `init`. |
| set-data | `{ type: 'archivarius:set-data', data }` | Replaces this block's stored data. Ignored when the viewer can't edit. Saved with the page by the normal save path. |
| resize | `{ type: 'archivarius:resize', height }` | Sets the block's height in px. Clamped to **40–2400**. |
| open-page | `{ type: 'archivarius:open-page', pageId }` | Opens that page in the preview panel. |

### Host → plugin

| Message | Shape |
|---|---|
| init | `{ type: 'archivarius:init', data, canEdit, role, theme }` |

- `data` — whatever you last sent with `set-data`, or `null` for a fresh block.
- `canEdit` — `boolean`. When `false`, render read-only: hide/disable controls
  and don't send `set-data` (it would be ignored anyway).
- `role` — the viewer's BASE project role: `'owner'`, `'editor'`, `'viewer'`,
  or `null` (older hosts don't send it — treat missing as `'viewer'` when
  gating content). Use it to adapt what you show (e.g. a GM-only panel for
  owners). While a GM uses "player preview", `role` is the previewed role.
  This is a UI hint, not security: anyone in the project can read the block's
  `data`.
- `roleName` — the viewer's custom-role label when the world assigned one
  (e.g. `"Co-GM"`), else `null`. Display only; capabilities always follow
  `role`.
- `theme` — an object of the world's resolved theme colors, keyed by token
  name (e.g. `bg`, `panel`, `panel-2`, `border`, `text`, `muted`, `accent`,
  `accent-2`, `danger`) with CSS color strings as values. See Theming.

The host only accepts messages coming from the block's own iframe, and you
should likewise ignore anything that isn't an object with an `archivarius:`
type:

```js
window.addEventListener('message', (e) => {
  const msg = e.data
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return
  if (!msg.type.startsWith('archivarius:')) return
  if (msg.type === 'archivarius:init') { /* ... */ }
})
```

## Lifecycle

1. **Load.** Register your `message` listener first, then send
   `archivarius:ready`.
2. **Init.** You receive `archivarius:init`. Treat `data === null` as "new
   block" and fill in defaults. `init` may arrive again (e.g. after a remount
   or theme change) — make your handler idempotent: re-render from what it
   gives you.
3. **Render**, applying `theme` and respecting `canEdit`.
4. **Resize.** Measure your content and send `archivarius:resize`; do it again
   whenever your height changes (a `ResizeObserver` on `document.body` handles
   this for you). Avoid `height: 100vh` layouts — they measure the frame, not
   your content, and can feed back into themselves.
5. **Persist.** On every change send `archivarius:set-data` with the **whole**
   state. **Debounce** it (~300 ms) — each call marks the page dirty, and
   typing shouldn't fire one per keystroke.

## Theming

Use the `theme` from `init` for every color so your plugin matches the world's
palette (worlds can customize their colors). The simplest way: copy each
entry into a CSS variable and write your CSS against variables with fallbacks.

```js
function applyTheme(theme) {
  for (const [k, v] of Object.entries(theme || {})) {
    if (typeof v === 'string') document.documentElement.style.setProperty('--' + k.replace(/^--/, ''), v)
  }
}
```

```css
body { background: transparent; color: var(--text, #e7e4dc); }
.card { background: var(--panel, #1d2026); border: 1px solid var(--border, #2e323b); }
button { color: var(--accent, #d4a953); }
```

Keep the page background transparent (or `var(--bg)`) so the block blends in.

## Data limits

- `data` must be **JSON-serializable** (objects, arrays, strings, numbers,
  booleans, `null`). No functions, `Date`s (store ISO strings), `Map`s, or
  binary.
- Keep it **modest** — a few KB, tens at most. It lives inside the page
  document, is loaded with the page and included in project exports. Don't
  store images or large blobs.
- Version your shape (e.g. `{ v: 1, ... }`) so a later version of your plugin
  can migrate old blocks.
- Page links: `open-page` takes a page id. There is no page-picker API, so if
  you want links, store ids a user pastes in.

## Worked example: character sheet

Name, six ability scores with modifiers, an HP tracker with +/- buttons and an
inventory list. Copy into `character-sheet.html` and upload it.

```html
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; background: transparent; }
  body {
    font: 14px/1.4 system-ui, sans-serif; color: var(--text, #e7e4dc);
    padding: 12px;
  }
  .sheet { background: var(--panel, #1d2026); border: 1px solid var(--border, #2e323b);
    border-radius: 8px; padding: 12px; display: grid; gap: 12px; }
  h3 { margin: 0 0 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .08em;
    color: var(--muted, #9a958a); }
  input { font: inherit; color: inherit; background: var(--bg, #16181d);
    border: 1px solid var(--border, #2e323b); border-radius: 6px; padding: 4px 8px; width: 100%; }
  input:focus { outline: none; border-color: var(--accent, #d4a953); }
  input:disabled { opacity: .8; }
  .name { font-size: 18px; font-weight: 600; }
  .abilities { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; }
  .ab { text-align: center; background: var(--panel-2, #23262e); border-radius: 6px; padding: 6px 4px; }
  .ab label { display: block; font-size: 11px; color: var(--muted, #9a958a); }
  .ab input { text-align: center; padding: 2px; }
  .ab .mod { font-size: 12px; color: var(--accent, #d4a953); }
  .hp { display: flex; align-items: center; gap: 8px; }
  .hp .val { font-size: 20px; font-weight: 600; min-width: 80px; text-align: center; }
  .hp input { width: 64px; }
  button { font: inherit; cursor: pointer; color: var(--accent, #d4a953); background: transparent;
    border: 1px solid var(--border, #2e323b); border-radius: 6px; padding: 2px 10px; }
  button:hover { border-color: var(--accent, #d4a953); }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
  li { display: flex; gap: 6px; }
  .add { display: flex; gap: 6px; margin-top: 6px; }
  .readonly button, .readonly .add { display: none; }
  @media (max-width: 420px) { .abilities { grid-template-columns: repeat(3, 1fr); } }
</style>
</head>
<body>
<div class="sheet" id="sheet">
  <input class="name" id="name" placeholder="Character name">
  <section><h3>Abilities</h3><div class="abilities" id="abilities"></div></section>
  <section><h3>Hit points</h3>
    <div class="hp">
      <button id="hpMinus">−</button>
      <span class="val" id="hpVal"></span>
      <button id="hpPlus">+</button>
      <span>max</span><input id="hpMax" type="number" min="1">
    </div>
  </section>
  <section><h3>Inventory</h3>
    <ul id="inv"></ul>
    <div class="add"><input id="newItem" placeholder="Add item…"><button id="addItem">Add</button></div>
  </section>
</div>
<script>
  const ABILITIES = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']
  const DEFAULTS = () => ({
    v: 1, name: '', hp: 10, hpMax: 10, items: [],
    abilities: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
  })
  let state = DEFAULTS()
  let canEdit = false
  const $ = (id) => document.getElementById(id)
  const send = (msg) => window.parent.postMessage(msg, '*')

  // ---- persistence (debounced) ----
  let saveTimer
  function save() {
    if (!canEdit) return
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => send({ type: 'archivarius:set-data', data: state }), 300)
  }

  // ---- theme ----
  function applyTheme(theme) {
    for (const [k, v] of Object.entries(theme || {})) {
      if (typeof v === 'string') document.documentElement.style.setProperty('--' + k.replace(/^--/, ''), v)
    }
  }

  // ---- render ----
  const mod = (score) => { const m = Math.floor((score - 10) / 2); return (m >= 0 ? '+' : '') + m }
  function render() {
    $('sheet').classList.toggle('readonly', !canEdit)
    document.querySelectorAll('input').forEach((i) => { i.disabled = !canEdit })
    $('name').value = state.name
    $('abilities').innerHTML = ''
    for (const a of ABILITIES) {
      const box = document.createElement('div')
      box.className = 'ab'
      box.innerHTML = '<label></label><input type="number" min="1" max="30"><div class="mod"></div>'
      box.querySelector('label').textContent = a
      const input = box.querySelector('input')
      input.value = state.abilities[a]
      input.disabled = !canEdit
      box.querySelector('.mod').textContent = mod(state.abilities[a])
      input.addEventListener('input', () => {
        state.abilities[a] = Number(input.value) || 0
        box.querySelector('.mod').textContent = mod(state.abilities[a])
        save()
      })
      $('abilities').appendChild(box)
    }
    renderHp()
    renderInventory()
  }
  function renderHp() {
    $('hpVal').textContent = state.hp + ' / ' + state.hpMax
    $('hpMax').value = state.hpMax
  }
  function renderInventory() {
    $('inv').innerHTML = ''
    state.items.forEach((item, i) => {
      const li = document.createElement('li')
      const input = document.createElement('input')
      input.value = item
      input.disabled = !canEdit
      input.addEventListener('input', () => { state.items[i] = input.value; save() })
      const del = document.createElement('button')
      del.textContent = '×'
      del.addEventListener('click', () => { state.items.splice(i, 1); renderInventory(); save() })
      li.append(input, del)
      $('inv').appendChild(li)
    })
  }

  // ---- controls ----
  $('name').addEventListener('input', (e) => { state.name = e.target.value; save() })
  $('hpMinus').addEventListener('click', () => { state.hp = Math.max(0, state.hp - 1); renderHp(); save() })
  $('hpPlus').addEventListener('click', () => { state.hp = Math.min(state.hpMax, state.hp + 1); renderHp(); save() })
  $('hpMax').addEventListener('input', (e) => {
    state.hpMax = Math.max(1, Number(e.target.value) || 1)
    state.hp = Math.min(state.hp, state.hpMax)
    renderHp(); save()
  })
  function addItem() {
    const text = $('newItem').value.trim()
    if (!text) return
    state.items.push(text)
    $('newItem').value = ''
    renderInventory(); save()
  }
  $('addItem').addEventListener('click', addItem)
  $('newItem').addEventListener('keydown', (e) => { if (e.key === 'Enter') addItem() })

  // ---- sizing: report our height whenever it changes ----
  new ResizeObserver(() => {
    // measure body, not documentElement.scrollHeight (that never shrinks below the frame height)
    send({ type: 'archivarius:resize', height: Math.ceil(document.body.getBoundingClientRect().height) })
  }).observe(document.body)

  // ---- bridge ----
  window.addEventListener('message', (e) => {
    const msg = e.data
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return
    if (!msg.type.startsWith('archivarius:')) return
    if (msg.type === 'archivarius:init') {
      canEdit = msg.canEdit === true
      applyTheme(msg.theme)
      const d = msg.data
      state = d && typeof d === 'object' && d.v === 1
        ? { ...DEFAULTS(), ...d, abilities: { ...DEFAULTS().abilities, ...d.abilities } }
        : DEFAULTS()
      render()
    }
  })
  send({ type: 'archivarius:ready' })
</script>
</body>
</html>
```

## Checklist

- [ ] One `.html` file under 256 KB, no external dependencies.
- [ ] Listener registered before sending `archivarius:ready`.
- [ ] Incoming messages validated (object, `type` starts with `archivarius:`).
- [ ] `data === null` handled with defaults; `init` handler is idempotent.
- [ ] `canEdit === false` renders read-only.
- [ ] Colors come from `theme`, with fallbacks.
- [ ] `resize` sent on load and whenever height changes.
- [ ] `set-data` debounced, sends the full JSON-serializable state, stays small.
