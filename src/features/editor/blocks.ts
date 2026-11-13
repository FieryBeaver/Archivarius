import { Node, mergeAttributes } from '@tiptap/react'
import { glyphElement } from './blockIcons'

/*
 * Custom block nodes. Neither stores page ids: import remapping (db.ts remapContent)
 * only rewrites mention nodes, so page references must stay in mentions.
 */

export const CALLOUT_VARIANTS = ['info', 'success', 'warning', 'danger'] as const
export type CalloutVariant = (typeof CALLOUT_VARIANTS)[number]

export const CALLOUT_LABELS: Record<CalloutVariant, string> = {
  info: 'Info',
  success: 'Success',
  warning: 'Warning',
  danger: 'Danger',
}

function asVariant(v: unknown): CalloutVariant {
  return CALLOUT_VARIANTS.includes(v as CalloutVariant) ? (v as CalloutVariant) : 'info'
}

/** { type: 'callout', attrs: { variant }, content: [block+] } */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      variant: {
        default: 'info' as CalloutVariant,
        parseHTML: (el) => asVariant(el.getAttribute('data-variant')),
        renderHTML: (attrs) => ({ 'data-variant': asVariant(attrs.variant) }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, {
      'data-callout': '',
      class: `callout callout-${asVariant(node.attrs.variant)}`,
    }), 0]
  },

  addNodeView() {
    return ({ node: initial, editor, getPos }) => {
      let node = initial
      const dom = document.createElement('div')
      dom.setAttribute('data-callout', '')
      const icon = document.createElement('button')
      icon.type = 'button'
      icon.contentEditable = 'false'
      const contentDOM = document.createElement('div')
      contentDOM.className = 'callout-content'
      dom.append(icon, contentDOM)

      const paint = () => {
        const v = asVariant(node.attrs.variant)
        dom.className = `callout callout-${v}`
        dom.setAttribute('data-variant', v)
        icon.className = 'callout-icon'
        icon.replaceChildren(glyphElement(v, 'callout-glyph'))
        icon.title = editor.isEditable ? `${CALLOUT_LABELS[v]} — click to change` : CALLOUT_LABELS[v]
        icon.tabIndex = -1
        icon.disabled = !editor.isEditable
      }
      paint()

      icon.addEventListener('mousedown', (e) => e.preventDefault())
      icon.addEventListener('click', () => {
        if (!editor.isEditable) return
        const pos = getPos()
        if (typeof pos !== 'number') return
        const i = CALLOUT_VARIANTS.indexOf(asVariant(node.attrs.variant))
        const next = CALLOUT_VARIANTS[(i + 1) % CALLOUT_VARIANTS.length]
        editor.view.dispatch(editor.state.tr.setNodeAttribute(pos, 'variant', next))
      })

      return {
        dom,
        contentDOM,
        update(updated) {
          if (updated.type !== node.type) return false
          node = updated
          paint()
          return true
        },
        stopEvent: (e) => icon.contains(e.target as globalThis.Node),
        ignoreMutation: (m) => m.type !== 'selection' && !contentDOM.contains(m.target),
      }
    }
  },
})

export interface SecretBlockOptions {
  /** false for viewers: the block and its content never reach the DOM. */
  visible: boolean
}

/**
 * { type: 'secretBlock', content: [block+] } — DM-only notes inside a page.
 * Client-side hiding only; the secure boundary is secret pages.
 */
export const SecretBlock = Node.create<SecretBlockOptions>({
  name: 'secretBlock',
  group: 'block',
  content: 'block+',
  defining: true,

  addOptions() {
    return { visible: true }
  },

  parseHTML() {
    return [{ tag: 'div[data-secret-block]' }]
  },

  renderHTML({ HTMLAttributes }) {
    // Hidden mode also covers clipboard/HTML serialization: no content hole, nothing leaks.
    if (!this.options.visible) return ['div', { 'data-secret-block': '', hidden: '' }]
    return ['div', mergeAttributes(HTMLAttributes, { 'data-secret-block': '', class: 'secret-block' }), 0]
  },

  addNodeView() {
    const visible = this.options.visible
    return () => {
      if (!visible) {
        // No contentDOM: ProseMirror never renders the children.
        const dom = document.createElement('div')
        dom.hidden = true
        dom.className = 'secret-block-hidden'
        return { dom, ignoreMutation: () => true, stopEvent: () => true }
      }
      const dom = document.createElement('div')
      dom.className = 'secret-block'
      dom.setAttribute('data-secret-block', '')
      const header = document.createElement('div')
      header.className = 'secret-block-header'
      header.contentEditable = 'false'
      header.append(glyphElement('lock', 'secret-block-glyph'), document.createTextNode('DM only'))
      const contentDOM = document.createElement('div')
      contentDOM.className = 'secret-block-content'
      dom.append(header, contentDOM)
      return {
        dom,
        contentDOM,
        ignoreMutation: (m) => m.type !== 'selection' && !contentDOM.contains(m.target),
      }
    }
  },
})

/** SecretBlock configured for the viewer's role (hidden mode also blanks it in plain-text copies). */
export function secretBlock(visible: boolean) {
  return visible ? SecretBlock : SecretBlock.extend({ renderText: () => '' }).configure({ visible: false })
}
