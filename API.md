# Archivarius scripting API (`window.archivarius`)

A small JavaScript API for creating and editing notes without clicking through the UI —
from the browser DevTools console, a bookmarklet, or your own scripts running in the app tab.

It does exactly what the editor does: the same database calls, the same permissions
(the server's row-level security decides what you may change), `[[links]]` become real
page links with backlinks, and other members see your changes live.

## Quick start

1. Open your instance (e.g. `http://localhost:5173`), sign in and open a world.
2. Open DevTools (F12) → **Console**.
3. Try:

```js
const n = await archivarius.notes.create({ title: 'Ravenholm', text: 'A **grim** town near [[Old Town]].' })
await n.append('- population: 300\n- ruler: none')
console.log(await n.text())
```

The sidebar and the open page update immediately.

`archivarius` exists while you are signed in (it is removed on sign-out).
`archivarius.notes` always targets the world that is open in the app; use
`archivarius.world('Other world')` to work on another world you have access to.

## Reference

Every method is `async` — use `await`. Every failure throws an `Error` with a readable
message (`No page titled 'X' in this world`, `Permission denied by the server: you can't rename 'X'`, …).
Pages are addressed by **id or exact title** (case-insensitive if no exact match; if two
pages share a title you'll be asked to use the id).

### Worlds

| Call | Example |
| --- | --- |
| `archivarius.worlds()` → `[{ id, name }]` | `await archivarius.worlds()` |
| `archivarius.world(nameOrId?)` → World (no argument = the open world) | `const w = archivarius.world('Eldoria')` |
| `world.id()` / `world.info()` | `await w.info()` → `{ id, name }` |
| `world.notes` — the note functions below, for that world | `await w.notes.list()` |
| `archivarius.notes` — shortcut for `archivarius.world().notes` | `await archivarius.notes.find('raven')` |

### Finding and creating notes

| Call | Example |
| --- | --- |
| `notes.create({ title, text?, parent?, icon?, secret? })` → Note | `await archivarius.notes.create({ title: 'Ravenholm', parent: 'Old Town', icon: '🏰', text: '# Ravenholm' })` |
| `notes.get(idOrTitle)` → Note | `const n = await archivarius.notes.get('Ravenholm')` |
| `notes.find(query)` → Note[] (title contains, up to 10) | `await archivarius.notes.find('raven')` |
| `notes.list({ parent? })` → Note[] (all pages; or children of `parent`; `parent: null` = top level) | `await archivarius.notes.list({ parent: 'Old Town' })` |

`parent` takes a page id or title. New notes go at the end of their parent's list.

### A note

Properties (a snapshot, refreshed by every method call): `id`, `title`, `icon`, `parentId`,
`kind` (`'doc'`, `'map'`, `'timeline'`), `secret`, `updatedAt`, `worldId`, `path`
(the app path, e.g. `location.assign(n.path)` opens it).

| Method | Example |
| --- | --- |
| `text()` → the body as Markdown | `await n.text()` |
| `json()` → the body as the editor's ProseMirror JSON | `await n.json()` |
| `append(markdown)` — add blocks at the end | `await n.append('New paragraph with [[Old Town]].')` |
| `prepend(markdown)` — add blocks at the start | `await n.prepend('> Draft — do not share')` |
| `setText(markdown)` — replace the whole body | `await n.setText('# Ravenholm\n\nRewritten.')` |
| `replace(find, replaceWith)` — on the Markdown text; a string replaces **every** occurrence, a RegExp follows its own flags | `await n.replace('grim', 'cheerful')`, `await n.replace(/\d+ souls/g, 'many souls')` |
| `rename(title)` | `await n.rename('Ravenholm Ruins')` |
| `move(parentIdOrTitle \| null)` — `null` = top level | `await n.move('Old Town')` |
| `hide()` / `show()` — set / clear the secret flag | `await n.hide()` |
| `delete()` — deletes the page **and every page under it** | `await n.delete()` |
| `refresh()` — re-read title, parent, flags | `await n.refresh()` |

Methods that change something return the note, so you can chain with `await`:
`await (await n.rename('X')).move(null)`.

Notes about the body:

- Pages with tabs: the API reads and writes the **first document tab** (plugin tabs are
  skipped and left untouched).
- Only document pages have text; map and timeline pages can be listed, renamed, moved,
  hidden and deleted, but text writes throw.
- `replace()` works on the Markdown rendering and saves the result back. Images, plugin
  blocks, callouts and secret blocks are kept as they are (their own text is not searched).
  Formatting outside the supported subset (underline, alignment, …) in the rest of the
  note is dropped by a `replace()`. If nothing matches, the note is not touched.
- `setText()` replaces everything, including images and plugin blocks.

### Markdown helpers

| Call | Example |
| --- | --- |
| `archivarius.markdown.toJson(markdown)` → editor JSON (`[[links]]` are not resolved here) | `archivarius.markdown.toJson('**hi**')` |
| `archivarius.markdown.fromJson(json)` → Markdown | `archivarius.markdown.fromJson(await n.json())` |

## Supported Markdown

| Markdown | Becomes |
| --- | --- |
| blank line between paragraphs; a single newline | paragraphs; a line break inside a paragraph |
| `# H1`, `## H2`, `### H3` (up to `######`) | headings |
| `**bold**`, `*italic*` or `_italic_`, `~~strike~~`, `` `code` `` | inline formatting |
| `- item` / `* item` / `+ item`, `1. item` (indent to nest) | bullet / numbered lists |
| `> quote` | quote block |
| ```` ``` ```` fenced code, `---` | code block, divider |
| `[text](https://…)` | a link — only `http:`, `https:` and `mailto:` (others keep just the text) |
| `[[Page Title]]` | a page link (mention) with a backlink, when that page exists in the world; otherwise the literal text `[[Page Title]]` stays, so nothing is ever a broken link |

Use `\` to type a literal character (`\*not italic\*`, `\# not a heading`).
`text()` writes italics as `_italic_`, images as `![image]` and plugin blocks as `![plugin]`;
the content of callouts and secret blocks appears as plain paragraphs.

## Bookmarklet

Create a bookmark with this as its URL. Clicking it while your Archivarius tab is open (and
signed in, inside a world) asks for a line of text and appends it to an "Inbox" note:

```js
javascript:(async()=>{const a=window.archivarius;if(!a){alert('Open Archivarius and sign in first');return}const t=prompt('Add to Inbox:');if(!t)return;let n;try{n=await a.notes.get('Inbox')}catch{n=await a.notes.create({title:'Inbox'})}await n.append('- '+t)})()
```

## Things to know

- **Permissions** are enforced by the server, not by the API: viewers can read but every
  write fails with `Permission denied by the server`; secret pages you can't see don't exist
  for the API either.
- **Unsaved edits**: if a note is open in an editor with unsaved changes (yours, in this tab,
  or another member's), one side's change can be lost — the same as two members editing the
  same page at once. In this tab, the open editor reloads after an API write when it has no
  unsaved edits, and shows the "updated by someone else" banner when it does. Safest: let
  the editor save (the status says "Saved") before running a script on the same page.
- Each call makes a few requests to the server; for bulk work, `await` the calls one after
  another in a loop.

## For developers

- In-app code can import the typed API: `src/api/archivarius.ts` exports
  `createArchivarius()` and the `Archivarius`, `World`, `Notes`, `Note`, `CreateNoteOptions`
  types; `src/api/browser.ts` installs `window.archivarius` (typed on `Window`).
- `src/api/markdown.ts` is pure (no DOM, no imports) — tests:
  `node scripts/test-api-markdown.mjs` (Node ≥ 22.18, which runs `.ts` directly).
- The core has no React/zustand dependency; it only talks to `src/lib/db.ts`, and the host
  passes in "which world is open" and a callback after each write. A Node client is possible
  later, but not as-is: `src/lib/supabase.ts` reads Vite's `import.meta.env` and the imports
  are extensionless, so it would need a bundled build (or the Supabase client injected
  instead of imported) plus a sign-in step.
