import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react'
import type { Pin, Region } from '../../lib/types'
import { PRESET_COLORS } from './constants'
import PageLinkPicker from './PageLinkPicker'


type Props =
  | {
      kind: 'pin'
      item: Pin
      onChange: (attrs: Partial<Pin>, immediate?: boolean) => void
      common: CommonProps
    }
  | {
      kind: 'region'
      item: Region
      onChange: (attrs: Partial<Region>, immediate?: boolean) => void
      common: CommonProps
    }

interface CommonProps {
  projectId: string
  mapPageId: string
  style: CSSProperties
  onDelete: () => void
  onClose: () => void
  onOpenPage: (pageId: string) => void
}

export default function EditPopup(props: Props): JSX.Element {
  const { item, common } = props
  const [confirmDelete, setConfirmDelete] = useState(false)
  const labelRef = useRef<HTMLInputElement>(null)

  // Focus the label field on open (the popup is keyed by item id).
  useEffect(() => {
    labelRef.current?.focus({ preventScroll: true })
  }, [])

  const color = item.color ?? null

  return (
    <div
      className="wk-popup"
      style={common.style}
      role="dialog"
      aria-label={props.kind === 'pin' ? 'Edit pin' : 'Edit region'}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          common.onClose()
        }
      }}
    >
      <div className="wk-popup__head">
        <span className="wk-popup__kind">{props.kind === 'pin' ? 'Pin' : 'Region'}</span>
        <button
          type="button"
          className="wk-icon-btn"
          aria-label="Close"
          title="Close"
          onClick={common.onClose}
        >
          ×
        </button>
      </div>

      <label className="wk-field">
        <span className="wk-field__label">Label</span>
        <input
          ref={labelRef}
          type="text"
          value={item.label ?? ''}
          placeholder={props.kind === 'pin' ? 'Pin label' : 'Region name'}
          onChange={(e) => props.onChange({ label: e.target.value || null })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') common.onClose()
          }}
        />
      </label>

      {props.kind === 'pin' && (
        <label className="wk-field">
          <span className="wk-field__label">Icon</span>
          <input
            type="text"
            className="wk-field__icon"
            value={props.item.icon ?? ''}
            placeholder="Emoji, e.g. 🏰"
            maxLength={8}
            onChange={(e) => props.onChange({ icon: e.target.value.trim() || null })}
          />
        </label>
      )}

      <div className="wk-field">
        <span className="wk-field__label">Color</span>
        <div className="wk-swatches">
          <button
            type="button"
            className={`wk-swatch wk-swatch--default${color === null ? ' is-active' : ''}`}
            title="Default"
            aria-label="Default color"
            onClick={() => props.onChange({ color: null }, true)}
          />
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`wk-swatch${color?.toLowerCase() === c ? ' is-active' : ''}`}
              style={{ background: c }}
              title={c}
              aria-label={`Color ${c}`}
              onClick={() => props.onChange({ color: c }, true)}
            />
          ))}
          <label className="wk-swatch wk-swatch--custom" title="Custom color">
            <input
              type="color"
              value={color && /^#[0-9a-f]{6}$/i.test(color) ? color : PRESET_COLORS[0]}
              onChange={(e) => props.onChange({ color: e.target.value })}
            />
          </label>
        </div>
      </div>

      {props.kind === 'region' && (
        <label className="wk-field">
          <span className="wk-field__label">
            Opacity <span className="wk-field__value">{Math.round(props.item.opacity * 100)}%</span>
          </span>
          <input
            type="range"
            min={0.1}
            max={0.8}
            step={0.05}
            value={props.item.opacity}
            onChange={(e) => props.onChange({ opacity: Number(e.target.value) })}
          />
        </label>
      )}

      <div className="wk-field">
        <span className="wk-field__label">Link to page</span>
        <PageLinkPicker
          projectId={common.projectId}
          excludeId={common.mapPageId}
          value={item.target_page_id}
          onChange={(id) => props.onChange({ target_page_id: id }, true)}
          onOpen={common.onOpenPage}
        />
      </div>

      <div className="wk-popup__foot">
        {confirmDelete ? (
          <>
            <span className="wk-popup__confirm">Delete this {props.kind}?</span>
            <button type="button" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
            <button type="button" className="wk-btn-danger" onClick={common.onDelete}>
              Delete
            </button>
          </>
        ) : (
          <button
            type="button"
            className="wk-btn-danger-ghost"
            onClick={() => setConfirmDelete(true)}
          >
            Delete {props.kind}
          </button>
        )}
      </div>
    </div>
  )
}
