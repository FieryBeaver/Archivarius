import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MAP_IMAGE_MAX_BYTES } from './db'
import { COMPRESS_MAX_EDGE, canCompressImage, compressImage, compressedFile, type CompressedImage } from './imageCompress'
import type { ProjectPrefs } from './types'
import './prepareImageUpload.css'

/*
 * v0.9: oversize-image handling shared by every image upload (doc image library / paste / drop,
 * map image, world cover). Over the world's threshold (prefs.imageWarnBytes, default 1 MB) the
 * uploader is offered a compressed version (computed up front, so the size shown is real) or the
 * original; over the bucket's hard cap (10 MB) only the compressed version is offered.
 * prefs.autoCompress skips the dialog.
 */

export const DEFAULT_IMAGE_WARN_BYTES = 1024 * 1024
export const IMAGE_WARN_MIN_BYTES = 0.2 * 1024 * 1024
/** The bucket's server-side cap (same as map/cover/doc images). */
export const IMAGE_HARD_MAX_BYTES = MAP_IMAGE_MAX_BYTES

const MB = 1024 * 1024

/** "3.4 MB" / "0.4 MB" (one decimal, at least 0.1). */
export function formatMb(bytes: number): string {
  return `${Math.max(0.1, Math.round((bytes / MB) * 10) / 10).toFixed(1)} MB`
}

/** The effective warn threshold for a world's prefs (clamped to 0.2–10 MB). */
export function imageWarnBytes(prefs: ProjectPrefs | null | undefined): number {
  const n = Number(prefs?.imageWarnBytes)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_IMAGE_WARN_BYTES
  return Math.min(IMAGE_HARD_MAX_BYTES, Math.max(IMAGE_WARN_MIN_BYTES, n))
}

function tooBigError(bytes: number): Error {
  return new Error(`That image is ${formatMb(bytes)} even after compressing — the limit is ${IMAGE_HARD_MAX_BYTES / MB} MB. Try a smaller image.`)
}

/**
 * Decides what to upload for `file`. Resolves the File to upload (the original or a compressed
 * copy), or null when the user cancelled. Rejects when the image can't fit under the hard cap
 * even compressed. Non-images and files under the threshold pass through untouched (the upload
 * functions keep validating type and size themselves).
 */
export async function prepareImageUpload(
  file: File,
  prefs: ProjectPrefs | null | undefined,
  /** maxEdge: long-edge cap for the compressed copy (default 2048; Infinity keeps the size, e.g. maps). */
  { maxEdge = COMPRESS_MAX_EDGE }: { maxEdge?: number } = {},
): Promise<File | null> {
  if (!file.type.startsWith('image/')) return file
  const threshold = imageWarnBytes(prefs)
  if (file.size <= threshold) return file
  const overHard = file.size > IMAGE_HARD_MAX_BYTES
  const compressible = canCompressImage(file)

  // SVG/GIF: never re-encoded. Over the cap the upload refuses it with the usual error.
  if (!compressible) {
    if (overHard) return file
    const choice = await askUser({ file, threshold, compressible: false, maxEdge })
    return choice === 'original' ? file : null
  }

  if (prefs?.autoCompress) {
    try {
      const out = await compressImage(file, threshold, { maxEdge, hardLimitBytes: IMAGE_HARD_MAX_BYTES })
      if (out.blob.size >= file.size) return file
      if (out.blob.size > IMAGE_HARD_MAX_BYTES) throw tooBigError(out.blob.size)
      return compressedFile(file, out)
    } catch (e) {
      if (overHard) throw e
      return file
    }
  }

  const choice = await askUser({ file, threshold, compressible: true, maxEdge })
  if (!choice) return null
  if (choice === 'original') return file
  return compressedFile(file, choice.out)
}

// ---------- dialog ----------

type Choice = { kind: 'compressed'; out: CompressedImage } | 'original' | null

interface DialogProps {
  file: File
  threshold: number
  compressible: boolean
  maxEdge: number
  onDone(choice: Choice): void
}

function SqueezeDialog({ file, threshold, compressible, maxEdge, onDone }: DialogProps) {
  const [out, setOut] = useState<CompressedImage | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const overHard = file.size > IMAGE_HARD_MAX_BYTES
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!compressible) return
    let live = true
    compressImage(file, threshold, { maxEdge, hardLimitBytes: IMAGE_HARD_MAX_BYTES }).then(
      (r) => { if (live) setOut(r) },
      (e: Error) => { if (live) setFailed(e.message) },
    )
    return () => { live = false }
  }, [file, threshold, compressible, maxEdge])

  useEffect(() => { panelRef.current?.focus({ preventScroll: true }) }, [])

  const compressing = compressible && !out && !failed
  const useless = !!out && out.blob.size >= file.size
  const compressedTooBig = !!out && out.blob.size > IMAGE_HARD_MAX_BYTES
  const canCompressPick = !!out && !useless && !compressedTooBig
  const canOriginal = !overHard

  let note: string | null = null
  if (!compressible) note = 'GIF and SVG images aren’t compressed here.'
  else if (failed) note = `${failed}${overHard ? '' : ' You can still upload the original.'}`
  else if (useless) note = 'Compressing wouldn’t make this image smaller.'
  else if (compressedTooBig && out) note = tooBigError(out.blob.size).message

  return (
    <div className="squeeze-dialog" role="alertdialog" aria-modal="true" aria-labelledby="squeeze-title"
      tabIndex={-1} ref={panelRef} onMouseDown={(e) => e.stopPropagation()}>
      <h2 id="squeeze-title" className="squeeze-title">Large image</h2>
      <p className="squeeze-text">
        {file.name ? <><strong>{file.name}</strong> is </> : 'This image is '}
        {formatMb(file.size)}
        {overHard
          ? ` — over the ${IMAGE_HARD_MAX_BYTES / MB} MB upload limit, so it has to be compressed.`
          : ` (over the ${formatMb(threshold)} limit set for this world).`}
      </p>
      {compressing && <p className="squeeze-note" aria-live="polite">Compressing…</p>}
      {note && <p className={`squeeze-note${failed || compressedTooBig ? ' squeeze-error' : ''}`} role="status">{note}</p>}
      <div className="squeeze-actions">
        <button type="button" className="btn-ghost" onClick={() => onDone(null)}>Cancel</button>
        {canOriginal && (
          <button type="button" className={canCompressPick || compressing ? '' : 'btn-primary'}
            onClick={() => onDone('original')}>Upload original</button>
        )}
        {compressible && (canCompressPick || compressing) && (
          <button type="button" className="btn-primary" disabled={!canCompressPick} autoFocus
            onClick={() => { if (out) onDone({ kind: 'compressed', out }) }}>
            {out ? `Compress to ~${formatMb(out.blob.size)}` : 'Compress…'}
          </button>
        )}
      </div>
    </div>
  )
}

/** One dialog at a time; a second request waits for the first. */
let queue: Promise<unknown> = Promise.resolve()

function askUser(opts: Omit<DialogProps, 'onDone'>): Promise<Choice> {
  const run = () => new Promise<Choice>((resolve) => {
    const backdrop = document.createElement('div')
    backdrop.className = 'squeeze-backdrop'
    // Floating pickers (image library…) ignore clicks inside this dialog.
    backdrop.setAttribute('data-floating-keep', '')
    document.body.append(backdrop)
    const root = createRoot(backdrop)
    const previousFocus = document.activeElement as HTMLElement | null

    let done = false
    function finish(choice: Choice) {
      if (done) return
      done = true
      window.removeEventListener('keydown', onKey, true)
      queueMicrotask(() => { root.unmount(); backdrop.remove() })
      previousFocus?.focus?.({ preventScroll: true })
      resolve(choice)
    }
    // Window capture runs before the document-level Escape handlers of open popups/dialogs.
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      finish(null)
    }
    window.addEventListener('keydown', onKey, true)
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) finish(null) })
    root.render(<SqueezeDialog {...opts} onDone={finish} />)
  })
  const next = queue.then(run, run)
  queue = next.catch(() => undefined)
  return next
}
