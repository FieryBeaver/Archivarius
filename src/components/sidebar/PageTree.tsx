import {
  DndContext, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors,
  type DragEndEvent, type DragMoveEvent, type DragOverEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import * as db from '../../lib/db'
import type { Page, PageKind, PageTemplate } from '../../lib/types'
import { useAuth } from '../../state/auth'
import { ancestorIds, buildTree, descendantIds, flattenTree } from '../../state/pageTree'
import { effectiveRole, pagePath, secretSources, useCanEdit, usePages, useVisiblePages } from '../../state/pages'
import { dropPosition, getProjection } from './dnd'
import TreeRow from './TreeRow'

interface DragState {
  activeId: string
  overId: string
  offsetX: number
}

/**
 * Pages whose name or tags match the query, plus their ancestors (so matches
 * keep their place in the tree). A leading "#" searches tags only.
 */
function filterPages(pages: Page[], query: string): Page[] {
  const tagOnly = query.startsWith('#')
  const q = (tagOnly ? query.slice(1) : query).toLowerCase()
  const visible = new Set<string>()
  const matches = (p: Page) =>
    (p.tags ?? []).some((t) => t.toLowerCase().includes(q))
    || (!tagOnly && (p.title || 'Untitled').toLowerCase().includes(q))
  for (const p of pages) {
    if (matches(p)) {
      visible.add(p.id)
      for (const a of ancestorIds(pages, p.id)) visible.add(a)
    }
  }
  return pages.filter((p) => visible.has(p.id))
}

interface PageTreeProps {
  projectId: string
  onNavigate?: () => void
  /** Non-empty: show only pages whose name matches (plus ancestors), fully expanded, drag disabled. */
  filter?: string
}

export default function PageTree({ projectId, onNavigate, filter }: PageTreeProps) {
  const navigate = useNavigate()
  const { pageId } = useParams()
  const { expanded, create, update, remove, duplicate, toggle } = usePages()
  // Secret pages drop out while previewing as a viewer (their non-secret children surface as roots, like RLS).
  const pages = useVisiblePages()
  // v0.10: rows hidden only by a secret ancestor are dimmed like secret rows.
  const secretSrc = useMemo(() => secretSources(pages), [pages])
  const canEdit = useCanEdit()
  // Owners toggle secrecy anywhere; editors only on pages they created.
  const role = usePages(effectiveRole)
  const myId = useAuth((s) => s.session?.user.id)
  const canSecretPage = (p: Page) =>
    role === 'owner' || (role === 'editor' && !!myId && p.created_by === myId)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Mouse drags start after a small move; touch drags need a 250ms press so swipes still scroll the tree.
  // (PointerSensor would also claim touch pointers and turn every scroll into a drag.)
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  )

  const query = filter?.trim().toLowerCase() ?? ''
  const filtering = query.length > 0

  const visiblePages = useMemo(() => (filtering ? filterPages(pages, query) : pages), [pages, filtering, query])
  const tree = useMemo(() => buildTree(visiblePages), [visiblePages])
  // Filter results are always fully expanded, so every match is in view.
  const effExpanded = useMemo(
    () => (filtering ? Object.fromEntries(visiblePages.map((p) => [p.id, true])) : expanded),
    [filtering, visiblePages, expanded],
  )
  // While dragging, hide the dragged page's subtree so it can't be dropped into itself.
  const rows = useMemo(() => flattenTree(tree, effExpanded, drag?.activeId), [tree, effExpanded, drag?.activeId])
  const projection = drag ? getProjection(rows, drag.activeId, drag.overId, drag.offsetX) : null

  const open = (id: string) => {
    onNavigate?.()
    navigate(pagePath(projectId, id))
  }

  function attempt(action: Promise<unknown>) {
    setError(null)
    action.catch((e: Error) => setError(e.message))
  }

  const addChild = (parentId: string, kind: PageKind, template?: PageTemplate) =>
    attempt(create(parentId, kind, template).then((page) => open(page.id)))

  /** v0.7: snapshot a doc page's icon/content/tabs as a reusable template. */
  function saveTemplate(page: Page) {
    const name = window.prompt('Template name', page.title || 'Untitled')?.trim()
    if (!name) return
    const projectIdNow = usePages.getState().projectId
    if (!projectIdNow) return
    attempt(db.createPageTemplate(projectIdNow, {
      name, icon: page.icon, kind: page.kind, content: page.content, tabs: page.tabs,
    }))
  }

  function deletePage(page: Page) {
    const doomed = [page.id, ...descendantIds(pages, page.id)]
    const extra = doomed.length - 1
    const warning = extra > 0 ? ` This also deletes ${extra} nested page${extra === 1 ? '' : 's'}.` : ''
    if (!window.confirm(`Delete "${page.title || 'Untitled'}"?${warning}`)) return
    attempt(remove(page.id).then(() => {
      if (pageId && doomed.includes(pageId)) navigate(`/project/${projectId}`)
    }))
  }

  function onDragEnd({ over }: DragEndEvent) {
    if (drag && over && projection) {
      const page = pages.find((p) => p.id === drag.activeId)
      const unchanged = drag.activeId === over.id && projection.parentId === page?.parent_id
      if (page && !unchanged) {
        const position = dropPosition(rows, pages, drag.activeId, String(over.id), projection)
        attempt(update(page.id, { parent_id: projection.parentId, position }))
        if (projection.parentId) toggle(projection.parentId, true)
      }
    }
    setDrag(null)
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter}
      onDragStart={({ active }: DragStartEvent) => setDrag({ activeId: String(active.id), overId: String(active.id), offsetX: 0 })}
      onDragMove={({ delta }: DragMoveEvent) => setDrag((d) => d && { ...d, offsetX: delta.x })}
      onDragOver={({ over }: DragOverEvent) => over && setDrag((d) => d && { ...d, overId: String(over.id) })}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDrag(null)}>
      <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
        {error && <p className="error-text tree-error">{error}</p>}
        {filtering && rows.length === 0 && <p className="sidebar-empty">No pages match “{filter?.trim()}”.</p>}
        <div className="tree" role="tree">
          {rows.map((row) => (
            <TreeRow key={row.id} row={row}
              depth={row.id === drag?.activeId && projection ? projection.depth : row.depth}
              selected={row.id === pageId}
              expanded={!!effExpanded[row.id]}
              canEdit={canEdit}
              canSecret={canSecretPage(row.page)}
              hiddenVia={row.page.is_secret ? null : secretSrc.get(row.id)?.title ?? null}
              dragDisabled={filtering}
              onOpen={() => open(row.id)}
              onToggle={() => { if (!filtering) toggle(row.id) }}
              onAddChild={(kind, template) => addChild(row.id, kind, template)}
              onSaveTemplate={row.page.kind === 'doc' ? () => saveTemplate(row.page) : undefined}
              onRename={(title) => attempt(update(row.id, { title }))}
              onDuplicate={() => attempt(duplicate(row.id).then((copy) => open(copy.id)))}
              onToggleSecret={() => attempt(update(row.id, { is_secret: !row.page.is_secret }))}
              onDelete={() => deletePage(row.page)} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}
