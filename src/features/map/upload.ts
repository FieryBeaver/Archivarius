import { updatePage, uploadMapImage } from '../../lib/db'
import type { Page } from '../../lib/types'
import { usePages } from '../../state/pages'

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

/** Uploads a map image and stores its path + natural size on the page. */
export async function uploadAndAttachMapImage(page: Page, file: File): Promise<MapImage> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file')
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
