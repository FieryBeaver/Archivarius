import { Extension } from '@tiptap/react'
import { Selection } from '@tiptap/pm/state'

/*
 * v0.7 (workstream 3A): rearrange top-level blocks with Alt+ArrowUp/Down.
 * Complements native drag on the custom blocks (callout, secret, plugin),
 * which are draggable via their non-editable headers.
 */

/** Start position of the doc's i-th child. */
function childPos(doc: { child(i: number): { nodeSize: number } }, index: number): number {
  let pos = 0
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize
  return pos
}

export const MoveBlock = Extension.create({
  name: 'moveBlock',

  addKeyboardShortcuts() {
    const move = (dir: -1 | 1) => () =>
      this.editor.commands.command(({ state, tr, dispatch }) => {
        const { doc } = state
        const index = state.selection.$from.index(0)
        const target = index + dir
        if (index >= doc.childCount || target < 0 || target >= doc.childCount) return false
        const node = doc.child(index)
        const other = doc.child(target)
        const from = childPos(doc, index)
        // Where the block starts after the swap.
        const newFrom = dir === -1 ? from - other.nodeSize : from + other.nodeSize
        if (dispatch) {
          const offset = Math.min(state.selection.from - from, node.nodeSize - 1)
          tr.delete(from, from + node.nodeSize)
          tr.insert(newFrom, node)
          tr.setSelection(Selection.near(tr.doc.resolve(newFrom + Math.max(0, offset))))
          tr.scrollIntoView()
        }
        return true
      })

    return {
      'Alt-ArrowUp': move(-1),
      'Alt-ArrowDown': move(1),
    }
  },
})
