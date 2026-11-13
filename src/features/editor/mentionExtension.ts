import Mention from '@tiptap/extension-mention'
import type { SuggestionOptions } from '@tiptap/suggestion'
import { ReactRenderer } from '@tiptap/react'
import * as db from '../../lib/db'
import { usePages } from '../../state/pages'
import MentionList, { type MentionItem, type MentionListHandle, type MentionListProps } from './MentionList'

/** Current title of a mentioned page, so renames show up without rewriting stored labels. */
function liveLabel(id: unknown, fallback: unknown): string {
  const page = usePages.getState().pages.find((p) => p.id === id)
  return page?.title ?? String(fallback ?? 'Unknown page')
}

type Middleware = NonNullable<NonNullable<SuggestionOptions['floatingUi']>['middleware']>[number]

/** Keeps the suggestion list inside the viewport horizontally (caret near the right edge on phones). */
export const clampToViewport: Middleware = {
  name: 'wkClampToViewport',
  fn: ({ x, rects }) => ({
    x: Math.max(8, Math.min(x, window.innerWidth - rects.floating.width - 8)),
  }),
}

/** "@" page mentions: suggestions come from db.searchPages; nodes store { id: pageId, label: title }. */
export function pageMention(projectId: string, currentPageId: string) {
  return Mention.configure({
    HTMLAttributes: { class: 'mention' },
    renderText: ({ node }) => `@${liveLabel(node.attrs.id, node.attrs.label)}`,
    renderHTML: ({ node, options }) => ['span', options.HTMLAttributes, `@${liveLabel(node.attrs.id, node.attrs.label)}`],
    suggestion: {
      char: '@',
      floatingUi: { strategy: 'fixed', middleware: [clampToViewport] },
      items: async ({ query }): Promise<MentionItem[]> => {
        const rows = await db.searchPages(projectId, query)
        return rows.filter((p) => p.id !== currentPageId)
      },
      render: () => {
        let renderer: ReactRenderer<MentionListHandle, MentionListProps> | null = null
        let unmount: (() => void) | null = null
        return {
          onStart(props) {
            renderer = new ReactRenderer(MentionList, { props, editor: props.editor, className: 'mention-popup' })
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
    },
  })
}
