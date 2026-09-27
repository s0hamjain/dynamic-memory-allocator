/**
 * Cells over a side x side square in address order: left to right, top to
 * bottom. Maps a cell index to (x, y) and back.
 */

const cache = new Map()

/** { x: Uint16Array, y: Uint16Array, index: Int32Array (y * side + x -> cell) } */
export function layoutFor(side) {
  let L = cache.get(side)
  if (L) return L
  const n = side * side
  const x = new Uint16Array(n)
  const y = new Uint16Array(n)
  const index = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    x[i] = i % side
    y[i] = (i / side) | 0
    index[i] = i
  }
  L = { side, x, y, index }
  cache.set(side, L)
  return L
}

export const MAX_SIDE = 512

/**
 * Pick the grid for a heap of `bytes`: the smallest power-of-two square that
 * holds it at 16 bytes per cell, or coarser cells once the square hits
 * MAX_SIDE.
 */
export function gridFor(bytes) {
  let cellBytes = 16
  let cells = Math.max(1, Math.ceil(bytes / cellBytes))
  let side = 8
  while (side * side < cells && side < MAX_SIDE) side *= 2
  while (side * side < cells) {
    cellBytes *= 2
    cells = Math.ceil(bytes / cellBytes)
  }
  return { side, cellBytes, cells }
}
