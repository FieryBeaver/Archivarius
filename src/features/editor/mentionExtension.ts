import Mention from '@tiptap/extension-mention'
import type { SuggestionOptions, SuggestionProps } from '@tiptap/suggestion'
import { ReactRenderer } from '@tiptap/react'
import * as db from '../../lib/db'
import type { Page } from '../../lib/types'
import { hidesSecrets, secretSources, usePages } from '../../state/pages'
import { showImageNote } from './imageBlock'
import MentionList, { type MentionCreate, type MentionItem, type MentionListHandle, type MentionListProps } from './MentionList'
import { createTitleFor } from './newPageTitle'

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

/** Titles of the pages the user can see in the tree (secret ones drop out while secrets are hidden). */
function visibleTitles(): string[] {
  const s = usePages.getState()
  const hidden = hidesSecrets(s) ? secretSources(s.pages) : null
  return s.pages.filter((p) => !hidden?.has(p.id)).map((p) => p.title)
}

/**
 * "@" page mentions: suggestions come from db.searchPages; nodes store { id: pageId, label: title }.
 * With `canCreate` (the doc is editable) the list ends with "+ Create “query”" when no visible page
 * has that exact title: it creates a doc page as a child of the current page (like "New subpage
 * from selection") and inserts the mention through the suggestion's own command, so the node is
 * identical to a picked one. The user stays in this editor.
 */
export function pageMention(projectId: string, currentPageId: string, canCreate = false) {
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
        // Latest suggestion props while the popup is open (null after exit): the create row's
        // insert runs after an await, so it must use the current range, not the one it started with.
        let latest: SuggestionProps<MentionItem> | null = null
        const create: MentionCreate | undefined = canCreate ? {
          titleFor: (query) => createTitleFor(query, visibleTitles()),
          async run(title) {
            let page: Page
            try {
              page = await usePages.getState().create(currentPageId, 'doc', undefined, { title })
            } catch (e) {
              showImageNote(`Couldn’t create the page: ${(e as Error).message}`)
              return
            }
            if (latest && !latest.editor.isDestroyed) latest.command({ id: page.id, label: page.title })
            else showImageNote(`Created “${page.title}”, but the mention was closed meanwhile — it wasn’t linked.`)
          },
        } : undefined
        return {
          onStart(props) {
            latest = props
            renderer = new ReactRenderer(MentionList, { props: { ...props, create }, editor: props.editor, className: 'mention-popup' })
            unmount = props.mount(renderer.element)
          },
          onUpdate(props) {
            latest = props
            renderer?.updateProps({ ...props, create })
          },
          onKeyDown({ event }) {
            return renderer?.ref?.onKeyDown(event) ?? false
          },
          onExit() {
            latest = null
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
