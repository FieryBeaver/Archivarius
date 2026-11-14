import { useEffect, useState } from 'react'
import * as db from '../../lib/db'
import { DEFAULT_KIND_ICONS, renderIcon } from '../../lib/icons'
import type { PageKind, PageTemplate } from '../../lib/types'
import { useCanEdit, usePages } from '../../state/pages'
import Popover from '../Popover'
import { KIND_LABELS } from '../pageIcon'

const KINDS: PageKind[] = ['doc', 'map', 'timeline']

interface Props {
  anchor: DOMRect
  /** With a template, the new page copies its name/icon/content/tabs. */
  onPick: (kind: PageKind, template?: PageTemplate) => void
  onClose: () => void
}

export default function KindPicker({ anchor, onPick, onClose }: Props) {
  const projectId = usePages((s) => s.projectId)
  const canEdit = useCanEdit()
  const [templates, setTemplates] = useState<PageTemplate[] | null>(null)

  useEffect(() => {
    if (!projectId) return
    let live = true
    db.listPageTemplates(projectId).then(
      (rows) => live && setTemplates(rows),
      () => live && setTemplates([]),
    )
    return () => { live = false }
  }, [projectId])

  const removeTemplate = (t: PageTemplate) => {
    setTemplates((list) => (list ? list.filter((x) => x.id !== t.id) : list))
    db.deletePageTemplate(t.id).catch(() => {
      setTemplates((list) => (list ? [...list, t] : list))
    })
  }

  return (
    <Popover anchor={anchor} onClose={onClose} width={220}>
      {KINDS.map((kind) => (
        <button key={kind} className="popover-item" role="menuitem" onClick={() => onPick(kind)}>
          <span>{renderIcon(DEFAULT_KIND_ICONS[kind])}</span>
          <span>{KIND_LABELS[kind]}</span>
        </button>
      ))}
      {(templates?.length ?? 0) > 0 && (
        <>
          <div className="popover-sep" role="separator" />
          <div className="popover-heading">From template</div>
          {templates!.map((t) => (
            // A div, not a button: the delete control nests inside it.
            <div key={t.id} className="popover-item" role="menuitem" tabIndex={0}
              onClick={() => onPick(t.kind, t)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onPick(t.kind, t) } }}>
              <span>{renderIcon(t.icon || DEFAULT_KIND_ICONS[t.kind])}</span>
              <span className="popover-grow">{t.name}</span>
              {canEdit && (
                <button type="button" className="popover-item-x" aria-label={`Delete template ${t.name}`}
                  title="Delete template"
                  onClick={(e) => { e.stopPropagation(); removeTemplate(t) }}>×</button>
              )}
            </div>
          ))}
        </>
      )}
    </Popover>
  )
}
