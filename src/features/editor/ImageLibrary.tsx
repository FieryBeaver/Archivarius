import type { Editor } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import * as db from '../../lib/db'
import { effectiveRole, usePages } from '../../state/pages'
import { BLOCK_ICONS } from './blockIcons'
import { imageProjectId, insertImageAtMarker, markPosition, markedPosition, unmarkPosition, uploadAndInsertImages } from './imageBlock'

interface ImageLibraryProps {
  projectId: string | null
  onPick(path: string): void
  /**
   * A file chosen with "Upload image…". The popup closes and the editor takes over (size dialog,
   * "Adding image…" placeholder at the stored position, upload, insert) — see openImageLibrary.
   */
  onUpload(file: File): void
  onClose(): void
}

/** The world's uploaded document images: pick one, upload a new one, or (owners) delete one. */
export function ImageLibrary({ projectId, onPick, onUpload, onClose }: ImageLibraryProps) {
  const [images, setImages] = useState<db.DocImage[] | null>(null)
  const [error, setError] = useState<string | null>(null)
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

  function upload(file: File | undefined) {
    if (!file || !projectId) return
    if (!file.type.startsWith('image/')) return setError(`“${file.name || 'That file'}” isn’t an image.`)
    onUpload(file)
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
        <button type="button" className="btn-primary image-library-upload" disabled={!projectId}
          onClick={() => fileRef.current?.click()}>
          <span aria-hidden dangerouslySetInnerHTML={{ __html: BLOCK_ICONS.upload }} />
          Upload image…
        </button>
        <span className="image-library-hint">up to {db.DOC_IMAGE_MAX_BYTES / (1024 * 1024)} MB</span>
        <input ref={fileRef} type="file" accept="image/*" hidden
          onChange={(e) => { upload(e.target.files?.[0]); e.target.value = '' }} />
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

interface LibraryHandlers {
  onPick(path: string): void
  onUpload(file: File): void
  /** Closed without a pick or upload; `escape` = by the Escape key. */
  onDismiss?(escape: boolean): void
}

/**
 * Mounts a floating ImageLibrary below (or above) `at`, a viewport rect. Closes on outside
 * mousedown, resize, Escape, a pick or an upload choice; only one is open at a time.
 */
export function openFloatingImageLibrary(
  projectId: string | null,
  at: { left: number; top: number; bottom: number },
  handlers: LibraryHandlers,
): void {
  closeOpen?.()

  const host = document.createElement('div')
  host.className = 'mention-popup image-library-popup'
  host.style.position = 'fixed'
  const width = Math.min(380, window.innerWidth - 16)
  host.style.width = `${width}px`
  host.style.left = `${Math.max(8, Math.min(at.left, window.innerWidth - width - 8))}px`
  // Below the caret line when it fits, else on whichever side has more room — never over the
  // line itself. Height shrinks to fit.
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
  /** `action` = closed by a pick/upload (not a dismissal). */
  function close(action = false, escape = false) {
    if (closed) return
    closed = true
    if (closeOpen === dismiss) closeOpen = null
    document.removeEventListener('mousedown', onOutside, true)
    window.removeEventListener('resize', dismiss)
    // Defer unmount: close can run from inside a React handler of this root.
    queueMicrotask(() => { root.unmount(); host.remove() })
    if (!action) handlers.onDismiss?.(escape)
  }
  const dismiss = () => close()
  closeOpen = dismiss

  function onOutside(e: MouseEvent) {
    const t = e.target as HTMLElement | null
    if (host.contains(t) || t?.closest?.('[data-floating-keep]')) return
    close()
  }
  document.addEventListener('mousedown', onOutside, true)
  window.addEventListener('resize', dismiss)

  root.render(
    <ImageLibrary projectId={projectId}
      onPick={(path) => { close(true); handlers.onPick(path) }}
      onUpload={(file) => { close(true); handlers.onUpload(file) }}
      onClose={() => close(false, true)} />,
  )
}

/**
 * Opens the library for document position `pos` (the empty paragraph the slash command left).
 * The position is marked at once with an invisible anchor that follows edits (the same
 * decoration mechanism as paste/drop upload placeholders), so a pick or an upload — however
 * long the size dialog and upload take — lands exactly there:
 *  - pick: { type: 'imageBlock', attrs: { path } } replaces the empty paragraph at the anchor;
 *  - upload: the paste/drop flow runs at the anchor (dialog, "Adding image…" placeholder, insert).
 */
/**
 * Viewport rect of the caret line at `pos` for placing the popup. Falls back to the middle of
 * the editor when the measurement is unusable (zero/NaN, e.g. a view that isn't laid out).
 */
function anchorRect(view: Editor['view'], pos: number): { left: number; top: number; bottom: number } {
  let r: { left: number; top: number; bottom: number } | null = null
  try { r = view.coordsAtPos(pos) } catch { r = null }
  const usable = r && [r.left, r.top, r.bottom].every(Number.isFinite) && (r.left !== 0 || r.top !== 0 || r.bottom !== 0)
  if (usable && r) return { left: r.left, top: r.top, bottom: r.bottom }
  const box = view.dom.getBoundingClientRect()
  const midY = box.height ? Math.min(box.top + box.height / 2, window.innerHeight / 2) : window.innerHeight / 3
  const left = box.width ? box.left + Math.max(0, box.width / 2 - 190) : Math.max(8, window.innerWidth / 2 - 190)
  return { left, top: midY, bottom: midY }
}

export function openImageLibrary(editor: Editor, pos: number): void {
  const view = editor.view
  const start = Math.max(0, Math.min(pos, editor.state.doc.content.size))
  // Measure BEFORE marking: the marker is a hidden widget at this very position, and
  // coordsAtPos would then measure it (an all-zero rect → popup pinned to the window's corner).
  const coords = anchorRect(view, start)
  const marker = markPosition(view, start)
  const projectId = imageProjectId(editor) || usePages.getState().projectId
  const where = () => (marker ? markedPosition(view, marker) : null) ?? Math.min(start, view.state.doc.content.size)

  openFloatingImageLibrary(projectId, coords, {
    onPick(path) {
      if (editor.isDestroyed || !editor.isEditable) return
      if (marker) insertImageAtMarker(view, marker, start, path)
      else editor.chain().focus().insertContentAt(where(), { type: 'imageBlock', attrs: { path } }).run()
    },
    onUpload(file) {
      if (editor.isDestroyed || !editor.isEditable) return
      const at = where()
      if (marker) unmarkPosition(view, marker)
      uploadAndInsertImages(view, projectId, [file], at)
    },
    onDismiss(escape) {
      if (editor.isDestroyed) return
      if (marker) unmarkPosition(view, marker)
      if (escape) editor.commands.focus()
    },
  })
}
