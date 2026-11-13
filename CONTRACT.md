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
