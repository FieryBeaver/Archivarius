import { useRef, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import * as db from '../../lib/db'
import { detectTransferFile, exportVersion } from '../../lib/transferFormat'
import type { ReadWorldZip } from '../../lib/transferZipCore'
import type { Project, ProjectExport } from '../../lib/types'
import type { SettingsContext } from './SettingsDialog'

/** The zip half (fflate) is a separate chunk, fetched on first use. */
const loadZip = () => import('../../lib/transferZip')

function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim()
  return (cleaned || 'world').slice(0, 120)
}

function downloadBlob(blob: Blob, fileName: string) {
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

/** Validate a parsed JSON file; returns an error message or null. */
function validate(data: unknown): string | null {
  if (!data || typeof data !== 'object') return 'This file is not an Archivarius export.'
  const d = data as { format?: unknown; version?: unknown; pages?: unknown }
  if (d.format !== 'archivarius-export' && d.format !== 'worldkeeper-export') return 'This file is not an Archivarius export.'
  if (exportVersion(data) === 3) {
    return 'This is the world.json from a .zip export. Import the .zip file itself — it carries the images too.'
  }
  if (!db.isSupportedExport(data)) return `Unsupported export version (${String(d.version)}). This app reads versions 1 and 2 (.json) and 3 (.zip).`
  if (!Array.isArray(d.pages)) return 'The export is damaged: it has no page list.'
  return null
}

type Picked =
  | { kind: 'json'; file: string; data: ProjectExport }
  | { kind: 'zip'; file: string; read: ReadWorldZip }

type Progress = { done: number; total: number } | null

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

function ProgressBar({ progress, label }: { progress: Progress; label: string }) {
  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : null
  return (
    <div className="wks-progress" role="status">
      <span
        className={`wks-progress-bar${pct !== null ? ' is-determinate' : ''}`}
        style={pct !== null ? ({ '--wks-pct': `${pct}%` } as CSSProperties) : undefined}
      />
      <span className="wks-hint">
        {progress && progress.total > 0 ? `${label} ${progress.done} of ${progress.total}…` : 'Working — this can take a few seconds.'}
      </span>
    </div>
  )
}

function Warnings({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null
  return (
    <details className="wks-warnings" open={items.length <= 5}>
      <summary>{title}</summary>
      <ul>{items.map((w, i) => <li key={i}>{w}</li>)}</ul>
    </details>
  )
}

export function TransferTab({ ctx }: { ctx: SettingsContext }) {
  const { project, name, setBusy, close } = ctx
  const navigate = useNavigate()

  const [exporting, setExporting] = useState<'json' | 'zip' | null>(null)
  const [exportProgress, setExportProgress] = useState<Progress>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportedAt, setExportedAt] = useState<string | null>(null)
  const [exportWarnings, setExportWarnings] = useState<string[]>([])

  const fileRef = useRef<HTMLInputElement>(null)
  const [reading, setReading] = useState(false)
  const [parsed, setParsed] = useState<Picked | null>(null)
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState<Progress>(null)
  const [importError, setImportError] = useState<string | null>(null)
  /** Imported with skipped images: stay here to show them, with a button to open the world. */
  const [imported, setImported] = useState<{ project: Project; warnings: string[] } | null>(null)

  const startExport = (kind: 'json' | 'zip') => {
    setExporting(kind)
    setExportProgress(null)
    setExportError(null)
    setExportedAt(null)
    setExportWarnings([])
  }

  const runExport = async () => {
    if (exporting) return
    startExport('json')
    try {
      const data = await db.exportProject(project.id)
      const fileName = `${safeFileName(name)}.archivarius.json`
      downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), fileName)
      setExportedAt(`${fileName} · ${plural(data.pages.length, 'page')}`)
    } catch (e) {
      setExportError((e as Error).message || 'Export failed.')
    } finally {
      setExporting(null)
    }
  }

  const runZipExport = async () => {
    if (exporting) return
    startExport('zip')
    try {
      const { exportWorldZip } = await loadZip()
      const res = await exportWorldZip(project.id, (done, total) => setExportProgress({ done, total }))
      const fileName = `${safeFileName(name)}.archivarius.zip`
      downloadBlob(res.blob, fileName)
      setExportedAt(`${fileName} · ${plural(res.pageCount, 'page')} · ${plural(res.imageCount, 'image')}`)
      setExportWarnings(res.warnings)
    } catch (e) {
      setExportError((e as Error).message || 'Export failed.')
    } finally {
      setExporting(null)
      setExportProgress(null)
    }
  }

  const onPick = async (file: File | undefined) => {
    setImportError(null)
    setParsed(null)
    setImported(null)
    if (!file) return
    setReading(true)
    try {
      const head = new Uint8Array(await file.slice(0, 4).arrayBuffer())
      if (detectTransferFile(head) === 'zip') {
        const { readWorldZip } = await loadZip()
        const read = await readWorldZip(new Uint8Array(await file.arrayBuffer()))
        setParsed({ kind: 'zip', file: file.name, read })
        return
      }
      let data: unknown
      try {
        data = JSON.parse(await file.text())
      } catch {
        setImportError('That file is neither an Archivarius .zip nor valid JSON.')
        return
      }
      const problem = validate(data)
      if (problem) {
        setImportError(problem)
        return
      }
      setParsed({ kind: 'json', file: file.name, data: data as ProjectExport })
    } catch (e) {
      setImportError((e as Error).message || 'Could not read that file.')
    } finally {
      setReading(false)
    }
  }

  const resetPick = () => {
    setParsed(null)
    setImportError(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const openWorld = (p: Project) => {
    close()
    navigate(`/project/${p.id}`)
  }

  const runImport = async () => {
    if (!parsed || importing) return
    setImporting(true)
    setImportProgress(null)
    setBusy(true)
    setImportError(null)
    try {
      if (parsed.kind === 'zip') {
        const { importWorldZip } = await loadZip()
        const res = await importWorldZip(parsed.read, (done, total) => setImportProgress({ done, total }))
        setBusy(false)
        if (res.warnings.length) {
          setImporting(false)
          setParsed(null)
          if (fileRef.current) fileRef.current.value = ''
          setImported(res)
          return
        }
        openWorld(res.project)
        return
      }
      const created = await db.importProject(parsed.data)
      setBusy(false)
      openWorld(created)
    } catch (e) {
      setBusy(false)
      setImporting(false)
      setImportError((e as Error).message || 'Import failed.')
    }
  }

  const world = parsed ? (parsed.kind === 'zip' ? parsed.read.world : parsed.data) : null
  const counts = world
    ? ([
        [world.pages.length, 'page'],
        [world.pins?.length ?? 0, 'pin'],
        [world.regions?.length ?? 0, 'region'],
        [world.events?.length ?? 0, 'event'],
        [parsed?.kind === 'zip' ? parsed.read.world.assets.length : 0, 'image'],
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
            <div className="wks-strong">JSON — text only</div>
            <div className="wks-hint">Pages, maps’ pins and regions, timelines, plugins and theme. Small file; images are not included.</div>
          </div>
          <button type="button" className="btn-ghost wks-btn" disabled={!!exporting} onClick={() => { void runExport() }}>
            {exporting === 'json' ? 'Exporting…' : 'Export .json'}
          </button>
        </div>
        <div className="wks-row-between">
          <div>
            <div className="wks-strong">.zip — full backup with images</div>
            <div className="wks-hint">Everything in the JSON plus map images, images in notes, the cover and the image library.</div>
          </div>
          <button type="button" className="btn-primary wks-btn" disabled={!!exporting} onClick={() => { void runZipExport() }}>
            {exporting === 'zip' ? 'Exporting…' : 'Export .zip (with images)'}
          </button>
        </div>
        {exporting === 'zip' && <ProgressBar progress={exportProgress} label="Downloading images:" />}
        {exportError && <p className="wks-error" role="alert">{exportError}</p>}
        {exportedAt && <div className="wks-hint" aria-live="polite">Downloaded {exportedAt}.</div>}
        <Warnings
          title={`${plural(exportWarnings.length, 'image')} couldn’t be downloaded and ${exportWarnings.length === 1 ? 'was' : 'were'} left out:`}
          items={exportWarnings}
        />
      </div>

      <div className="wks-divider" />

      <div className="wks-field">
        <div className="wks-label">Import</div>
        <div className="wks-hint">
          Creates a new world from an Archivarius .zip or .json (or older WorldKeeper) export. This world is not changed.
        </div>
        <input
          ref={fileRef}
          className="wks-file-input"
          tabIndex={-1}
          aria-hidden="true"
          type="file"
          accept=".json,.zip,application/json,application/zip"
          disabled={importing || reading}
          onChange={(e) => { void onPick(e.target.files?.[0]) }}
        />
        {!parsed && (
          <div>
            <button
              type="button"
              className="wks-btn"
              disabled={importing || reading}
              onClick={() => fileRef.current?.click()}
            >
              {reading ? 'Reading…' : 'Choose file…'}
            </button>
          </div>
        )}
        {parsed && world && (
          <div className="wks-import-preview">
            <div className="wks-import-meta">
              <div className="wks-strong wks-ellipsis" title={world.project?.name}>
                {world.project?.name || 'Untitled world'}
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
            {importing && <ProgressBar progress={importProgress} label="Uploading images:" />}
          </div>
        )}
        {importError && <p className="wks-error" role="alert">{importError}</p>}
        {imported && (
          <div className="wks-import-preview" aria-live="polite">
            <div className="wks-strong">Imported “{imported.project.name}”.</div>
            <Warnings
              title={`${plural(imported.warnings.length, 'image')} ${imported.warnings.length === 1 ? 'was' : 'were'} skipped:`}
              items={imported.warnings}
            />
            <div className="wks-actions">
              <button type="button" className="btn-primary wks-btn" onClick={() => openWorld(imported.project)}>
                Open the new world
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
