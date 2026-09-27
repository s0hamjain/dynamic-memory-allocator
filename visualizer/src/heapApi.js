/** Lets other components ask the heap view where things are on screen. */
export const heapApi = {
  /** Client-space rect of the cells covering [addr, addr + size), or null. */
  rectOf: () => null,
}
