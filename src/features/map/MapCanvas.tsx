import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'
import { useNavigate } from 'react-router-dom'
import * as L from 'leaflet'
import '@geoman-io/leaflet-geoman-free'
import 'leaflet/dist/leaflet.css'
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css'
import {
  createPin,
  createRegion,
  deletePin,
  deleteRegion,
  listPins,
  listRegions,
  mapImageUrl,
  updatePin,
  updateRegion,
} from '../../lib/db'
import type { Page, Pin, Region } from '../../lib/types'
import { usePanelStore } from '../../state/panel'
import EditPopup from './EditPopup'
import { escapeHtml, pinHtml, safeColor } from './iconHtml'
import {
  imageBounds,
  pointsKey,
  pointsToLatLngs,
  polygonToPixels,
  toLatLng,
  toPixel,
} from './coords'
import type { MapImage } from './upload'

type Mode = 'none' | 'pin' | 'draw'
type Selection = { kind: 'pin'; id: string } | { kind: 'region'; id: string } | null

interface Props {
  page: Page
  canEdit: boolean
  image: MapImage
  replacing: boolean
  replaceError: string | null
  onDismissError: () => void
  onReplace: (file: File) => void
}

interface PinLayer {
  marker: L.Marker
  posKey: string
  iconKey: string
  label: string | null | undefined
}

interface RegionLayer {
  poly: L.Polygon
  geomKey: string
  styleKey: string
  label: string | null | undefined
}

const IMAGE_PANE = 'wkMapImage'
const DEFAULT_REGION_OPACITY = 0.3
const POPUP_W = 264
const SAVE_DELAY_MS = 450

// ---------- helpers ----------

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Resolves a theme token to a concrete value (SVG presentation attributes can't use var()). */
function themeToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function pinIcon(pin: Pin, selected: boolean): L.DivIcon {
  return L.divIcon({
    className: 'wk-pin-icon',
    html: pinHtml({ color: pin.color, icon: pin.icon, linked: !!pin.target_page_id, selected }),
    iconSize: [30, 34],
    iconAnchor: [15, 32],
    tooltipAnchor: [0, -30],
  })
}

function tooltipHtml(label: string | null, linked: boolean): string {
  return `${escapeHtml(label ?? '')}${linked ? ' <span class="wk-tip-link">↗</span>' : ''}`
}

function regionStyle(r: Region, selected: boolean, hover: boolean): L.PathOptions {
  const color = safeColor(r.color) ?? themeToken('--accent')
  const base = r.opacity ?? DEFAULT_REGION_OPACITY
  return {
    color,
    weight: selected ? 2.5 : 1.25,
    opacity: 0.9,
    fillColor: color,
    fillOpacity: hover ? Math.min(1, base + 0.2) : base,
    dashArray: selected ? '6 4' : undefined,
  }
}

// ---------- component ----------

export default function MapCanvas({
  page,
  canEdit,
  image,
  replacing,
  replaceError,
  onDismissError,
  onReplace,
}: Props): JSX.Element {
  const nav = useNavigate()
  const rootRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const replaceInputRef = useRef<HTMLInputElement>(null)

  const [map, setMap] = useState<L.Map | null>(null)
  const [pins, setPins] = useState<Pin[]>([])
  const [regions, setRegions] = useState<Region[]>([])
  const [mode, setMode] = useState<Mode>('none')
  const [editShapes, setEditShapes] = useState(false)
  const [selected, setSelected] = useState<Selection>(null)
  const [error, setError] = useState<string | null>(null)
  const [, setViewTick] = useState(0)
  const [size, setSize] = useState({ w: 0, h: 0 })

  const pinLayers = useRef(new Map<string, PinLayer>())
  const regionLayers = useRef(new Map<string, RegionLayer>())
  const hoveredRegion = useRef<string | null>(null)
  const fittedRef = useRef(false)
  const mapH = image.h
  const mapW = image.w
  const selPinId = selected?.kind === 'pin' ? selected.id : null
  const selRegionId = selected?.kind === 'region' ? selected.id : null

  const report = useCallback((e: unknown) => setError(errorMessage(e)), [])

  // ---------- debounced persistence ----------

  const pending = useRef(
    new Map<string, { kind: 'pin' | 'region'; attrs: Record<string, unknown>; timer: number }>(),
  )

  const flush = useCallback(
    (id: string) => {
      const p = pending.current.get(id)
      if (!p) return
      window.clearTimeout(p.timer)
      pending.current.delete(id)
      const req =
        p.kind === 'pin'
          ? updatePin(id, p.attrs as Partial<Pin>)
          : updateRegion(id, p.attrs as Partial<Region>)
      req.catch(report)
    },
    [report],
  )

  const schedule = useCallback(
    (kind: 'pin' | 'region', id: string, attrs: Record<string, unknown>, immediate: boolean) => {
      const prev = pending.current.get(id)
      if (prev) window.clearTimeout(prev.timer)
      const merged = { kind, attrs: { ...prev?.attrs, ...attrs }, timer: 0 }
      pending.current.set(id, merged)
      if (immediate) flush(id)
      else merged.timer = window.setTimeout(() => flush(id), SAVE_DELAY_MS)
    },
    [flush],
  )

  const cancelPending = useCallback((id: string) => {
    const p = pending.current.get(id)
    if (p) window.clearTimeout(p.timer)
    pending.current.delete(id)
  }, [])

  // Flush unsaved edits on unmount.
  useEffect(() => {
    const store = pending.current
    return () => {
      for (const id of [...store.keys()]) flush(id)
    }
  }, [flush])

  const patchPin = useCallback(
    (id: string, attrs: Partial<Pin>, immediate = false) => {
      setPins((ps) => ps.map((p) => (p.id === id ? { ...p, ...attrs } : p)))
      schedule('pin', id, attrs, immediate)
    },
    [schedule],
  )

  const patchRegion = useCallback(
    (id: string, attrs: Partial<Region>, immediate = false) => {
      setRegions((rs) => rs.map((r) => (r.id === id ? { ...r, ...attrs } : r)))
      schedule('region', id, attrs, immediate)
    },
    [schedule],
  )

  // ---------- data loading ----------

  useEffect(() => {
    let cancelled = false
    Promise.all([listPins(page.id), listRegions(page.id)])
      .then(([p, r]) => {
        if (cancelled) return
        setPins(p)
        setRegions(r)
      })
      .catch((e: unknown) => {
        if (!cancelled) report(e)
      })
    return () => {
      cancelled = true
    }
  }, [page.id, report])

  // ---------- map init (StrictMode-safe: cleanup fully removes the instance) ----------

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const m = L.map(el, {
      crs: L.CRS.Simple,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 120,
      minZoom: -8,
      maxZoom: 4,
      zoomControl: false,
      attributionControl: false,
      maxBoundsViscosity: 0.75,
      boxZoom: false,
    })
    m.createPane(IMAGE_PANE).style.zIndex = '250'
    L.control.zoom({ position: 'bottomleft' }).addTo(m)
    const pinStore = pinLayers.current
    const regionStore = regionLayers.current
    setMap(m)
    return () => {
      pinStore.clear()
      regionStore.clear()
      m.off()
      m.remove()
      fittedRef.current = false
      setMap(null)
    }
  }, [])

  // Track overlay size for popup placement.
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const ro = new ResizeObserver(() => setSize({ w: root.clientWidth, h: root.clientHeight }))
    ro.observe(root)
    return () => ro.disconnect()
  }, [])

  // ---------- image overlay + view fitting ----------

  useEffect(() => {
    if (!map) return
    const el = containerRef.current
    const bounds = imageBounds(mapW, mapH)
    const overlay = L.imageOverlay(mapImageUrl(image.path), bounds, {
      pane: IMAGE_PANE,
      interactive: false,
      pmIgnore: true,
      className: 'wk-map-image',
    }).addTo(map)

    const fit = () => {
      if (!el || el.clientWidth === 0 || el.clientHeight === 0) return
      map.invalidateSize()
      const fitZoom = map.getBoundsZoom(bounds)
      // Allow zooming out a bit past "whole map" and well into large images.
      map.setMinZoom(Math.floor((fitZoom - 1) * 4) / 4)
      map.setMaxZoom(Math.max(2, Math.ceil(fitZoom) + 4))
      map.setMaxBounds(bounds.pad(0.5))
      map.fitBounds(bounds, { animate: false })
      fittedRef.current = true
    }
    fittedRef.current = false
    fit()

    const ro = new ResizeObserver(() => {
      if (!fittedRef.current) fit()
      else map.invalidateSize()
    })
    if (el) ro.observe(el)
    return () => {
      ro.disconnect()
      overlay.remove()
    }
  }, [map, image.path, mapW, mapH])

  // ---------- latest-handler ref (Leaflet listeners are bound once per layer) ----------

  const handlers = useRef({
    pinClick: (_id: string, _e: L.LeafletMouseEvent) => {},
    pinContext: (_id: string, _e: L.LeafletMouseEvent) => {},
    pinDragEnd: (_id: string) => {},
    regionClick: (_id: string, _e: L.LeafletMouseEvent) => {},
    regionEdit: (_id: string) => {},
    mapClick: (_e: L.LeafletMouseEvent) => {},
  })

  const openPage = useCallback(
    (targetId: string) => nav(`/project/${page.project_id}/page/${targetId}`),
    [nav, page.project_id],
  )

  // Plain clicks on linked pins/regions preview the target in the context panel;
  // full navigation only happens via the explicit "Open" affordance in the popup.
  const previewPage = useCallback((targetId: string) => usePanelStore.getState().openPreview(targetId), [])

  const createPinAt = useCallback(
    (ll: L.LatLng) => {
      const [x, y] = toPixel(ll, mapH)
      if (x < 0 || y < 0 || x > mapW || y > mapH) return
      createPin({
        map_page_id: page.id,
        x,
        y,
        target_page_id: null,
        label: null,
        color: null,
        icon: null,
      })
        .then((pin) => {
          setPins((ps) => [...ps, pin])
          setSelected({ kind: 'pin', id: pin.id })
        })
        .catch(report)
    },
    [mapH, mapW, page.id, report],
  )

  useLayoutEffect(() => {
    const wantsEditor = (e: L.LeafletMouseEvent) =>
      editShapes || e.originalEvent.altKey || e.originalEvent.shiftKey

    handlers.current = {
      pinClick: (id, e) => {
        if (mode !== 'none') return
        const pin = pins.find((p) => p.id === id)
        if (!pin) return
        if (canEdit && wantsEditor(e)) setSelected({ kind: 'pin', id })
        else if (pin.target_page_id) previewPage(pin.target_page_id)
        else if (canEdit) setSelected({ kind: 'pin', id })
      },
      pinContext: (id, e) => {
        if (!canEdit) return
        e.originalEvent.preventDefault()
        setMode('none')
        setSelected({ kind: 'pin', id })
      },
      pinDragEnd: (id) => {
        const rec = pinLayers.current.get(id)
        if (!rec) return
        const [rx, ry] = toPixel(rec.marker.getLatLng(), mapH)
        const x = clamp(rx, 0, mapW)
        const y = clamp(ry, 0, mapH)
        rec.marker.setLatLng(toLatLng(x, y, mapH))
        rec.posKey = `${x},${y},${mapH}`
        patchPin(id, { x, y }, true)
      },
      regionClick: (id, e) => {
        if (mode !== 'none') return
        const region = regions.find((r) => r.id === id)
        if (!region) return
        if (canEdit && wantsEditor(e)) setSelected({ kind: 'region', id })
        else if (region.target_page_id) previewPage(region.target_page_id)
        else if (canEdit) setSelected({ kind: 'region', id })
      },
      regionEdit: (id) => {
        const rec = regionLayers.current.get(id)
        if (!rec) return
        const points = polygonToPixels(rec.poly.getLatLngs(), mapH).map(
          ([x, y]) => [clamp(x, 0, mapW), clamp(y, 0, mapH)] as [number, number],
        )
        if (points.length < 3) return
        rec.geomKey = `${pointsKey(points)}|${mapH}`
        patchRegion(id, { points }, true)
      },
      mapClick: (e) => {
        if (mode === 'pin') {
          createPinAt(e.latlng)
          setMode('none')
        } else if (mode === 'none') {
          setSelected(null)
        }
      },
    }
  })

  // Map click listener (bound once per map instance).
  useEffect(() => {
    if (!map) return
    const onClick = (e: L.LeafletMouseEvent) => handlers.current.mapClick(e)
    map.on('click', onClick)
    return () => {
      map.off('click', onClick)
    }
  }, [map])

  // ---------- pins: sync Leaflet markers from React state ----------

  useEffect(() => {
    if (!map) return
    const layers = pinLayers.current
    const seen = new Set<string>()
    for (const pin of pins) {
      seen.add(pin.id)
      const isSel = pin.id === selPinId
      const posKey = `${pin.x},${pin.y},${mapH}`
      const iconKey = `${pin.color}|${pin.icon}|${!!pin.target_page_id}|${isSel}`
      let rec = layers.get(pin.id)
      if (!rec) {
        const id = pin.id
        const marker = L.marker(toLatLng(pin.x, pin.y, mapH), {
          icon: pinIcon(pin, isSel),
          draggable: canEdit,
          keyboard: false,
          riseOnHover: true,
          autoPan: true,
          pmIgnore: true,
        })
        marker.on('click', (e: L.LeafletMouseEvent) => handlers.current.pinClick(id, e))
        marker.on('contextmenu', (e: L.LeafletMouseEvent) => handlers.current.pinContext(id, e))
        marker.on('dragend', () => handlers.current.pinDragEnd(id))
        marker.addTo(map)
        rec = { marker, posKey, iconKey, label: undefined }
        layers.set(id, rec)
      } else {
        if (rec.posKey !== posKey) {
          rec.marker.setLatLng(toLatLng(pin.x, pin.y, mapH))
          rec.posKey = posKey
        }
        if (rec.iconKey !== iconKey) {
          rec.marker.setIcon(pinIcon(pin, isSel))
          rec.iconKey = iconKey
        }
      }
      const drag = rec.marker.dragging
      if (drag && drag.enabled() !== canEdit) {
        if (canEdit) drag.enable()
        else drag.disable()
      }
      rec.marker.setZIndexOffset(isSel ? 1000 : 0)
      const tipKey = `${pin.label ?? ''}|${!!pin.target_page_id}`
      if (rec.label !== tipKey) {
        rec.label = tipKey
        if (pin.label) {
          const html = tooltipHtml(pin.label, !!pin.target_page_id)
          if (rec.marker.getTooltip()) rec.marker.setTooltipContent(html)
          else rec.marker.bindTooltip(html, { direction: 'top', className: 'wk-tooltip' })
        } else {
          rec.marker.unbindTooltip()
        }
      }
    }
    for (const [id, rec] of layers) {
      if (!seen.has(id)) {
        rec.marker.off()
        rec.marker.remove()
        layers.delete(id)
      }
    }
  }, [map, pins, mapH, canEdit, selPinId])

  // ---------- regions: sync Leaflet polygons from React state ----------

  const regionsRef = useRef(regions)
  const selectedRef = useRef<string | null>(null)
  useLayoutEffect(() => {
    regionsRef.current = regions
    selectedRef.current = selRegionId
  })

  const editShapesActive = canEdit && editShapes

  useEffect(() => {
    if (!map) return
    const layers = regionLayers.current
    const seen = new Set<string>()
    const pmOpts = { allowSelfIntersection: false, snappable: false, draggable: false }
    for (const region of regions) {
      seen.add(region.id)
      const isSel = region.id === selRegionId
      const geomKey = `${pointsKey(region.points)}|${mapH}`
      const styleKey = `${region.color}|${region.opacity}|${isSel}`
      let rec = layers.get(region.id)
      if (!rec) {
        const id = region.id
        const poly = L.polygon(pointsToLatLngs(region.points, mapH), {
          ...regionStyle(region, isSel, false),
          className: 'wk-region',
          bubblingMouseEvents: false,
        })
        const restyle = (hover: boolean) => {
          const r = regionsRef.current.find((x) => x.id === id)
          if (r) poly.setStyle(regionStyle(r, selectedRef.current === id, hover))
        }
        poly.on('mouseover', () => {
          hoveredRegion.current = id
          restyle(true)
        })
        poly.on('mouseout', () => {
          if (hoveredRegion.current === id) hoveredRegion.current = null
          restyle(false)
        })
        poly.on('click', (e: L.LeafletMouseEvent) => handlers.current.regionClick(id, e))
        poly.on('contextmenu', (e: L.LeafletMouseEvent) => {
          if (!canEdit) return
          e.originalEvent.preventDefault()
          setMode('none')
          setSelected({ kind: 'region', id })
        })
        poly.on('pm:edit', () => handlers.current.regionEdit(id))
        poly.addTo(map)
        rec = { poly, geomKey, styleKey, label: undefined }
        layers.set(id, rec)
      } else {
        if (rec.geomKey !== geomKey) {
          const wasEditing = rec.poly.pm.enabled()
          if (wasEditing) rec.poly.pm.disable()
          rec.poly.setLatLngs(pointsToLatLngs(region.points, mapH))
          if (wasEditing) rec.poly.pm.enable(pmOpts)
          rec.geomKey = geomKey
        }
        if (rec.styleKey !== styleKey) {
          rec.poly.setStyle(regionStyle(region, isSel, hoveredRegion.current === region.id))
          rec.styleKey = styleKey
        }
      }
      const tipKey = `${region.label ?? ''}|${!!region.target_page_id}`
      if (rec.label !== tipKey) {
        rec.label = tipKey
        if (region.label) {
          const html = tooltipHtml(region.label, !!region.target_page_id)
          if (rec.poly.getTooltip()) rec.poly.setTooltipContent(html)
          else rec.poly.bindTooltip(html, { sticky: true, direction: 'top', className: 'wk-tooltip' })
        } else {
          rec.poly.unbindTooltip()
        }
      }
      // Geoman edit mode on region layers only.
      const editing = rec.poly.pm.enabled()
      if (editShapesActive && !editing) rec.poly.pm.enable(pmOpts)
      else if (!editShapesActive && editing) rec.poly.pm.disable()
    }
    for (const [id, rec] of layers) {
      if (!seen.has(id)) {
        if (rec.poly.pm.enabled()) rec.poly.pm.disable()
        rec.poly.off()
        rec.poly.remove()
        layers.delete(id)
      }
    }
  }, [map, regions, mapH, canEdit, selRegionId, editShapesActive])

  // ---------- polygon drawing (Geoman) ----------

  useEffect(() => {
    if (!map || mode !== 'draw') return
    const accent = themeToken('--accent')
    const onCreate = (e: { layer: L.Layer }) => {
      const layer = e.layer as L.Polygon
      const points = polygonToPixels(layer.getLatLngs(), mapH).map(
        ([x, y]) => [clamp(x, 0, mapW), clamp(y, 0, mapH)] as [number, number],
      )
      // Remove Geoman's temp layer; the region renders from React state.
      layer.remove()
      if (points.length < 3) return
      createRegion({
        map_page_id: page.id,
        points,
        target_page_id: null,
        label: null,
        color: null,
        opacity: DEFAULT_REGION_OPACITY,
      })
        .then((region) => {
          setRegions((rs) => [...rs, region])
          setSelected({ kind: 'region', id: region.id })
        })
        .catch(report)
    }
    const onDrawEnd = () => setMode((m) => (m === 'draw' ? 'none' : m))
    map.on('pm:create', onCreate)
    map.on('pm:drawend', onDrawEnd)
    map.pm.enableDraw('Polygon', {
      snappable: true,
      snapDistance: 12,
      allowSelfIntersection: false,
      continueDrawing: false,
      templineStyle: { color: accent },
      hintlineStyle: { color: accent, dashArray: [5, 5] },
      pathOptions: { color: accent, fillColor: accent, fillOpacity: DEFAULT_REGION_OPACITY },
    })
    return () => {
      map.off('pm:create', onCreate)
      map.off('pm:drawend', onDrawEnd)
      map.pm.disableDraw()
    }
  }, [map, mode, mapH, mapW, page.id, report])

  // ---------- keep the edit popup anchored while panning/zooming ----------

  useEffect(() => {
    if (!map || !selected) return
    const tick = () => setViewTick((t) => t + 1)
    map.on('move', tick)
    map.on('zoom', tick)
    map.on('resize', tick)
    return () => {
      map.off('move', tick)
      map.off('zoom', tick)
      map.off('resize', tick)
    }
  }, [map, selected])

  // ---------- keyboard ----------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (mode !== 'none') setMode('none')
      else if (selected) setSelected(null)
      else if (editShapes) setEditShapes(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, selected, editShapes])

  // ---------- actions ----------

  function toggleMode(next: Mode) {
    setSelected(null)
    setMode((m) => (m === next ? 'none' : next))
  }

  function removeSelected() {
    if (!selected) return
    const { id, kind } = selected
    cancelPending(id)
    setSelected(null)
    if (kind === 'pin') {
      setPins((ps) => ps.filter((p) => p.id !== id))
      deletePin(id).catch(report)
    } else {
      setRegions((rs) => rs.filter((r) => r.id !== id))
      deleteRegion(id).catch(report)
    }
  }

  // ---------- popup positioning ----------

  let popup: JSX.Element | null = null
  if (map && selected && canEdit) {
    const W = size.w || 800
    const H = size.h || 600
    let anchor: L.LatLngExpression | null = null
    if (selected.kind === 'pin') {
      const pin = pins.find((p) => p.id === selected.id)
      if (pin) anchor = toLatLng(pin.x, pin.y, mapH)
    } else {
      const region = regions.find((r) => r.id === selected.id)
      if (region && region.points.length > 0) {
        const xs = region.points.map((p) => p[0])
        const ys = region.points.map((p) => p[1])
        anchor = toLatLng(
          (Math.min(...xs) + Math.max(...xs)) / 2,
          (Math.min(...ys) + Math.max(...ys)) / 2,
          mapH,
        )
      }
    }
    if (anchor) {
      const pt = map.latLngToContainerPoint(anchor)
      // Narrow (phone) maps: shrink the popup to fit and let it overlap the anchor if it must.
      const popupW = Math.min(POPUP_W, W - 16)
      const placeLeft = pt.x + 24 + popupW > W - 8
      const left = clamp(placeLeft ? pt.x - 24 - popupW : pt.x + 24, 8, Math.max(8, W - popupW - 8))
      const top = clamp(pt.y - 40, 8, Math.max(8, H - 120))
      const common = {
        projectId: page.project_id,
        mapPageId: page.id,
        style: { left, top, width: popupW, maxHeight: Math.max(160, H - top - 8) },
        onDelete: removeSelected,
        onClose: () => setSelected(null),
        onOpenPage: openPage,
      }
      if (selected.kind === 'pin') {
        const pin = pins.find((p) => p.id === selected.id)
        if (pin)
          popup = (
            <EditPopup
              key={pin.id}
              kind="pin"
              item={pin}
              common={common}
              onChange={(attrs, immediate) => patchPin(pin.id, attrs, immediate)}
            />
          )
      } else {
        const region = regions.find((r) => r.id === selected.id)
        if (region)
          popup = (
            <EditPopup
              key={region.id}
              kind="region"
              item={region}
              common={common}
              onChange={(attrs, immediate) => patchRegion(region.id, attrs, immediate)}
            />
          )
      }
    }
  }

  const shownError = error ?? replaceError
  const rootCls = ['wk-map', mode === 'pin' && 'wk-map--place', mode === 'draw' && 'wk-map--draw']
    .filter(Boolean)
    .join(' ')

  return (
    <div className={rootCls} ref={rootRef}>
      <div className="wk-map__leaflet" ref={containerRef} />

      {canEdit && (
        <div className="wk-map-toolbar" role="toolbar" aria-label="Map tools">
          <button
            type="button"
            className={mode === 'pin' ? 'is-active' : ''}
            aria-pressed={mode === 'pin'}
            onClick={() => toggleMode('pin')}
            title="Add pin (click on the map)"
          >
            <span aria-hidden>📍</span>
            <span className="wk-tool-label">Add pin</span>
            <span className="wk-tool-label--short">Pin</span>
          </button>
          <button
            type="button"
            className={mode === 'draw' ? 'is-active' : ''}
            aria-pressed={mode === 'draw'}
            onClick={() => toggleMode('draw')}
            title="Draw a region polygon"
          >
            <span aria-hidden>⬠</span>
            <span className="wk-tool-label">Draw region</span>
            <span className="wk-tool-label--short">Region</span>
          </button>
          <button
            type="button"
            className={editShapes ? 'is-active' : ''}
            aria-pressed={editShapes}
            onClick={() => {
              setMode('none')
              setEditShapes((v) => !v)
            }}
            title="Edit region shapes; clicks open the editor instead of following links"
          >
            <span aria-hidden>✎</span>
            <span className="wk-tool-label">Edit shapes</span>
            <span className="wk-tool-label--short">Shapes</span>
          </button>
        </div>
      )}

      {mode !== 'none' && (
        <div className="wk-map-hint">
          {mode === 'pin'
            ? 'Click on the map to place a pin'
            : 'Click to add points · click the first point to finish'}
          <span className="wk-map-hint__esc">Esc to cancel</span>
        </div>
      )}
      {mode === 'none' && editShapes && canEdit && (
        <div className="wk-map-hint">
          Drag vertices to reshape · click a pin or region to edit it
          <span className="wk-map-hint__esc">Esc to exit</span>
        </div>
      )}

      {popup}

      {canEdit && (
        <div className="wk-map-corner">
          <button
            type="button"
            className="wk-map-replace"
            disabled={replacing}
            onClick={() => replaceInputRef.current?.click()}
            title="Replace the map image (pins and regions are kept)"
          >
            {replacing ? 'Uploading…' : (
              <>
                <span className="wk-tool-label">Replace map image</span>
                <span className="wk-tool-label--short">Replace image</span>
              </>
            )}
          </button>
          <input
            ref={replaceInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) onReplace(file)
            }}
          />
        </div>
      )}

      {shownError && (
        <div className="wk-map-error" role="alert">
          <span>{shownError}</span>
          <button
            type="button"
            className="wk-icon-btn"
            aria-label="Dismiss"
            onClick={() => {
              setError(null)
              onDismissError()
            }}
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}
