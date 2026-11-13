import { useNavigate } from 'react-router-dom'
import { pagePath, useCanEdit, usePages } from '../state/pages'
import EmptyState from './EmptyState'

/** Center pane when no page is selected. */
export default function ProjectHome() {
  const navigate = useNavigate()
  const hasPages = usePages((s) => s.pages.length > 0)
  const status = usePages((s) => s.status)
  const create = usePages((s) => s.create)
  const canEdit = useCanEdit()

  if (status !== 'ready') return null

  async function addFirst() {
    const page = await create(null, 'doc')
    navigate(pagePath(page.project_id, page.id))
  }

  return hasPages
    ? <EmptyState glyph="❧" title="Choose a page" message="Pick a page from the sidebar to start reading." />
    : canEdit
      ? <EmptyState title="A blank world" message="No pages yet. Write the first chapter of your world."
          actionLabel="Create a page" onAction={addFirst} />
      : <EmptyState title="A blank world" message="Nothing has been written here yet." />
}
