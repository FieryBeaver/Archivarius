import * as L from 'leaflet'

/*
 * Coordinate conversion between DB pixel space and Leaflet CRS.Simple.
 *
 * DB (contract): image pixels, origin top-left, x → right, y → down.
 * Leaflet CRS.Simple: lat grows upward, lng grows right. The image overlay is
 * placed at bounds [[0, 0], [mapH, mapW]], so one Leaflet unit = one pixel.
 *
 *   pixel (x, y)      → latLng [mapH - y, x]
 *   latLng (lat, lng) → pixel  (lng, mapH - lat)
 */

export function imageBounds(mapW: number, mapH: number): L.LatLngBounds {
  return new L.LatLngBounds([0, 0], [mapH, mapW])
}

export function toLatLng(x: number, y: number, mapH: number): L.LatLngTuple {
  return [mapH - y, x]
}

export function toPixel(ll: L.LatLng, mapH: number): [number, number] {
  return [Math.round(ll.lng), Math.round(mapH - ll.lat)]
}

export function pointsToLatLngs(points: [number, number][], mapH: number): L.LatLngTuple[] {
  return points.map(([x, y]) => toLatLng(x, y, mapH))
}

/** Reads the outer ring of a (possibly nested) polygon latlng array as pixel points. */
export function polygonToPixels(
  latlngs: L.LatLng[] | L.LatLng[][] | L.LatLng[][][],
  mapH: number,
): [number, number][] {
  let ring: unknown = latlngs
  while (Array.isArray(ring) && Array.isArray(ring[0])) ring = ring[0]
  return (ring as L.LatLng[]).map((ll) => toPixel(ll, mapH))
}

export function pointsKey(points: [number, number][]): string {
  return points.map(([x, y]) => `${x},${y}`).join(';')
}
