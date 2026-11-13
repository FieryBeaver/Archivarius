import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as db from '../../lib/db'
import type { ProjectExport } from '../../lib/types'
import type { SettingsContext } from './SettingsDialog'

function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim()
  return (cleaned || 'world').slice(0, 120)
}

function downloadJson(data: unknown, fileName: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Validate a parsed file; returns an error message or null. */
function validate(data: unknown): string | null {
  if (!data || typeof data !== 'object') return 'This file is not a WorldKeeper export.'
  const d = data as Partial<ProjectExport>
  if (d.format !== 'worldkeeper-export') return 'This file is not a WorldKeeper export.'
  if (d.version !== 1) return `Unsupported export version (${String(d.version)}). This app reads version 1.`
  if (!Array.isArray(d.pages)) return 'The export is damaged: it has no page list.'
  return null
}

export function TransferTab({ ctx }: { ctx: SettingsContext }) {
  const { project, name, setBusy, close } = ctx
  const navigate = useNavigate()

  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportedAt, setExportedAt] = useState<string | null>(null)

  const fileRef = useRef<HTMLInputElement>(null)
  const [parsed, setParsed] = useState<{ file: string; data: ProjectExport } | null>(null)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  const runExport = async () => {
    if (exporting) return
    setExporting(true)
    setExportError(null)
    setExportedAt(null)
    try {
      const data = await db.exportProject(project.id)
      const fileName = `${safeFileName(name)}.worldkeeper.json`
      downloadJson(data, fileName)
      setExportedAt(`${fileName} · ${data.pages.length} page${data.pages.length === 1 ? '' : 's'}`)
    } catch (e) {
      setExportError((e as Error).message || 'Export failed.')
    } finally {
      setExporting(false)
    }
  }

  const onPick = async (file: File | undefined) => {
    setImportError(null)
    setParsed(null)
    if (!file) return
    let data: unknown
    try {
      data = JSON.parse(await file.text())
    } catch {
      setImportError('That file is not valid JSON.')
      return
    }
    const problem = validate(data)
    if (problem) {
      setImportError(problem)
      return
    }
    setParsed({ file: file.name, data: data as ProjectExport })
  }

  const resetPick = () => {
    setParsed(null)
    setImportError(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const runImport = async () => {
    if (!parsed || importing) return
    setImporting(true)
    setBusy(true)
    setImportError(null)
    try {
      const created = await db.importProject(parsed.data)
      setBusy(false)
      close()
      navigate(`/project/${created.id}`)
    } catch (e) {
      setBusy(false)
      setImporting(false)
      setImportError((e as Error).message || 'Import failed.')
    }
  }

  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
  const counts = parsed
    ? ([
        [parsed.data.pages.length, 'page'],
        [parsed.data.pins?.length ?? 0, 'pin'],
        [parsed.data.regions?.length ?? 0, 'region'],
        [parsed.data.events?.length ?? 0, 'event'],
      ] as [number, string][])
        .filter(([n]) => n > 0)
        .map(([n, w]) => plural(n, w))
        .join(' · ')
    : ''

  return (
    <div className="wks-stack">
      <div className="wks-field">
        <div className="wks-label">Export</div>
        <div className="wks-row-between">
          <div>
            <div className="wks-strong">Download this world as JSON</div>
            <div className="wks-hint">Map images are not included.</div>
          </div>
          <button type="button" className="btn-primary wks-btn" disabled={exporting} onClick={() => { void runExport() }}>
            {exporting ? 'Exporting…' : 'Export'}
          </button>
        </div>
        {exportError && <p className="wks-error" role="alert">{exportError}</p>}
        {exportedAt && <div className="wks-hint" aria-live="polite">Downloaded {exportedAt}.</div>}
      </div>

      <div className="wks-divider" />

      <div className="wks-field">
        <div className="wks-label">Import</div>
        <div className="wks-hint">Creates a new world from a WorldKeeper export. This world is not changed.</div>
        <input
          ref={fileRef}
          className="wks-file-input"
          tabIndex={-1}
          aria-hidden="true"
          type="file"
          accept=".json,application/json"
          disabled={importing}
          onChange={(e) => { void onPick(e.target.files?.[0]) }}
        />
        {!parsed && (
          <div>
            <button
              type="button"
              className="wks-btn"
              disabled={importing}
              onClick={() => fileRef.current?.click()}
            >
              Choose file…
            </button>
          </div>
        )}
        {parsed && (
          <div className="wks-import-preview">
            <div className="wks-import-meta">
              <div className="wks-strong wks-ellipsis" title={parsed.data.project?.name}>
                {parsed.data.project?.name || 'Untitled world'}
              </div>
              <div className="wks-hint wks-ellipsis" title={parsed.file}>
                {parsed.file}{counts ? ` · ${counts}` : ''}
              </div>
            </div>
            <div className="wks-actions">
              <button type="button" className="btn-ghost wks-btn" disabled={importing} onClick={resetPick}>
                Cancel
              </button>
              <button type="button" className="btn-primary wks-btn" disabled={importing} onClick={() => { void runImport() }}>
                {importing ? 'Importing…' : 'Import as new world'}
              </button>
            </div>
            {importing && (
              <div className="wks-progress" role="status">
                <span className="wks-progress-bar" />
                <span className="wks-hint">Importing — this can take a few seconds.</span>
              </div>
            )}
          </div>
        )}
        {importError && <p className="wks-error" role="alert">{importError}</p>}
      </div>
    </div>
  )
}
