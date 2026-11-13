/*
 * Minimal type declarations for the subset of Leaflet 1.9 used by the map
 * feature. The project does not ship @types/leaflet (and package.json is
 * frozen), so without this the `leaflet` import is an implicit `any` and fails
 * strict type-checking. Geoman's own .d.ts augments this module with `pm`.
 */
declare module 'leaflet' {
  export type LatLngTuple = [number, number]
  export type LatLngExpression = LatLng | LatLngTuple
  export type LatLngBoundsExpression = LatLngBounds | [LatLngTuple, LatLngTuple]
  export type PointTuple = [number, number]

  export class LatLng {
    constructor(lat: number, lng: number)
    lat: number
    lng: number
  }

  export class LatLngBounds {
    constructor(a: LatLngTuple, b: LatLngTuple)
    getCenter(): LatLng
    getNorth(): number
    getSouth(): number
    getEast(): number
    getWest(): number
    pad(ratio: number): LatLngBounds
  }

  export class Point {
    x: number
    y: number
  }

  export interface LeafletEvent {
    type: string
    target: unknown
  }

  export interface LeafletMouseEvent extends LeafletEvent {
    latlng: LatLng
    originalEvent: MouseEvent
  }

  export type LeafletEventHandlerFn = (e: LeafletEvent) => void

  export class Evented {
    on(type: string, fn: (e: any) => void, context?: unknown): this
    off(type?: string, fn?: (e: any) => void, context?: unknown): this
    fire(type: string, data?: unknown): this
  }

  export interface LayerOptions {
    pane?: string
    attribution?: string
  }

  export interface InteractiveLayerOptions extends LayerOptions {
    interactive?: boolean
    bubblingMouseEvents?: boolean
  }

  export interface TooltipOptions {
    direction?: 'right' | 'left' | 'top' | 'bottom' | 'center' | 'auto'
    offset?: PointTuple
    permanent?: boolean
    sticky?: boolean
    opacity?: number
    className?: string
  }

  export class Tooltip {
    setContent(content: string | HTMLElement): this
  }

  export class Layer extends Evented {
    addTo(map: Map): this
    remove(): this
    bindTooltip(content: string | HTMLElement, options?: TooltipOptions): this
    unbindTooltip(): this
    setTooltipContent(content: string | HTMLElement): this
    getTooltip(): Tooltip | undefined
    openTooltip(): this
    closeTooltip(): this
  }

  export interface Handler {
    enable(): this
    disable(): this
    enabled(): boolean
  }

  // ---- map ----

  export interface CRS {
    code?: string
  }
  export const CRS: {
    Simple: CRS
    EPSG3857: CRS
  }

  export interface MapOptions {
    crs?: CRS
    minZoom?: number
    maxZoom?: number
    zoomSnap?: number
    zoomDelta?: number
    wheelPxPerZoomLevel?: number
    zoomControl?: boolean
    attributionControl?: boolean
    maxBounds?: LatLngBoundsExpression
    maxBoundsViscosity?: number
    doubleClickZoom?: boolean
    boxZoom?: boolean
  }

  export interface FitBoundsOptions {
    padding?: PointTuple
    animate?: boolean
  }

  export class Map extends Evented {
    constructor(element: HTMLElement, options?: MapOptions)
    remove(): this
    addLayer(layer: Layer): this
    removeLayer(layer: Layer): this
    hasLayer(layer: Layer): boolean
    fitBounds(bounds: LatLngBoundsExpression, options?: FitBoundsOptions): this
    getBoundsZoom(bounds: LatLngBoundsExpression, inside?: boolean): number
    setMinZoom(zoom: number): this
    setMaxZoom(zoom: number): this
    getZoom(): number
    setMaxBounds(bounds: LatLngBoundsExpression | null): this
    invalidateSize(options?: boolean | { animate?: boolean }): this
    latLngToContainerPoint(latlng: LatLngExpression): Point
    getContainer(): HTMLElement
    createPane(name: string, container?: HTMLElement): HTMLElement
    getPane(name: string): HTMLElement | undefined
    doubleClickZoom: Handler
  }

  export type ControlPosition = 'topleft' | 'topright' | 'bottomleft' | 'bottomright'

  export class Control {
    addTo(map: Map): this
    remove(): this
  }

  export const control: {
    zoom(options?: { position?: ControlPosition; zoomInTitle?: string; zoomOutTitle?: string }): Control
  }

  export function map(element: HTMLElement, options?: MapOptions): Map

  // ---- image overlay ----

  export interface ImageOverlayOptions extends InteractiveLayerOptions {
    opacity?: number
    className?: string
    pmIgnore?: boolean
  }

  export class ImageOverlay extends Layer {
    setUrl(url: string): this
    setBounds(bounds: LatLngBounds): this
    getElement(): HTMLImageElement | undefined
    bringToBack(): this
  }

  export function imageOverlay(
    url: string,
    bounds: LatLngBoundsExpression,
    options?: ImageOverlayOptions,
  ): ImageOverlay

  // ---- markers ----

  export interface DivIconOptions {
    html?: string | HTMLElement
    className?: string
    iconSize?: PointTuple
    iconAnchor?: PointTuple
    tooltipAnchor?: PointTuple
  }

  export class DivIcon {
    options: DivIconOptions
  }

  export function divIcon(options?: DivIconOptions): DivIcon

  export interface MarkerOptions extends InteractiveLayerOptions {
    icon?: DivIcon
    draggable?: boolean
    keyboard?: boolean
    title?: string
    riseOnHover?: boolean
    autoPan?: boolean
    pmIgnore?: boolean
  }

  export class Marker extends Layer {
    getLatLng(): LatLng
    setLatLng(latlng: LatLngExpression): this
    setIcon(icon: DivIcon): this
    setZIndexOffset(offset: number): this
    getElement(): HTMLElement | undefined
    dragging?: Handler
  }

  export function marker(latlng: LatLngExpression, options?: MarkerOptions): Marker

  // ---- vector paths ----

  export interface PathOptions extends InteractiveLayerOptions {
    stroke?: boolean
    color?: string
    weight?: number
    opacity?: number
    fill?: boolean
    fillColor?: string
    fillOpacity?: number
    dashArray?: string | number[]
    className?: string
    pmIgnore?: boolean
  }

  export interface CircleMarkerOptions extends PathOptions {
    radius?: number
  }

  export class Path extends Layer {
    setStyle(style: PathOptions): this
    bringToFront(): this
    bringToBack(): this
  }

  export class Polyline extends Path {
    getLatLngs(): LatLng[] | LatLng[][] | LatLng[][][]
    setLatLngs(latlngs: LatLngExpression[] | LatLngExpression[][]): this
    getBounds(): LatLngBounds
  }

  export class Polygon extends Polyline {}

  export function polygon(
    latlngs: LatLngExpression[] | LatLngExpression[][],
    options?: PathOptions,
  ): Polygon
}
