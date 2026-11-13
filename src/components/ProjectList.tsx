import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import * as db from '../lib/db'
import type { Project } from '../lib/types'
import { signOut } from '../state/auth'
import EmptyState from './EmptyState'
import './ProjectList.css'

export default function ProjectList() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    db.listProjects().then(setProjects, (e: Error) => setError(e.message))
  }, [])

  useEffect(() => {
    if (creating) inputRef.current?.focus()
  }, [creating])

  async function create(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    try {
      const project = await db.createProject(trimmed)
      navigate(`/project/${project.id}`)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="projects">
      <header className="projects-header">
        <h1>Your worlds</h1>
        <div className="projects-actions">
          <button className="btn-primary" onClick={() => setCreating(true)}>New world</button>
          <button className="btn-ghost" onClick={signOut}>Sign out</button>
        </div>
      </header>

      {creating && (
        <form className="projects-create" onSubmit={create}>
          <input ref={inputRef} placeholder="Name your world…" value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setCreating(false)} />
          <button type="submit" className="btn-primary" disabled={!name.trim()}>Create</button>
          <button type="button" className="btn-ghost" onClick={() => setCreating(false)}>Cancel</button>
        </form>
      )}

      {error && <p className="error-text">{error}</p>}

      {projects?.length === 0 && !creating && (
        <EmptyState message="No worlds yet. Every saga starts with a blank page."
          actionLabel="Create your first world" onAction={() => setCreating(true)} />
      )}

      {projects && projects.length > 0 && (
        <div className="projects-grid">
          {projects.map((p) => (
            <button key={p.id} className="project-card" onClick={() => navigate(`/project/${p.id}`)}>
              <span className="project-card-name">{p.name}</span>
              <span className="project-card-date">Created {new Date(p.created_at).toLocaleDateString()}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
