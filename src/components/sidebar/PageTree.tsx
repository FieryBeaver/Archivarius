import {
  DndContext, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors,
  type DragEndEvent, type DragMoveEvent, type DragOverEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Page, PageKind } from '../../lib/types'
import { ancestorIds, buildTree, descendantIds, flattenTree } from '../../state/pageTree'
import { effectiveRole, pagePath, useCanEdit, usePages, useVisiblePages } from '../../state/pages'
import { dropPosition, getProjection } from './dnd'
import TreeRow from './TreeRow'

interface DragState {
  activeId: string
  overId: string
  offsetX: number
}

/** Pages whose name matches the query, plus their ancestors (so matches keep their place in the tree). */
function filterPages(pages: Page[], query: string): Page[] {
  const q = query.toLowerCase()
  const visible = new Set<string>()
  for (const p of pages) {
    if ((p.title || 'Untitled').toLowerCase().includes(q)) {
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
  const { expanded, create, update, remove, toggle } = usePages()
  // Secret pages drop out while previewing as a viewer (their non-secret children surface as roots, like RLS).
  const pages = useVisiblePages()
  const canEdit = useCanEdit()
  const canSecret = usePages((s) => effectiveRole(s) === 'owner')
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

  const addChild = (parentId: string, kind: PageKind) =>
    attempt(create(parentId, kind).then((page) => open(page.id)))

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
              canSecret={canSecret}
              dragDisabled={filtering}
              onOpen={() => open(row.id)}
              onToggle={() => { if (!filtering) toggle(row.id) }}
              onAddChild={(kind) => addChild(row.id, kind)}
              onRename={(title) => attempt(update(row.id, { title }))}
              onToggleSecret={() => attempt(update(row.id, { is_secret: !row.page.is_secret }))}
              onDelete={() => deletePage(row.page)} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}
