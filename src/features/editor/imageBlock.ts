import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, Selection, TextSelection, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { Node, mergeAttributes, type Editor } from '@tiptap/react'
import * as db from '../../lib/db'
import { glyphElement, type BlockIconName } from './blockIcons'
import { makeDragHandle } from './blocks'

/*
 * Document images (CONTRACT.md v0.9).
 * { type: 'imageBlock', attrs: { path, width, align, caption } } — an atom block. `path` is a
 * storage path in the public `maps` bucket (`<projectId>/images/<uuid>.<ext>`), resolved to a
 * public URL at render time. `width` is a percent of the column (10–100); the displayed width
 * never exceeds the image's natural pixel width.
 */

export type ImageAlign = 'left' | 'center' | 'right'
export const IMAGE_ALIGNS: readonly ImageAlign[] = ['left', 'center', 'right']
export const IMAGE_MIN_WIDTH = 10
export const IMAGE_MAX_WIDTH = 100
/** Rendered floor (px) so the toolbar, pills and caption field always fit. Keep in sync with editor.css. */
export const IMAGE_MIN_PX = 140

export function asAlign(v: unknown): ImageAlign {
  return IMAGE_ALIGNS.includes(v as ImageAlign) ? (v as ImageAlign) : 'center'
}

export function asWidth(v: unknown): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return IMAGE_MAX_WIDTH
  return Math.round(Math.min(IMAGE_MAX_WIDTH, Math.max(IMAGE_MIN_WIDTH, n)))
}

// ---------- lightbox (always available, including read-only) ----------

let closeLightbox: (() => void) | null = null

/** Full-viewport dark overlay with the image at max size; closes on click or Escape. */
export function openImageLightbox(src: string, caption: string): void {
  closeLightbox?.()
  const previousFocus = document.activeElement as HTMLElement | null

  const overlay = document.createElement('div')
  overlay.className = 'image-lightbox'
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.setAttribute('aria-label', caption || 'Image')
  overlay.tabIndex = -1

  const img = document.createElement('img')
  img.className = 'image-lightbox-img'
  img.src = src
  img.alt = caption || 'Image'
  img.draggable = false
  overlay.append(img)
  if (caption) {
    const cap = document.createElement('p')
    cap.className = 'image-lightbox-caption'
    cap.textContent = caption
    overlay.append(cap)
  }

  function close() {
    if (closeLightbox !== close) return
    closeLightbox = null
    overlay.remove()
    document.removeEventListener('keydown', onKey, true)
    previousFocus?.focus?.({ preventScroll: true })
  }
  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    close()
  }
  overlay.addEventListener('click', close)
  document.addEventListener('keydown', onKey, true)
  closeLightbox = close
  document.body.append(overlay)
  overlay.focus({ preventScroll: true })
}

// ---------- transient notes (upload errors) ----------

let noteEl: HTMLDivElement | null = null
let noteTimer: number | undefined

/** A small toast-like note at the bottom of the viewport (upload/validation errors). */
export function showImageNote(message: string): void {
  if (!noteEl) {
    noteEl = document.createElement('div')
    noteEl.className = 'image-note'
    noteEl.setAttribute('role', 'alert')
    noteEl.addEventListener('click', () => { noteEl?.remove(); noteEl = null })
  }
  noteEl.textContent = message
  if (!noteEl.isConnected) document.body.append(noteEl)
  window.clearTimeout(noteTimer)
  noteTimer = window.setTimeout(() => { noteEl?.remove(); noteEl = null }, 5000)
}

// ---------- upload placeholders (paste / drop) ----------

type PlaceholderMeta = { add: { id: string; pos: number } } | { remove: { id: string } }

const uploadKey = new PluginKey<DecorationSet>('imageUploads')

function placeholderWidget(): HTMLElement {
  const el = document.createElement('div')
  el.className = 'image-upload-placeholder'
  el.contentEditable = 'false'
  el.append(glyphElement('image', 'image-upload-placeholder-glyph'), document.createTextNode('Uploading image…'))
  return el
}

/** Widget decorations marking where pending uploads will land; they follow edits made meanwhile. */
function uploadPlaceholderPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: uploadKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        let next = set.map(tr.mapping, tr.doc)
        const meta = tr.getMeta(uploadKey) as PlaceholderMeta | undefined
        if (meta && 'add' in meta) {
          // side: 1 so a node inserted at the same spot lands before the remaining placeholders.
          const deco = Decoration.widget(meta.add.pos, placeholderWidget, { id: meta.add.id, side: 1 })
          next = next.add(tr.doc, [deco])
        } else if (meta && 'remove' in meta) {
          next = next.remove(next.find(undefined, undefined, (spec) => spec.id === meta.remove.id))
        }
        return next
      },
    },
    props: {
      decorations(state) { return uploadKey.getState(state) },
    },
  })
}

function placeholderPos(state: EditorState, id: string): number | null {
  const found = uploadKey.getState(state)?.find(undefined, undefined, (spec) => spec.id === id)
  return found?.length ? found[0].from : null
}

/**
 * Uploads `files` one by one and inserts an imageBlock for each at `pos` (in order).
 * Non-images and over-size files are rejected with a note before anything uploads.
 */
export function uploadAndInsertImages(view: EditorView, projectId: string | null, files: File[], pos: number): void {
  if (!projectId) {
    showImageNote('Couldn’t upload: no world is open.')
    return
  }
  const problems = files.map((f) => db.docImageProblem(f)).filter((p): p is string => !!p)
  const valid = files.filter((f) => !db.docImageProblem(f))
  if (problems.length) showImageNote(problems.length > 1 ? `${problems[0]} (and ${problems.length - 1} more skipped)` : problems[0])
  if (!valid.length || !uploadKey.getState(view.state)) return

  const at = Math.max(0, Math.min(pos, view.state.doc.content.size))
  const jobs = valid.map((file) => ({ file, id: crypto.randomUUID() }))
  for (const job of jobs) view.dispatch(view.state.tr.setMeta(uploadKey, { add: { id: job.id, pos: at } } satisfies PlaceholderMeta))

  void (async () => {
    for (const job of jobs) {
      let path: string | null = null
      let failure: string | null = null
      try {
        path = (await db.uploadDocImage(projectId, job.file)).path
      } catch (e) {
        failure = (e as Error).message
      }
      // The tab/page may have closed meanwhile: the upload stays in the library.
      if (view.isDestroyed) return
      const tr = view.state.tr.setMeta(uploadKey, { remove: { id: job.id } } satisfies PlaceholderMeta)
      const where = placeholderPos(view.state, job.id)
      const type = view.state.schema.nodes.imageBlock
      if (path && where != null && type) tr.replaceRangeWith(where, where, type.create({ path }))
      view.dispatch(tr)
      if (failure) showImageNote(`Couldn’t upload image: ${failure}`)
    }
  })()
}

function imageFiles(list: FileList | null | undefined): File[] {
  return list ? Array.from(list) : []
}

/** editorProps.handlePaste: image files on the clipboard (with no text) upload as image blocks. */
export function imagePasteHandler(projectId: string | null) {
  return (view: EditorView, event: ClipboardEvent): boolean => {
    const data = event.clipboardData
    const files = imageFiles(data?.files)
    // Office apps put a rendered picture next to the text: the text wins.
    if (!files.length || data?.getData('text/plain')) return false
    event.preventDefault()
    uploadAndInsertImages(view, projectId, files, view.state.selection.from)
    return true
  }
}

/** editorProps.handleDrop: dropped files upload as image blocks at the drop point. */
export function imageDropHandler(projectId: string | null) {
  return (view: EditorView, event: DragEvent, _slice: unknown, moved: boolean): boolean => {
    if (moved) return false
    const files = imageFiles(event.dataTransfer?.files)
    if (!files.length) return false
    event.preventDefault()
    const hit = view.posAtCoords({ left: event.clientX, top: event.clientY })
    uploadAndInsertImages(view, projectId, files, hit?.pos ?? view.state.selection.from)
    return true
  }
}

// ---------- click below the last block ----------

/**
 * editorProps.handleDOMEvents.mousedown for clicks in the empty space below the last block
 * (the editor's bottom padding / min-height). ProseMirror's default handling there can leave a
 * NodeSelection (e.g. a selected image) in place, so the next keystroke would replace that node.
 * We always take over: if the last block can't hold a caret (image, plugin, divider…) a paragraph
 * is appended and the caret goes in it; otherwise the caret goes to the end of the document.
 * Either way any NodeSelection is replaced and the editor is focused.
 */
export function clickBelowLastBlock(view: EditorView, event: MouseEvent): boolean {
  if (event.button !== 0 || !view.editable || event.shiftKey) return false
  const { doc, schema } = view.state
  const last = doc.lastChild
  if (!last) return false
  const lastDom = view.nodeDOM(doc.content.size - last.nodeSize)
  if (!(lastDom instanceof HTMLElement)) return false
  if (event.clientY <= lastDom.getBoundingClientRect().bottom) return false
  // Clicks on node-view chrome or floating UI rendered inside the editor are not "empty space".
  const target = event.target as globalThis.Node | null
  if (target && target !== view.dom && lastDom.contains(target)) return false

  event.preventDefault()
  const end = doc.content.size
  const paragraph = schema.nodes.paragraph
  let tr = view.state.tr
  // A caret position at the end exists for text blocks and containers (lists, callouts…); for an
  // atom it would be a NodeSelection again, so open a paragraph after it instead.
  const atEnd = Selection.atEnd(doc)
  if (atEnd instanceof TextSelection || !paragraph) {
    tr.setSelection(atEnd)
  } else {
    tr = tr.insert(end, paragraph.create())
    tr.setSelection(TextSelection.create(tr.doc, end + 1))
  }
  view.dispatch(tr.scrollIntoView())
  view.focus()
  return true
}

// ---------- node ----------

export interface ImageBlockOptions {
  /** Project images upload to; null = the currently loaded project (only used by the library). */
  projectId: string | null
  /** false forces read-only (previews); otherwise follows editor.isEditable. */
  canEdit: boolean
}

export const ImageBlock = Node.create<ImageBlockOptions>({
  name: 'imageBlock',
  group: 'block',
  atom: true,
  selectable: true,
  // Draggable via the toolbar grip only (the node view arms dom.draggable).
  draggable: true,

  addOptions() {
    return { projectId: null, canEdit: true }
  },

  addAttributes() {
    return {
      path: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-image-path') ?? '',
        renderHTML: (attrs) => ({ 'data-image-path': attrs.path }),
      },
      width: {
        default: IMAGE_MAX_WIDTH,
        parseHTML: (el) => asWidth(el.getAttribute('data-image-width') ?? IMAGE_MAX_WIDTH),
        renderHTML: (attrs) => ({ 'data-image-width': String(asWidth(attrs.width)) }),
      },
      align: {
        default: 'center' as ImageAlign,
        parseHTML: (el) => asAlign(el.getAttribute('data-image-align')),
        renderHTML: (attrs) => ({ 'data-image-align': asAlign(attrs.align) }),
      },
      caption: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-image-caption') ?? '',
        renderHTML: (attrs) => (attrs.caption ? { 'data-image-caption': String(attrs.caption) } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'figure[data-image-block]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const path = String(node.attrs.path ?? '')
    const caption = String(node.attrs.caption ?? '')
    const img = ['img', { src: path ? db.docImageUrl(path) : '', alt: caption || 'Image' }] as const
    const attrs = mergeAttributes(HTMLAttributes, { 'data-image-block': '', class: 'image-block' })
    return caption ? ['figure', attrs, img, ['figcaption', {}, caption]] : ['figure', attrs, img]
  },

  renderText: ({ node }) => (node.attrs.caption ? String(node.attrs.caption) : ''),

  addProseMirrorPlugins() {
    return [uploadPlaceholderPlugin()]
  },

  addNodeView() {
    const { canEdit } = this.options
    return ({ node: initial, editor, getPos }) => createImageView(initial, editor, getPos, canEdit)
  },
})

const ALIGN_ICONS: Record<ImageAlign, BlockIconName> = { left: 'alignLeft', center: 'alignCenter', right: 'alignRight' }
const ALIGN_LABELS: Record<ImageAlign, string> = { left: 'Align left', center: 'Center', right: 'Align right' }

function createImageView(
  initial: PMNode,
  editor: Editor,
  getPos: () => number | undefined,
  optCanEdit: boolean,
) {
  let node = initial
  // Natural pixel width of the loaded image (0 until known): the display width never exceeds it.
  let natural = 0
  // Live width (%) while resizing; null otherwise.
  let dragWidth: number | null = null
  const editable = optCanEdit && editor.isEditable

  const dom = document.createElement('figure')
  dom.className = 'image-block'
  dom.setAttribute('data-image-block', '')

  const frame = document.createElement('div')
  frame.className = 'image-block-frame'

  const img = document.createElement('img')
  img.className = 'image-block-img'
  img.loading = 'lazy'
  img.decoding = 'async'
  img.draggable = false

  const missing = document.createElement('div')
  missing.className = 'image-block-missing'
  missing.hidden = true
  missing.append(glyphElement('image', 'image-block-missing-glyph'),
    document.createTextNode('This image is no longer in the world’s library.'))

  frame.append(img, missing)
  dom.append(frame)

  img.addEventListener('load', () => {
    natural = img.naturalWidth
    dom.classList.remove('image-block-broken')
    missing.hidden = true
    paintWidth()
  })
  img.addEventListener('error', () => {
    natural = 0
    dom.classList.add('image-block-broken')
    missing.hidden = false
    paintWidth()
  })
  function zoom() {
    if (dom.classList.contains('image-block-broken') || !img.src) return
    openImageLightbox(img.src, String(node.attrs.caption ?? ''))
  }
  // Read-only: a click zooms. Editable: a click selects the block (ProseMirror), a double-click
  // or the toolbar's expand button zooms.
  img.addEventListener(editable ? 'dblclick' : 'click', zoom)

  function setAttrs(patch: Record<string, unknown>) {
    const pos = getPos()
    if (typeof pos !== 'number' || !editor.isEditable) return
    const current = editor.state.doc.nodeAt(pos)
    if (!current || current.type.name !== 'imageBlock') return
    let tr = editor.state.tr
    for (const [k, v] of Object.entries(patch)) tr = tr.setNodeAttribute(pos, k, v)
    editor.view.dispatch(tr)
  }

  // ---- caption ----
  let captionInput: HTMLInputElement | null = null
  const captionText = document.createElement('figcaption')
  captionText.className = 'image-block-caption'

  if (editable) {
    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'image-block-caption-input'
    input.placeholder = 'Add a caption…'
    input.maxLength = 300
    input.setAttribute('aria-label', 'Image caption')
    const commit = () => {
      const clean = input.value.trim()
      if (clean === String(node.attrs.caption ?? '')) return
      setAttrs({ caption: clean })
    }
    input.addEventListener('change', commit)
    input.addEventListener('blur', commit)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        commit()
        input.blur()
        editor.commands.focus()
      } else if (e.key === 'Escape') {
        input.value = String(node.attrs.caption ?? '')
        input.blur()
      }
    })
    input.addEventListener('input', () => dom.classList.toggle('image-block-caption-empty', !input.value))
    captionInput = input
    captionText.append(input)
  }
  frame.append(captionText)

  // ---- toolbar + resize handles (editable only) ----
  const alignButtons = new Map<ImageAlign, HTMLButtonElement>()
  const handles: HTMLElement[] = []

  function toolButton(className: string, label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = `image-block-tool ${className}`
    b.title = label
    b.setAttribute('aria-label', label)
    b.tabIndex = -1
    b.addEventListener('mousedown', (e) => e.preventDefault())
    b.addEventListener('click', onClick)
    return b
  }

  if (editable) {
    const toolbar = document.createElement('div')
    toolbar.className = 'image-block-toolbar'
    toolbar.contentEditable = 'false'
    toolbar.append(makeDragHandle(dom, () => editor.isEditable))
    for (const align of IMAGE_ALIGNS) {
      const b = toolButton('image-block-align', ALIGN_LABELS[align], () => setAttrs({ align }))
      b.append(glyphElement(ALIGN_ICONS[align], 'image-block-tool-glyph'))
      alignButtons.set(align, b)
      toolbar.append(b)
    }
    const expand = toolButton('image-block-expand', 'View full size (double-click)', zoom)
    expand.append(glyphElement('expand', 'image-block-tool-glyph'))
    toolbar.append(expand)
    const remove = toolButton('image-block-remove', 'Remove image', () => {
      const pos = getPos()
      if (typeof pos !== 'number' || !editor.isEditable) return
      editor.view.dispatch(editor.state.tr.delete(pos, pos + node.nodeSize))
    })
    remove.textContent = '×'
    toolbar.append(remove)
    frame.append(toolbar)

    for (const side of ['left', 'right'] as const) {
      const handle = document.createElement('div')
      handle.className = `image-block-handle image-block-handle-${side}`
      handle.contentEditable = 'false'
      handle.title = 'Drag to resize'
      handle.dataset.side = side
      handles.push(handle)
      handle.setAttribute('aria-hidden', 'true')
      attachResize(handle, side)
      frame.append(handle)
    }
  }

  function attachResize(handle: HTMLElement, side: 'left' | 'right') {
    let active = false
    // Viewport geometry captured at pointerdown; the target width is derived from the pointer's
    // absolute position (not accumulated deltas), so the dragged edge stays under the pointer.
    let column = 1
    let anchor = 0   // fixed point: the opposite edge, or the centre line for centred images
    let grab = 0     // pointer-to-edge offset at pointerdown, so the edge doesn't jump

    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !editor.isEditable) return
      e.preventDefault()
      e.stopPropagation()
      handle.setPointerCapture(e.pointerId)
      active = true
      const f = frame.getBoundingClientRect()
      const c = dom.getBoundingClientRect()
      column = Math.max(1, c.width)
      const align = asAlign(node.attrs.align)
      const edge = side === 'right' ? f.right : f.left
      grab = edge - e.clientX
      anchor = align === 'center' ? f.left + f.width / 2 : side === 'right' ? f.left : f.right
      dom.classList.add('image-block-resizing')
    })
    handle.addEventListener('pointermove', (e) => {
      if (!active) return
      const edge = e.clientX + grab
      const align = asAlign(node.attrs.align)
      // Centred: both edges move symmetrically around the fixed centre line. Left/right aligned:
      // only the free edge has a pill (see paint), and the width is its distance to the pinned edge.
      let px = side === 'right' ? edge - anchor : anchor - edge
      if (align === 'center') px *= 2
      const maxPx = natural ? Math.min(column, natural) : column
      const minPx = Math.min(maxPx, Math.max(IMAGE_MIN_PX, (column * IMAGE_MIN_WIDTH) / 100))
      px = Math.min(maxPx, Math.max(minPx, px))
      dragWidth = Math.min(IMAGE_MAX_WIDTH, Math.max(IMAGE_MIN_WIDTH, (px / column) * 100))
      paintWidth()
    })
    const end = (e: PointerEvent) => {
      if (!active) return
      active = false
      if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId)
      dom.classList.remove('image-block-resizing')
      const next = dragWidth == null ? null : asWidth(dragWidth)
      dragWidth = null
      if (next != null && next !== asWidth(node.attrs.width)) setAttrs({ width: next })
      else paintWidth()
    }
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }

  function paintWidth() {
    const pct = dragWidth ?? asWidth(node.attrs.width)
    frame.style.width = `${pct}%`
    // Never upscale: the frame caps at the natural width (but not below the rendered floor, where
    // the image itself is capped instead and sits centred in the frame).
    frame.style.maxWidth = natural ? `${Math.max(natural, IMAGE_MIN_PX)}px` : ''
    img.style.maxWidth = natural ? `${natural}px` : ''
  }

  function paint() {
    const path = String(node.attrs.path ?? '')
    const src = path ? db.docImageUrl(path) : ''
    if (img.getAttribute('src') !== src) {
      natural = 0
      if (src) img.src = src
      else {
        img.removeAttribute('src')
        dom.classList.add('image-block-broken')
        missing.hidden = false
      }
    }
    const caption = String(node.attrs.caption ?? '')
    img.alt = caption || 'Image'
    const align = asAlign(node.attrs.align)
    dom.setAttribute('data-image-align', align)
    for (const [a, b] of alignButtons) b.classList.toggle('active', a === align)
    // Only edges that can move get a pill: both when centred, the free one when aligned.
    for (const h of handles) h.hidden = (align === 'left' && h.dataset.side === 'left') || (align === 'right' && h.dataset.side === 'right')
    if (captionInput) {
      if (document.activeElement !== captionInput) captionInput.value = caption
      dom.classList.toggle('image-block-caption-empty', !captionInput.value)
    } else {
      captionText.textContent = caption
      captionText.hidden = !caption
    }
    paintWidth()
  }
  paint()

  return {
    dom,
    update(updated: PMNode) {
      if (updated.type !== node.type) return false
      node = updated
      paint()
      return true
    },
    // Toolbar, handles and the caption field handle their own events.
    stopEvent: (e: Event) =>
      (e.target as HTMLElement | null)?.closest?.(
        '.image-block-tool, .image-block-handle, .image-block-caption-input',
      ) != null,
    ignoreMutation: () => true,
    destroy() {
      dragWidth = null
    },
  }
}

/** The configured imageBlock project id for an editor (null = unknown; callers fall back). */
export function imageProjectId(editor: Editor): string | null {
  const ext = editor.extensionManager.extensions.find((e) => e.name === 'imageBlock')
  return (ext?.options as ImageBlockOptions | undefined)?.projectId ?? null
}
