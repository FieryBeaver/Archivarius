import type { Editor } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import * as db from '../../lib/db'
import { effectiveRole, usePages } from '../../state/pages'
import { BLOCK_ICONS } from './blockIcons'
import { imageProjectId } from './imageBlock'

interface ImageLibraryProps {
  projectId: string | null
  onPick(path: string): void
  onClose(): void
}

/** The world's uploaded document images: pick one, upload a new one, or (owners) delete one. */
export function ImageLibrary({ projectId, onPick, onClose }: ImageLibraryProps) {
  const [images, setImages] = useState<db.DocImage[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [confirming, setConfirming] = useState<db.DocImage | null>(null)
  const [deleting, setDeleting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const isOwner = usePages((s) => effectiveRole(s) === 'owner')

  useEffect(() => {
    if (!projectId) {
      setImages([])
      return
    }
    let live = true
    db.listProjectImages(projectId).then(
      (rows) => { if (live) setImages(rows) },
      (e: Error) => { if (live) setError(e.message) },
    )
    return () => { live = false }
  }, [projectId])

  // The slash command's editor focus lands a frame later; focus the popup after it.
  useEffect(() => {
    const id = requestAnimationFrame(() => rootRef.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(id)
  }, [])

  // Escape is caught at the document (capture) so it works wherever focus sits — the editor,
  // a thumbnail, the scroll area: first it cancels an open delete confirm, then closes.
  const confirmingRef = useRef(confirming)
  confirmingRef.current = confirming
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      if (confirmingRef.current) setConfirming(null)
      else onCloseRef.current()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [])

  async function upload(file: File | undefined) {
    if (!file || !projectId) return
    const problem = db.docImageProblem(file)
    if (problem) return setError(problem)
    setError(null)
    setUploading(true)
    try {
      const { path } = await db.uploadDocImage(projectId, file)
      onPick(path)
    } catch (e) {
      setError(`Couldn’t upload: ${(e as Error).message}`)
      setUploading(false)
    }
  }

  async function confirmDelete() {
    if (!confirming) return
    setDeleting(true)
    try {
      await db.deleteProjectImage(confirming.path)
      setImages((rows) => rows?.filter((r) => r.path !== confirming.path) ?? rows)
      setConfirming(null)
    } catch (e) {
      setError(`Couldn’t delete: ${(e as Error).message}`)
    } finally {
      setDeleting(false)
    }
  }

  let empty: string | null = null
  if (!projectId) empty = 'No world is open.'
  else if (!images && !error) empty = 'Loading images…'
  else if (images && !images.length) empty = 'No images yet. Upload one, or paste / drop an image into the page.'

  return (
    <div className="mention-list image-library" role="dialog" aria-label="Insert image" tabIndex={-1}
      ref={rootRef}>
      <div className="image-library-head">
        <button type="button" className="btn-primary image-library-upload" disabled={uploading || !projectId}
          onClick={() => fileRef.current?.click()}>
          <span aria-hidden dangerouslySetInnerHTML={{ __html: BLOCK_ICONS.upload }} />
          {uploading ? 'Uploading…' : 'Upload image…'}
        </button>
        <span className="image-library-hint">up to {db.DOC_IMAGE_MAX_BYTES / (1024 * 1024)} MB</span>
        <input ref={fileRef} type="file" accept="image/*" hidden
          onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = '' }} />
      </div>
      {error && <div className="image-library-error" role="alert">{error}</div>}
      {empty && <div className="mention-empty image-library-empty">{empty}</div>}
      {images && images.length > 0 && (
        <div className="image-library-grid">
          {images.map((img) => (
            <div key={img.path} className={`image-library-cell${confirming?.path === img.path ? ' confirming' : ''}`}>
              <button type="button" className="image-library-thumb" title="Insert this image" aria-label="Insert this image"
                onClick={() => onPick(img.path)}>
                <img src={img.url} alt="" loading="lazy" draggable={false} />
              </button>
              {isOwner && (
                <button type="button" className="image-library-delete" title="Delete from library"
                  aria-label="Delete image from library" onClick={() => setConfirming(img)}>×</button>
              )}
            </div>
          ))}
        </div>
      )}
      {confirming && (
        <div className="image-library-confirm" role="alertdialog" aria-label="Delete image">
          <p>Delete this image from the library? Pages that use it will show a missing image — their text is not touched. Browsers that already loaded it may keep showing it for up to an hour (cached).</p>
          <div className="image-library-confirm-actions">
            <button type="button" className="btn-ghost" onClick={() => setConfirming(null)} disabled={deleting}>Cancel</button>
            <button type="button" className="btn-danger" onClick={() => void confirmDelete()} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

let closeOpen: (() => void) | null = null

/**
 * Mounts a floating ImageLibrary below (or above) `at`, a viewport rect. Closes on outside
 * mousedown, resize, Escape or a pick; only one is open at a time.
 */
export function openFloatingImageLibrary(
  projectId: string | null,
  at: { left: number; top: number; bottom: number },
  onPick: (path: string) => void,
  onEscape?: () => void,
): void {
  closeOpen?.()

  const host = document.createElement('div')
  host.className = 'mention-popup image-library-popup'
  host.style.position = 'fixed'
  const width = Math.min(380, window.innerWidth - 16)
  host.style.width = `${width}px`
  host.style.left = `${Math.max(8, Math.min(at.left, window.innerWidth - width - 8))}px`
  // Below the caret line when it fits, else on whichever side has more room — never over the
  // line itself (the old clamp could slide the popup up over it). Height shrinks to fit.
  const room = 420
  const below = window.innerHeight - at.bottom - 12
  const above = at.top - 12
  if (below >= room || below >= above) {
    host.style.top = `${at.bottom + 4}px`
    host.style.maxHeight = `${Math.max(160, below)}px`
  } else {
    host.style.bottom = `${window.innerHeight - at.top + 4}px`
    host.style.maxHeight = `${Math.max(160, above)}px`
  }
  document.body.append(host)
  const root = createRoot(host)

  let closed = false
  function close() {
    if (closed) return
    closed = true
    if (closeOpen === close) closeOpen = null
    document.removeEventListener('mousedown', onOutside, true)
    window.removeEventListener('resize', close)
    // Defer unmount: close can run from inside a React handler of this root.
    queueMicrotask(() => { root.unmount(); host.remove() })
  }
  closeOpen = close

  function onOutside(e: MouseEvent) {
    if (!host.contains(e.target as globalThis.Node)) close()
  }
  document.addEventListener('mousedown', onOutside, true)
  window.addEventListener('resize', close)

  root.render(
    <ImageLibrary projectId={projectId} onPick={(path) => { close(); onPick(path) }}
      onClose={() => { close(); onEscape?.() }} />,
  )
}

/**
 * Opens the library at document position `pos` (an empty paragraph left by the slash command).
 * Picking an image inserts { type: 'imageBlock', attrs: { path } } there.
 */
export function openImageLibrary(editor: Editor, pos: number): void {
  const coords = editor.view.coordsAtPos(Math.min(pos, editor.state.doc.content.size))
  const projectId = imageProjectId(editor) || usePages.getState().projectId
  openFloatingImageLibrary(projectId, coords, (path) => {
    if (editor.isDestroyed || !editor.isEditable) return
    const at = Math.min(pos, editor.state.doc.content.size)
    editor.chain().focus().insertContentAt(at, { type: 'imageBlock', attrs: { path } }).run()
  }, () => { if (!editor.isDestroyed) editor.commands.focus() })
}
