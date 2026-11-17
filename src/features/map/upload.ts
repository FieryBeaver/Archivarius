import { updatePage, uploadMapImage } from '../../lib/db'
import { prepareImageUpload } from '../../lib/prepareImageUpload'
import type { Page } from '../../lib/types'
import { usePages } from '../../state/pages'
import { prefsFor } from '../../state/project'

export interface MapImage {
  path: string
  w: number
  h: number
}

/** Loads an image source and resolves its natural pixel size. */
export function readImageSize(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => reject(new Error('Could not read the image'))
    img.src = src
  })
}

export async function readFileImageSize(file: File): Promise<{ w: number; h: number }> {
  const url = URL.createObjectURL(file)
  try {
    return await readImageSize(url)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Uploads a map image and stores its path + natural size on the page. Over the world's size
 * threshold the uploader may compress it first (v0.9); null = they cancelled.
 */
export async function uploadAndAttachMapImage(page: Page, original: File): Promise<MapImage | null> {
  if (!original.type.startsWith('image/')) throw new Error('Please choose an image file')
  // Keep the pixel size when compressing: pins/regions are stored in image pixels, and a
  // replaced image must keep the same coordinate space.
  const file = await prepareImageUpload(original, prefsFor(page.project_id), { maxEdge: Infinity })
  if (!file) return null
  const { w, h } = await readFileImageSize(file)
  if (!w || !h) throw new Error('The image has no dimensions')
  const { path } = await uploadMapImage(page.project_id, file)
  const updated = await updatePage(page.id, { map_image_path: path, map_w: w, map_h: h })
  // Keep core's page cache in sync so the page prop isn't stale after navigation.
  usePages.getState().patchLocal(page.id, {
    map_image_path: updated.map_image_path,
    map_w: updated.map_w,
    map_h: updated.map_h,
  })
  return { path: updated.map_image_path ?? path, w: updated.map_w ?? w, h: updated.map_h ?? h }
}
