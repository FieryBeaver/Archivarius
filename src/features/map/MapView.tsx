import { useEffect, useRef, useState, type DragEvent, type JSX } from 'react'
import { mapImageUrl, updatePage } from '../../lib/db'
import type { Page } from '../../lib/types'
import MapCanvas from './MapCanvas'
import { readImageSize, uploadAndAttachMapImage, type MapImage } from './upload'
import './map.css'

interface Props {
  page: Page
  canEdit: boolean
}

export default function MapView(props: Props): JSX.Element {
  // Keyed by page id so all map state resets cleanly when navigating between maps.
  return <MapViewInner key={props.page.id} {...props} />
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function MapViewInner({ page, canEdit }: Props): JSX.Element {
  const [image, setImage] = useState<MapImage | null>(() =>
    page.map_image_path && page.map_w && page.map_h
      ? { path: page.map_image_path, w: page.map_w, h: page.map_h }
      : null,
  )
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [measuring, setMeasuring] = useState(
    () => !!page.map_image_path && !(page.map_w && page.map_h),
  )

  // Legacy/partial rows: image path present but size missing → measure it.
  useEffect(() => {
    const path = page.map_image_path
    if (!path || (page.map_w && page.map_h)) return
    let cancelled = false
    readImageSize(mapImageUrl(path))
      .then(({ w, h }) => {
        if (cancelled) return
        setImage({ path, w, h })
        if (canEdit) updatePage(page.id, { map_w: w, map_h: h }).catch(() => undefined)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorMessage(e))
      })
      .finally(() => {
        if (!cancelled) setMeasuring(false)
      })
    return () => {
      cancelled = true
    }
  }, [page.id, page.map_image_path, page.map_w, page.map_h, canEdit])

  async function handleFile(file: File) {
    setUploading(true)
    setError(null)
    try {
      // null: the uploader cancelled the oversize-image dialog; keep the current image.
      const next = await uploadAndAttachMapImage(page, file)
      if (next) setImage(next)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setUploading(false)
    }
  }

  if (image) {
    return (
      <MapCanvas
        page={page}
        canEdit={canEdit}
        image={image}
        replacing={uploading}
        replaceError={error}
        onDismissError={() => setError(null)}
        onReplace={handleFile}
      />
    )
  }

  if (measuring) {
    return (
      <div className="wk-map-empty">
        <div className="wk-map-empty__msg">Loading map…</div>
      </div>
    )
  }

  if (!canEdit) {
    return (
      <div className="wk-map-empty">
        <div className="wk-map-empty__msg">No map uploaded yet</div>
      </div>
    )
  }

  return <UploadDropzone uploading={uploading} error={error} onFile={handleFile} />
}

function UploadDropzone(props: {
  uploading: boolean
  error: string | null
  onFile: (f: File) => void
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setOver(false)
    const file = e.dataTransfer.files[0]
    if (file && !props.uploading) props.onFile(file)
  }

  return (
    <div className="wk-map-empty">
      <div
        className={`wk-map-dropzone${over ? ' is-over' : ''}${props.uploading ? ' is-busy' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => !props.uploading && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !props.uploading) {
            e.preventDefault()
            inputRef.current?.click()
          }
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <div className="wk-map-dropzone__icon" aria-hidden>
          🗺
        </div>
        <div className="wk-map-dropzone__title">
          {props.uploading ? 'Uploading…' : 'Upload a map image'}
        </div>
        <div className="wk-map-dropzone__hint">Click to choose a file, or drop an image here</div>
        {props.error && <div className="wk-map-dropzone__error">{props.error}</div>}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) props.onFile(file)
          }}
        />
      </div>
    </div>
  )
}
