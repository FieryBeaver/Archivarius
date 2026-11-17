/*
 * v0.9: client-side image "squeeze" before upload. Canvas re-encode: downscale to a max long edge
 * (never upscale), encode WebP on a falling quality ladder until under the target size (best
 * effort), JPEG when the browser can't encode WebP. SVG and GIF are never re-encoded (vector /
 * possibly animated).
 */

export const COMPRESS_MAX_EDGE = 2048
const QUALITY_LADDER = [0.85, 0.78, 0.7, 0.6]

export interface CompressedImage {
  blob: Blob
  width: number
  height: number
}

/** Whether `file` may be re-encoded (raster, not animated-capable). */
export function canCompressImage(file: File): boolean {
  const t = file.type.toLowerCase()
  return t.startsWith('image/') && t !== 'image/svg+xml' && t !== 'image/gif'
}

interface Decoded {
  source: CanvasImageSource
  width: number
  height: number
  release(): void
}

async function decode(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      // imageOrientation 'from-image' (the default) applies EXIF rotation.
      const bmp = await createImageBitmap(file)
      return { source: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close() }
    } catch {
      // fall through to <img>
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    await img.decode()
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) }
  } catch {
    URL.revokeObjectURL(url)
    throw new Error('This image couldn’t be read for compression.')
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

function draw(src: Decoded, width: number, height: number, opaque: boolean): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Image compression isn’t available in this browser.')
  // JPEG has no alpha: flatten transparency onto white instead of black.
  if (opaque) {
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, width, height)
  }
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src.source, 0, 0, width, height)
  return canvas
}

/**
 * Re-encodes `file` to roughly `targetBytes` or less (best effort). Long edge ≤ maxEdge.
 * If even the lowest quality is over `hardLimitBytes`, the image is scaled down further
 * (up to two halvings) to try to fit.
 */
export async function compressImage(
  file: File,
  targetBytes: number,
  { maxEdge = COMPRESS_MAX_EDGE, hardLimitBytes = Infinity }: { maxEdge?: number; hardLimitBytes?: number } = {},
): Promise<CompressedImage> {
  const src = await decode(file)
  try {
    if (!src.width || !src.height) throw new Error('This image has no dimensions.')
    let scale = Math.min(1, maxEdge / Math.max(src.width, src.height))
    let type = 'image/webp'
    let best: CompressedImage | null = null

    for (let pass = 0; pass < 3; pass++) {
      const width = Math.max(1, Math.round(src.width * scale))
      const height = Math.max(1, Math.round(src.height * scale))
      let canvas = draw(src, width, height, type === 'image/jpeg')
      for (const q of QUALITY_LADDER) {
        let blob = await toBlob(canvas, type, q)
        // Browsers without a WebP encoder silently hand back PNG: switch to JPEG once.
        if (blob && type === 'image/webp' && blob.type !== 'image/webp') {
          type = 'image/jpeg'
          canvas = draw(src, width, height, true)
          blob = await toBlob(canvas, type, q)
        }
        if (!blob) continue
        if (!best || blob.size < best.blob.size) best = { blob, width, height }
        if (blob.size <= targetBytes) return best
      }
      if (!best || best.blob.size <= hardLimitBytes) break
      scale /= 2
    }
    if (!best) throw new Error('This image couldn’t be compressed.')
    return best
  } finally {
    src.release()
  }
}

/** A File named after the original with the encoded type's extension. */
export function compressedFile(original: File, out: CompressedImage): File {
  const ext = out.blob.type === 'image/webp' ? 'webp' : 'jpg'
  const base = original.name.replace(/\.[^.]+$/, '') || 'image'
  return new File([out.blob], `${base}.${ext}`, { type: out.blob.type, lastModified: Date.now() })
}
