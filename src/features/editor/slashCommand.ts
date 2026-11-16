import { Extension, ReactRenderer, type Editor, type Range } from '@tiptap/react'
import Suggestion from '@tiptap/suggestion'
import { usePages, visibilityRole } from '../../state/pages'
import type { BlockIconName } from './blockIcons'
import { CALLOUT_LABELS, CALLOUT_VARIANTS, currentUserId } from './blocks'
import { clampToViewport } from './mentionExtension'
import { openImageLibrary } from './ImageLibrary'
import { openPluginPicker } from './PluginPicker'
import SlashList, { type SlashListHandle, type SlashListProps } from './SlashList'

export interface SlashItem {
  id: string
  title: string
  /** Extra search terms. */
  keywords: string
  /** Text glyph, or a block icon name. */
  glyph: { text: string } | { icon: BlockIconName }
  run: (editor: Editor, range: Range) => void
}

const SLASH_ITEMS: SlashItem[] = [
  ...([1, 2, 3] as const).map((level): SlashItem => ({
    id: `h${level}`,
    title: `Heading ${level}`,
    keywords: `h${level} title header`,
    glyph: { text: `H${level}` },
    run: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level }).run(),
  })),
  {
    id: 'bullet', title: 'Bullet list', keywords: 'ul unordered list', glyph: { text: '•' },
    run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run(),
  },
  {
    id: 'ordered', title: 'Numbered list', keywords: 'ol ordered list', glyph: { text: '1.' },
    run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run(),
  },
  {
    id: 'quote', title: 'Quote', keywords: 'blockquote citation', glyph: { text: '❝' },
    run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run(),
  },
  {
    id: 'divider', title: 'Divider', keywords: 'hr horizontal rule separator line', glyph: { icon: 'divider' },
    run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run(),
  },
  ...CALLOUT_VARIANTS.map((variant): SlashItem => ({
    id: `callout-${variant}`,
    title: `Callout: ${CALLOUT_LABELS[variant]}`,
    keywords: `callout note box admonition ${variant}`,
    glyph: { icon: variant },
    run: (e, r) => {
      const chain = e.chain().focus().deleteRange(r)
      if (e.isActive('callout')) chain.updateAttributes('callout', { variant }).run()
      else chain.wrapIn('callout', { variant }).run()
    },
  })),
  {
    id: 'secret', title: 'Secret block', keywords: 'dm gm only hidden private spoiler', glyph: { icon: 'eye' },
    // Stamped with the creator: an editor's secret is private to them + owners.
    run: (e, r) => e.chain().focus().deleteRange(r).wrapIn('secretBlock', { createdBy: currentUserId() }).run(),
  },
  {
    id: 'plugin', title: 'Plugin…', keywords: 'plugin widget embed custom sheet iframe', glyph: { icon: 'plugin' },
    run: (e, r) => {
      e.chain().focus().deleteRange(r).run()
      openPluginPicker(e, e.state.selection.from)
    },
  },
  {
    id: 'image', title: 'Image…', keywords: 'image picture photo upload illustration art library', glyph: { icon: 'image' },
    run: (e, r) => {
      e.chain().focus().deleteRange(r).run()
      openImageLibrary(e, e.state.selection.from)
    },
  },
]

function filterItems(query: string): SlashItem[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  // Owners and editors create secrets (an editor's are private to them + owners).
  const role = visibilityRole(usePages.getState())
  const canSecret = role === 'owner' || role === 'editor'
  return SLASH_ITEMS.filter((item) => {
    if (item.id === 'secret' && !canSecret) return false
    const hay = `${item.title} ${item.keywords}`.toLowerCase()
    return terms.every((t) => hay.includes(t))
  })
}

/** "/" block menu at the start of an empty-ish paragraph. */
export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        char: '/',
        startOfLine: true,
        floatingUi: { strategy: 'fixed', middleware: [clampToViewport] },
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from)
          return $from.parent.type.name === 'paragraph'
        },
        items: ({ query }) => filterItems(query),
        command: ({ editor, range, props }) => props.run(editor, range),
        render: () => {
          let renderer: ReactRenderer<SlashListHandle, SlashListProps> | null = null
          let unmount: (() => void) | null = null
          return {
            onStart(props) {
              renderer = new ReactRenderer(SlashList, { props, editor: props.editor, className: 'mention-popup' })
              unmount = props.mount(renderer.element)
            },
            onUpdate(props) {
              renderer?.updateProps(props)
            },
            onKeyDown({ event }) {
              return renderer?.ref?.onKeyDown(event) ?? false
            },
            onExit() {
              unmount?.()
              renderer?.destroy()
              renderer = null
              unmount = null
            },
          }
        },
      }),
    ]
  },
})
