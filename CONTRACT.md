# WorldKeeper — internal contracts (for all contributors/agents)

Philosophy: LegendKeeper-minimal. Everything is a page in a tree. No entity
types, no required fields. Three-pane UI: tree | content | context panel.

## Fixed files — do not modify, code against them
- `src/lib/types.ts` — row types (Page, Pin, Region, WorldEvent, …). v0.4 added
  `Profile`, `MemberWithProfile` (= Member & { email }), `ProjectExport`.
- `src/lib/db.ts` — all data access. Never call supabase directly in features.
  v0.4 added: `renameProject`, `deleteProject`, `getMyRole`, `listMembers`,
  `addMemberByEmail`, `updateMemberRole`, `removeMember`, `exportProject`, `importProject`.
- `src/lib/icons.tsx` — shared icon system (see "Icons" below).
- `src/lib/supabase.ts` — client singleton.
- `src/index.css` — theme tokens. Use `var(--bg|--panel|--panel-2|--border|--text|--muted|--accent|--accent-2|--danger|--radius)`. Never hardcode colors.
- `supabase/migrations/*` — schema. Do not edit. (v0.4: `profiles` table,
  `find_user_by_email(lookup)` and `project_members(p)` RPCs.)
- `package.json` — do not add dependencies. Available: react, react-dom,
  react-router-dom, zustand, @supabase/supabase-js, @tiptap/react,
  @tiptap/starter-kit, @tiptap/extension-mention, @tiptap/suggestion,
  leaflet, react-leaflet, @geoman-io/leaflet-geoman-free,
  @dnd-kit/core, @dnd-kit/sortable, react-icons (use only via `src/lib/icons.tsx`).

## Icons (v0.4)
- An icon in the DB (`pages.icon`, `pins.icon`) is a plain string: either an
  emoji (legacy, e.g. `"🗺"`) or `"gi:<ExportName>"` for a Game Icons icon from
  react-icons, e.g. `"gi:GiCastle"`. `null` page icon = kind default.
- Render with `renderIcon(icon, { size?, className? })` or `<PageIcon page={p} />`.
  Never render an icon string as raw text. Game icons are SVG in `currentColor`,
  default size `1em`.
- `pageIconOf(page)` → page.icon or `DEFAULT_KIND_ICONS[kind]`
  (doc `gi:GiScrollUnfurled`, map `gi:GiTreasureMap`, timeline `gi:GiSandsOfTime`).
- Pickers use `ICON_CHOICES` (curated, categorized) and `searchIcons(query, limit?)`.
  Only icons in `ICON_CHOICES` resolve — do not import from `react-icons/gi`
  elsewhere; ask for an addition to the curated set instead.
- Game Icons are CC BY 3.0 (game-icons.net): the settings/about UI should credit them.
- `src/components/pageIcon.ts` is deprecated (delegates to icons.tsx; `pageIcon()` now returns ReactNode).

## Ownership boundaries (v0.4)
- **Agent A — core/UX** owns: `src/main.tsx`, `src/App.tsx`, `src/App.css`,
  `src/components/**`, `src/state/**`.
- **Agent B — settings** owns: `src/features/settings/**` (new).
- **Agent C — editor blocks** owns: `src/features/editor/**`.
- **Agent D — map & timeline** owns: `src/features/map/**` and `src/features/timeline/**`.
- Shared/fixed (nobody edits without coordination): `src/lib/**`, `src/index.css`,
  `supabase/migrations/**`, `package.json`, this file.

## Feature component contracts
Core renders the center pane by `page.kind`:

```tsx
// src/features/map/MapView.tsx
export default function MapView(props: { page: Page; canEdit: boolean }): JSX.Element

// src/features/timeline/TimelineView.tsx
export default function TimelineView(props: { page: Page; canEdit: boolean }): JSX.Element
```

- Navigate to another page with `useNavigate()` → `/project/${page.project_id}/page/${pageId}`.
- Features fetch their own data (pins/regions/events) via `db.ts` using `props.page.id`.
- Coordinates: pins/regions store map **image pixel** coords (x right, y down,
  origin top-left). Leaflet CRS.Simple: lat = -y, lng = x (or use bounds mapping);
  conversion is internal to the map feature, DB stores pixels.
- TipTap mention nodes must serialize as `{ type: 'mention', attrs: { id: <pageId>, label: <title> } }`
  so mention extraction works uniformly.

## Routes (owned by Agent A / core)
- `/` — project list / create
- `/project/:projectId` — project home (tree, no page selected)
- `/project/:projectId/page/:pageId` — page view
- Auth gate wraps everything; unauthenticated → login screen (magic link + password fallback for local dev).

## v0.5 contracts

App name is **Archivarius** (rename from WorldKeeper done in foundation step).

### New schema/types (fixed — code against them)
- `Project.theme: ThemeOverrides | null` — `ThemeOverrides` has optional keys
  `accent, accent2, bg, panel, panel2, border, text, muted` (CSS color strings).
- `Page.edit_access: 'inherit' | 'restricted'`; `Page.tabs: PageTab[] | null`
  where `PageTab = { id: string; title: string; content: unknown }`.
  `tabs === null` means legacy single doc in `page.content`. Invariant:
  when tabs exist, `page.content` mirrors `tabs[0].content`.
- `page_editors` rows: `{ page_id, user_id, project_id }`.
- RLS enforces: restricted page writable only by project owners or listed
  page editors; applies to the page row AND its pins/regions/events.

### New db.ts API (fixed)
- `updateProjectTheme(projectId, theme: ThemeOverrides | null)`
- `setPageEditAccess(pageId, access: 'inherit' | 'restricted')`
- `listPageEditors(pageId): Promise<string[]>` (user ids)
- `addPageEditor(pageId, projectId, userId)` / `removePageEditor(pageId, userId)`
- `savePageTabs(pageId, tabs: PageTab[])` — also syncs content + mentions (all tabs)
- Export format v2 `'archivarius-export'` (importer accepts v1 too); includes
  theme, edit_access, tabs; excludes page_editors (user ids don't transfer).

### Cross-feature contracts
- `src/state/panel.ts` (Agent A): `usePanelStore` zustand store:
  `{ previewPageId: string | null; openPreview(pageId: string): void; closePreview(): void }`.
  Any feature may call `openPreview`; only A renders the panel.
- `src/features/editor/ReadOnlyDoc.tsx` (Agent C): default export
  `({ content }: { content: unknown }) => JSX.Element` — renders TipTap JSON
  read-only with the same extensions, secret blocks hidden. Consumed lazily by A's ContextPanel.
- Theme: A applies `project.theme` as inline CSS custom properties on the
  project layout root (`--accent` etc). Everyone else keeps using tokens —
  no feature reads `project.theme` directly except B's Appearance tab (edit UI).
- Map (D): a pin/region click whose `target_page_id` is set calls
  `openPreview(target_page_id)`; navigation only from an explicit link/button.
- Per-page canEdit (A computes, features receive via existing `canEdit` prop):
  owner ⇒ true; editor ⇒ `edit_access === 'inherit'` or self in `listPageEditors`;
  viewer ⇒ false.

### Ownership (wave 3) — same map as v0.4
A: `src/main.tsx`, `src/App.tsx`, `src/App.css`, `src/components/**`, `src/state/**`
B: `src/features/settings/**` · C: `src/features/editor/**` · D: `src/features/map/**`, `src/features/timeline/**`
Fixed: `src/lib/**`, `src/index.css`, `supabase/migrations/**`, `package.json`, this file.

## v0.6 contracts — plugins (revised: user-uploaded, no built-ins)

- Storage: bucket `plugins`, path `<project_id>/<plugin_id>.html` (mirror the
  maps bucket's policy style: members read, owners write).
- Types: `Plugin = { id: string; project_id: string; name: string; icon: string | null; source_path: string; created_at: string }`.
- db.ts: `listPlugins(projectId)`, `createPlugin(projectId, { name, icon, file })`
  (uploads + inserts), `updatePlugin(pluginId, patch, file?)` (optional
  re-upload), `deletePlugin(pluginId)` (removes storage object too),
  `getPluginSource(plugin): Promise<string>` (downloads the HTML text).
  Export v2 gains optional `plugins` array `{ id, name, icon, source }` with
  the HTML inlined; import re-uploads each and remaps plugin ids inside
  `pluginBlock` nodes like mentions.
- TipTap node `pluginBlock`: atom block, attrs `{ pluginId: string, data: object | null }`,
  serialized `{ type: 'pluginBlock', attrs: { pluginId, data } }`.
- Iframe host (editor feature): `sandbox="allow-scripts"` ONLY (never
  allow-same-origin), `srcdoc` = downloaded plugin source. Bridge protocol,
  all messages `{ type: 'archivarius:<name>', ... }`:
  - plugin -> host `ready`; host -> plugin `init { data, canEdit, theme }`
    (theme = resolved CSS token map).
  - plugin -> host `set-data { data }` — host updates node attrs (ignored when
    !canEdit), persisted by the normal document save path.
  - plugin -> host `resize { height }` — host clamps 40-2400px.
  - plugin -> host `open-page { pageId }` — host calls `usePanelStore.openPreview(pageId)`.
  Host validates `event.source` is the block's own iframe and ignores all else.
- PLUGINS.md (repo root): authoritative plugin-author documentation — single
  self-contained HTML file, the bridge API above verbatim, lifecycle, theming
  guidance, limits, and a worked character-sheet example. The Settings
  Plugins tab summarizes the format and references it.
- Ownership: foundation-2 = migration + storage policies + lib (types/db) +
  PLUGINS.md; C2 = `src/features/editor/**` (node, iframe host, slash
  picker); B2 = `src/features/settings/**` (Plugins tab with upload).

## v0.9 contracts — document images

- Storage: the existing PUBLIC `maps` bucket (10 MB cap, `image/*` only, enforced
  server-side), path `<project_id>/images/<uuid>.<ext>`. No schema change; the
  library is simply the listing of that folder.
- db.ts: `DOC_IMAGE_MAX_BYTES` (= `MAP_IMAGE_MAX_BYTES`), `docImageProblem(file): string | null`
  (client-side image/* + size check), `uploadDocImage(projectId, file): Promise<{ path, url }>`,
  `docImageUrl(path): string` (public URL), `listProjectImages(projectId): Promise<DocImage[]>`
  where `DocImage = { path, url, name, created_at }` (newest first), `deleteProjectImage(path)`.
- TipTap node `imageBlock`: atom block, attrs
  `{ path: string, width: number /* % of column, 10–100, default 100 */, align: 'left' | 'center' | 'right' /* default 'center' */, caption: string /* default '' */ }`,
  serialized `{ type: 'imageBlock', attrs: { path, width, align, caption } }`. The node
  stores the storage path, never a URL; display width is capped at the image's natural
  pixel width. Click opens a lightbox (also read-only).
- Inserting: slash "Image…" (library picker: upload / pick / owner-delete), paste of
  clipboard image files, drag-drop of image files (editorProps in DocEditor).
- Deleting an image from the library does not touch documents: blocks that use it
  render a "missing image" state. Library delete is owner-only in the UI.
  Uploads set `cacheControl: '3600'`, so browsers that already loaded a deleted image
  may keep showing it for up to an hour (accepted; the confirm text says so).
- Storage policies (migration `20261116120000_maps_select.sql`): `maps` objects are
  listable by project members (select), writable/deletable by owners + editors, scoped
  by the first path segment via `plugin_object_project(name)`. Every `maps` path must
  therefore start with `<project_id>/`. Public URLs still serve without auth.
- Export/import: documents reference images by storage path → public URL; files are
  NOT inlined in exports (same as maps and covers). An imported world keeps pointing
  at the source world's image paths.

## v0.10 contracts — edit-own-only roles

- Schema (migration `20261117120000_edit_own_only.sql`): `project_roles.edit_own_only boolean not null default false`,
  check `not edit_own_only or base = 'editor'`. Helper `edits_own_pages_only(project_id)` (security definer):
  the caller is an editor whose assigned custom role has the flag.
- `can_edit_page(p)` = the v0.7 rule (owner always; editor: secret ⇒ creator only, and `edit_access = 'inherit'`
  or listed in `page_editors`) **plus**, for an edit-own-only editor, `created_by = auth.uid()` or listed in
  `page_editors` (explicit grants win; a grant never opens someone else's secret). Pins/regions/events follow
  via `can_edit_page`. `pages_insert` unchanged (they may create pages).
- `pages_delete` adds the same own-or-granted condition; a BEFORE DELETE trigger
  (`guard_page_delete_own_only`) also refuses cascaded deletes of child pages they couldn't delete directly.
- `project_members(p)` returns `custom_role_edit_own_only boolean` (false without a custom role).
- Types/db: `ProjectRole.edit_own_only`, `MemberWithProfile.custom_role_edit_own_only`;
  `createProjectRole(projectId, name, base, editOwnOnly = false)`, `updateProjectRole(id, { name?, edit_own_only? })`;
  `getMyMembership()` → `MyMembership { role, roleName, editOwnOnly }`, stored as `usePages().editOwnOnly`.
- Client mirror: `useCanEditPage(page)` (needs `id, edit_access, created_by, is_secret`) applies the same rule;
  the flag is ignored while previewing a role. Owners grant extra pages to edit-own-only members from the
  page's edit-access popover ("Also let edit" on "All editors" pages; the checklist on restricted pages).
- Known gap (accepted): the sidebar tree may still offer rename/drag/delete on pages such a member can't
  edit; RLS refuses and the UI reverts.

### v0.10 subtree grants (migration `20261117140000_subtree_grants.sql`)
- A `page_editors` row on page X grants its member X **and every page under X**. Helper
  `has_page_grant(p)` (security definer): caller listed on p or any ancestor (walk up `parent_id`, depth cap 50).
- Read (`can_read_page`, `pages_select`): a secret page is also readable with `has_page_grant` — any member
  role, viewers included. Pins/regions/events/mentions/backlinks follow via `can_read_page`.
- Edit (`can_edit_page`, `pages_update`): for editors, every former direct-`page_editors` check (restricted pages,
  edit-own-only roles) accepts `has_page_grant`, and the secret condition becomes
  `not is_secret or created_by = me or has_page_grant`. Viewers never edit.
- Delete: `pages_delete` uses `has_page_grant` the same way. `guard_page_delete_own_only` runs only on the
  directly deleted row (`pg_trigger_depth() = 1`) and vets its whole subtree while the tree is intact
  (cascaded rows can't resolve ancestor grants because their parent is already gone).
- A grant lets you edit a secret page, not expose it: trigger `guard_page_secret_toggle` lets only owners and
  the page's creator change `is_secret`.
- A non-owner's new page under a secret parent is created secret (`inherit_parent_secret`), so content added
  inside a hidden subtree doesn't leak. It stays visible to its creator, the subtree's grantees and owners.
- Revoking a grant removes access to the subtree except pages the member created (creator rules still apply:
  their own secret pages stay visible/editable to them while they're an editor).
- Client: `useCanEditPage` walks the loaded ancestor chain and treats a cached editor list on any ancestor as
  a grant (loads the chain's lists as needed). Granted secret pages simply arrive from the server; the store
  only filters secrets while previewing as a viewer or with "Hide secrets" on. The edit-access popover marks
  members granted via an ancestor ("inherited") and, on secret pages, offers grants to every non-owner.

### Secrecy matrix (current, v0.10)
| secret page created by | owners | its creator | granted members (page or ancestor) | other editors / viewers |
|---|---|---|---|---|
| an owner | see + edit | see + edit | see (+ edit if editor) | hidden |
| an editor/player | see + edit | see + edit while editor (a demoted viewer loses it) | see (+ edit if editor) | hidden |

- Owners always see and edit everything. Co-GM = a custom role with base `owner` (offered in Settings →
  Members; the sync trigger sets `members.role = 'owner'`).
- v0.9 oversize uploads: `projects.prefs jsonb` (migration `20261117160000_project_prefs.sql`),
  type `ProjectPrefs { imageWarnBytes?: number; autoCompress?: boolean }`,
  `db.updateProjectPrefs(projectId, prefs)` (owners, existing `projects_update` policy).
  `useProjectPrefs` / `prefsFor(projectId)` in `src/state/project.ts` (set by ProjectLayout).
  Every image upload goes through `prepareImageUpload(file, prefsFor(projectId))`
  (`src/lib/prepareImageUpload.tsx`, compression in `src/lib/imageCompress.ts`): over the
  threshold (default 1 MB) it offers a compressed WebP/JPEG copy (long edge ≤ 2048 px; maps
  keep their pixel size) or the original; over the 10 MB cap only the compressed copy.
  SVG/GIF are never re-encoded. Floating popups should ignore clicks inside `[data-floating-keep]`.

### v0.10 secret subtrees (migration `20261120120000_secret_subtree.sql`) — supersedes the matrix above
- Secrecy is a **subtree property**: a page is hidden when it OR ANY ANCESTOR is secret.
  `passes_secret_chain(p)` (security definer): true for owners; true when the caller holds a subtree grant
  on p (`has_page_grant(p)`: listed on p or any ancestor, so a grant on or above the blocking secret page,
  or on a page inside the hidden subtree, opens that path); otherwise false if any secret page on p's chain
  (p included) was not created by the caller while they are an editor.
- Used by `can_read_page`, `can_edit_page` (the editor secret clause), `pages_select`, `pages_update`
  (with-check) and `pages_delete`. `pages_select`/`pages_update` keep the row's own secret clause too: it vets
  a row the statement is inserting, which the chain walk can't see yet. Pins/regions/events/mentions follow
  via `can_read_page` / `can_edit_page`.
- Moves change visibility, so trigger `guard_page_move_secret` (non-owners only): the destination must pass
  `passes_secret_chain` for them, and someone else's page may only be moved into a subtree containing a secret
  page if they hold a grant there. `guard_page_secret_toggle` / `inherit_parent_secret` unchanged.
- Revoking a grant on a secret root also hides pages the member created inside it (the blocking secret page is
  the owner's, not theirs).

| page is hidden by a secret page S (itself or an ancestor) created by | owners | S's creator (while editor) | members granted on the page or above | everyone else |
|---|---|---|---|---|
| an owner | see + edit | see + edit | see (+ edit if editor) | hidden |
| an editor/player | see + edit | see + edit | see (+ edit if editor) | hidden |

  (A page under several secret ancestors is visible only if every one of them lets the caller through, or a
  grant covers it.)
- Client: `secretSources(pages)` (page id → the page hiding it), `secretAncestorOf(pages, id)`,
  `useHiddenVia(pageId)` (title of the hiding ancestor). `useVisiblePages` (preview-as-player / hide-secrets),
  PageView, ContextPanel and BacklinksPanel use effective secrecy; Breadcrumbs/QuickSwitcher/sidebar get it
  through `useVisiblePages`. Tree rows hidden only by inheritance are dimmed like secret rows (tooltip
  "Hidden with “<ancestor>”"); PageTitle shows a static "Hidden with parent" pill. The own secret toggle is
  independent.

## v0.11 contracts — realtime

- Migration `20261120140000_realtime.sql`: tables `pages, pins, regions, events, page_editors, plugins, members,
  project_roles` are in the `supabase_realtime` publication (default replica identity). Helper
  `realtime_topic_project(topic) -> uuid` ('project:<uuid>' → uuid, anything else → null). Policies on
  `realtime.messages` (select + insert, `to authenticated`, `extension = 'broadcast'`): only members of that project
  (any role) may join, receive or send on a private `project:<uuid>` topic.
- postgres_changes and RLS (verified locally): INSERT/UPDATE events are delivered only when the subscriber can SELECT
  the row (secret / secret-subtree pages are not delivered to members who can't see them). Realtime evaluates RLS
  when it decodes the WAL (≈ ms later), against the table's state at that time. DELETE events are never delivered on
  a filtered subscription (old row = primary key only), and a row that becomes invisible to someone produces nothing
  for them — the broadcast below covers both.
- Channels per open world (ProjectLayout → `useRealtime(projectId)` in `src/state/realtime.ts`; torn down on world
  switch, unmount and sign-out):
  1. `live-pg:<projectId>:<n>` — postgres_changes on `pages`, `page_editors`, `plugins`, `members`, `project_roles`,
     each filtered `project_id=eq.<projectId>`. (pins/regions/events have no project_id; they are signalled by
     broadcast only.)
  2. `project:<projectId>` — private broadcast (`config: { private: true }`), event `'change'`, payload
     `{ v: 1, kind: ChangeKind, ids: string[], from: <per-tab client id> }`.
- `ChangeKind` (db.ts) and its `ids`: `'pages'` (structural: create/rename/move/delete/secret/edit access/icon/tags…;
  page ids), `'content'` (only content/tabs — autosave; page ids), `'pins' | 'regions'` (map page ids), `'events'`
  (timeline page ids), `'page_editors'` (page ids), `'plugins'` (plugin ids), `'members'` (user ids),
  `'project_roles'` (role ids), `'project'` (project id: rename/theme/prefs/cover).
- Sending: the db.ts mutation helpers call `notify(kind, ids)` after a successful write; `src/state/realtime.ts`
  installs the notifier with `db.setChangeNotifier` and broadcasts (websocket when joined, else `httpSend`). Features
  never send directly. New write helpers in db.ts must call `notify`. Not announced: mentions, templates, storage-only
  changes, export/import, deleteProject.
- Receiving: own broadcasts are ignored (`from`), others are batched for 300 ms and applied idempotently:
  - `pages`, `page_editors`, `members`, `project_roles` → background re-fetch of the page list + own membership
    (same as `usePages.load` for the loaded world: expanded / preview / hide-secrets kept; a failure leaves the store
    as is). Pages whose `updated_at` changed get bumped; pages that disappeared are recorded in `useLive().vanished`.
  - `content` → re-fetch just those rows (`db.getPagesByIds`) and patch them into the store; bump them.
  - `pins` / `regions` / `events` → bump those pages (MapCanvas / TimelineView refetch their rows; map pins with
    unsaved local edits keep them on top).
  - `page_editors` → also refresh cached `usePageEditors` lists; `members`/`project_roles` → `useLiveVersion('members')`
    (MembersTab refetches); `plugins` → `invalidatePlugins(projectId)` + `useLiveVersion('plugins')`;
    `project` → `refreshProject()`.
  - postgres_changes events wait 1.2 s; those explained by a broadcast (sent or received in the last 5 s, keyed
    `table:id`) are dropped, the rest are treated like the matching broadcast kind (pages → structural).
  - Safety net: window focus / tab visible (at most every 5 s) and every channel re-join run a full refresh of all
    of the above.
- Store (`src/state/realtime.ts`): `useLive` `{ bumps, versions, vanished, notice }`; hooks `usePageBump(pageId)`,
  `useLiveVersion('members' | 'plugins')`. ProjectLayout shows `notice` as a toast.
- Open document (DocEditor): on a bump it waits for its own in-flight save, re-fetches the row and compares
  `updated_at` with the newest version it knows (`useAutosave(...).getSavedAt()`), then the content (key-order-
  insensitive). Foreign change + no unsaved edits → applied in place (`setContent`, not undoable, no update event,
  caret clamped — it can jump) when the tab layout is unchanged and a document tab is open, otherwise the editor
  remounts on the same tab. Foreign change + unsaved edits → banner "This page was updated by someone else —
  Reload / Keep mine" (Keep mine: our next save overwrites theirs; last write wins).
- Open page removed or hidden by someone else's change → PageView navigates to the world home and sets the notice.
