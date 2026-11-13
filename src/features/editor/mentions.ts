import type { JSONContent } from '@tiptap/react'

/** Page ids of every mention node in a TipTap document (contract: attrs.id = page id). */
export function extractMentionIds(doc: JSONContent): string[] {
  const ids = new Set<string>()
  const walk = (node: JSONContent) => {
    if (node.type === 'mention' && typeof node.attrs?.id === 'string') ids.add(node.attrs.id)
    node.content?.forEach(walk)
  }
  walk(doc)
  return [...ids]
}
