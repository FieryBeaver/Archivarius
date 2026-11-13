import { useEffect, useState } from 'react'
import { Outlet, useNavigate, useParams } from 'react-router-dom'
import * as db from '../lib/db'
import type { Project } from '../lib/types'
import { usePages } from '../state/pages'
import ContextPanel from './ContextPanel'
import EmptyState from './EmptyState'
import Sidebar from './sidebar/Sidebar'
import './ProjectLayout.css'

/** undefined = loading, null = not found / no access */
function useProject(projectId: string): Project | null | undefined {
  const [result, setResult] = useState<{ id: string; project: Project | null } | null>(null)
  useEffect(() => {
    let live = true
    db.listProjects().then(
      (list) => live && setResult({ id: projectId, project: list.find((p) => p.id === projectId) ?? null }),
      () => live && setResult({ id: projectId, project: null }),
    )
    return () => { live = false }
  }, [projectId])
  return result?.id === projectId ? result.project : undefined
}

export default function ProjectLayout() {
  const { projectId = '', pageId } = useParams()
  const navigate = useNavigate()
  const project = useProject(projectId)
  const load = usePages((s) => s.load)

  useEffect(() => {
    load(projectId)
  }, [projectId, load])

  if (project === null) {
    return <EmptyState message="This world doesn't exist, or you don't have access to it."
      actionLabel="Back to your worlds" onAction={() => navigate('/')} />
  }

  return (
    <div className="layout">
      <Sidebar projectId={projectId} projectName={project?.name ?? ''} />
      <main className="layout-main">
        <Outlet />
      </main>
      {pageId && <ContextPanel key={pageId} projectId={projectId} pageId={pageId} />}
    </div>
  )
}
