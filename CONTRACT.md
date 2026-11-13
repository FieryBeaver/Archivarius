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
