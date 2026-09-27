/**
 * A byte-for-byte model of the allocator in ../../mm.c.
 *
 * It does not store heap bytes. Instead it tracks the same structures the C
 * code walks: the implicit block list (by address), the 15 segregated free
 * lists (with identical head-insertion order), mini blocks, and the brk.
 * Every placement decision matches mm.c, so the addresses shown in the
 * visualizer are the addresses mm.c itself would return (as offsets from
 * mem_heap_lo()).
 */

export const WSIZE = 8
export const DSIZE = 16
export const MIN_BLOCK_SIZE = 32
export const CHUNKSIZE = 1 << 12
export const NUM_LISTS = 15

const roundUp = (size, n) => n * Math.ceil(size / n)

/** Port of get_bucket_index(). */
export function bucketIndex(blockSize) {
  if (blockSize === DSIZE) return 0
  let idx = 1
  let search = Math.max(blockSize, MIN_BLOCK_SIZE)
  while (search > MIN_BLOCK_SIZE && idx < NUM_LISTS - 1) {
    search = Math.floor(search / 2)
    idx++
  }
  return idx
}

/** Human-readable size range served by each bucket. */
export function bucketRange(i) {
  if (i === 0) return [16, 16]
  if (i === 1) return [32, 32]
  const lo = 32 * 2 ** (i - 2) + 16
  if (i === NUM_LISTS - 1) return [lo, Infinity]
  return [lo, 32 * 2 ** (i - 1)]
}

export class Allocator {
  constructor() {
    this.reset()
  }

  reset() {
    this.brk = 0
    this.initialized = false
    this.byStart = new Map() // addr -> block
    this.byEnd = new Map() // end addr -> block
    this.heads = new Array(NUM_LISTS).fill(null)
    this.listLen = new Array(NUM_LISTS).fill(0)
    this.listBytes = new Array(NUM_LISTS).fill(0)
    this.allocBytes = 0 // bytes in allocated blocks (headers + padding + payload)
    this.liveBytes = 0 // bytes requested by the program
    this.liveCount = 0
    this.addrUses = null // optional Map addr -> times malloc returned it
    this.ev = null // what the last operation did (for annotation)
  }

  /* ---------- block bookkeeping ---------- */

  _makeBlock(addr, size, alloc) {
    const b = {
      addr, size, alloc, prev: null, next: null,
      id: -1, req: 0, op: -1,
    }
    this.byStart.set(addr, b)
    this.byEnd.set(addr + size, b)
    return b
  }

  _drop(b) {
    this.byStart.delete(b.addr)
    this.byEnd.delete(b.addr + b.size)
  }

  _resize(b, size) {
    this.byEnd.delete(b.addr + b.size)
    b.size = size
    this.byEnd.set(b.addr + size, b)
  }

  get epilogue() {
    return this.brk - WSIZE
  }

  nextBlock(b) {
    return this.byStart.get(b.addr + b.size) || null // null = epilogue
  }

  prevBlock(b) {
    return this.byEnd.get(b.addr) || null // null = prologue
  }

  /* ---------- free lists (add_free_block / remove_free_block) ---------- */

  _add(b) {
    const i = bucketIndex(b.size)
    b.bucket = i
    b.prev = null
    b.next = this.heads[i]
    if (b.next) b.next.prev = b
    this.heads[i] = b
    this.listLen[i]++
    this.listBytes[i] += b.size
  }

  _remove(b) {
    const i = b.bucket
    if (b.prev) b.prev.next = b.next
    else this.heads[i] = b.next
    if (b.next) b.next.prev = b.prev
    b.prev = b.next = null
    this.listLen[i]--
    this.listBytes[i] -= b.size
  }

  /* ---------- core algorithm ---------- */

  _coalesce(b) {
    const prev = this.prevBlock(b)
    const next = this.nextBlock(b)
    const prevFree = prev && !prev.alloc
    const nextFree = next && !next.alloc
    if (prevFree && nextFree) {
      this._remove(prev)
      this._remove(next)
      this._drop(b)
      this._drop(next)
      this._resize(prev, prev.size + b.size + next.size)
      return { block: prev, prevFree, nextFree }
    }
    if (prevFree) {
      this._remove(prev)
      this._drop(b)
      this._resize(prev, prev.size + b.size)
      return { block: prev, prevFree, nextFree }
    }
    if (nextFree) {
      this._remove(next)
      this._drop(next)
      this._resize(b, b.size + next.size)
      return { block: b, prevFree, nextFree }
    }
    return { block: b, prevFree, nextFree }
  }

  _extendHeap(size) {
    size = roundUp(size, DSIZE)
    const addr = this.epilogue // new block overwrites the old epilogue
    this.brk += size
    const b = this._makeBlock(addr, size, false)
    const { block } = this._coalesce(b)
    this._add(block)
    return block
  }

  _init() {
    this.brk = 2 * WSIZE // prologue footer + epilogue header
    this.initialized = true
    this._extendHeap(CHUNKSIZE)
  }

  _findFit(asize) {
    for (let i = bucketIndex(asize); i < NUM_LISTS; i++) {
      let best = null
      for (let b = this.heads[i]; b; b = b.next) {
        if (b.size >= asize) {
          if (!best || b.size < best.size) best = b
          if (b.size === asize) return best
        }
      }
      if (best) return best
    }
    return null
  }

  _split(b, asize) {
    const rest = b.size - asize
    if (rest >= MIN_BLOCK_SIZE || rest === DSIZE) {
      this._resize(b, asize)
      const r = this._makeBlock(b.addr + asize, rest, false)
      this._add(r)
      return r
    }
    return null
  }

  /** mm_malloc. Returns the allocated block (or null for size 0). */
  malloc(size, id = -1, op = -1) {
    const ev = { kind: 'malloc', req: size, asize: 0, extended: 0, fromBucket: -1, fitSize: 0, split: -1, splitSize: 0 }
    this.ev = ev
    const brk0 = this.brk
    if (!this.initialized) this._init()
    if (size === 0) return null
    let asize = roundUp(size + WSIZE, DSIZE)
    if (asize < DSIZE) asize = DSIZE
    ev.asize = asize
    let b = this._findFit(asize)
    if (b) {
      ev.fromBucket = b.bucket
    } else {
      b = this._extendHeap(Math.max(asize, CHUNKSIZE))
    }
    ev.extended = this.brk - brk0
    ev.fitSize = b.size
    this._remove(b)
    b.alloc = true
    const r = this._split(b, asize)
    if (r) {
      ev.split = r.addr
      ev.splitSize = r.size
    }
    b.id = id
    b.req = size
    b.op = op
    if (this.addrUses) this.addrUses.set(b.addr, (this.addrUses.get(b.addr) || 0) + 1)
    ev.addr = b.addr
    ev.size = b.size
    this.allocBytes += b.size
    this.liveBytes += size
    this.liveCount++
    return b
  }

  /** mm_free, given the block's address. */
  free(addr) {
    const ev = { kind: 'free', addr: -1, size: 0, freedAddr: -1, freedSize: 0, freedReq: 0, prevFree: false, nextFree: false }
    this.ev = ev
    const b = addr == null ? null : this.byStart.get(addr)
    if (!b || !b.alloc) return null
    this.allocBytes -= b.size
    this.liveBytes -= b.req
    this.liveCount--
    ev.freedAddr = b.addr
    ev.freedSize = b.size
    ev.freedReq = b.req
    b.alloc = false
    b.id = -1
    b.req = 0
    b.op = -1
    const { block, prevFree, nextFree } = this._coalesce(b)
    this._add(block)
    ev.prevFree = prevFree
    ev.nextFree = nextFree
    ev.addr = block.addr
    ev.size = block.size
    return block
  }

  /** mm_realloc: malloc new, copy, free old (exactly as mm.c does). */
  realloc(addr, size, id = -1, op = -1) {
    if (size === 0) {
      this.free(addr)
      this.ev = { ...this.ev, kind: 'realloc', m: null, f: this.ev }
      return null
    }
    const nb = this.malloc(size, id, op)
    const m = this.ev
    let f = null
    if (addr != null) {
      this.free(addr)
      f = this.ev
    }
    this.ev = { ...m, kind: 'realloc', m, f }
    return nb
  }

  /* ---------- queries ---------- */

  /** Where malloc(size) would land right now, without changing anything. */
  peek(size) {
    if (size <= 0) return null
    const asize = Math.max(DSIZE, roundUp(size + WSIZE, DSIZE))
    if (!this.initialized) return { addr: WSIZE, size: asize, grows: true }
    const b = this._findFit(asize)
    if (b) return { addr: b.addr, size: asize, grows: false, bucket: b.bucket }
    // extend_heap coalesces the new chunk with a trailing free block.
    const last = this.byEnd.get(this.epilogue)
    const addr = last && !last.alloc ? last.addr : this.epilogue
    return { addr, size: asize, grows: true }
  }

  largestFree() {
    for (let i = NUM_LISTS - 1; i >= 0; i--) {
      if (!this.heads[i]) continue
      let m = 0
      for (let b = this.heads[i]; b; b = b.next) if (b.size > m) m = b.size
      return m
    }
    return 0
  }

  freeCount() {
    let n = 0
    for (let i = 0; i < NUM_LISTS; i++) n += this.listLen[i]
    return n
  }

  /** All blocks in address order. */
  blocks() {
    const out = []
    if (!this.initialized) return out
    let b = this.byStart.get(WSIZE)
    while (b) {
      out.push(b)
      b = this.nextBlock(b)
    }
    return out
  }

  /** Free-list order for bucket i (what find_fit walks). */
  list(i) {
    const out = []
    for (let b = this.heads[i]; b; b = b.next) out.push(b)
    return out
  }

  /* ---------- checkpoints ---------- */

  /** Compact copy of the heap: 24 bytes per block (sizes are implied). */
  snapshot() {
    const blocks = this.blocks()
    const n = blocks.length
    const addr = new Float64Array(n)
    const req = new Float64Array(n) // 0 for free blocks
    const meta = new Int32Array(n * 2) // id, op
    blocks.forEach((b, k) => {
      addr[k] = b.addr
      req[k] = b.alloc ? b.req : 0
      meta[k * 2] = b.id
      meta[k * 2 + 1] = b.op
    })
    const lists = this.heads.map((_, i) => Float64Array.from(this.list(i), (b) => b.addr))
    return {
      brk: this.brk, initialized: this.initialized, addr, req, meta, lists,
      allocBytes: this.allocBytes, liveBytes: this.liveBytes, liveCount: this.liveCount,
    }
  }

  restore(s) {
    this.reset()
    this.brk = s.brk
    this.initialized = s.initialized
    const n = s.addr.length
    for (let k = 0; k < n; k++) {
      const end = k + 1 < n ? s.addr[k + 1] : this.epilogue
      const b = this._makeBlock(s.addr[k], end - s.addr[k], s.req[k] > 0)
      b.req = s.req[k]
      b.id = s.meta[k * 2]
      b.op = s.meta[k * 2 + 1]
    }
    // Rebuild each list tail-first so head insertion reproduces the order.
    s.lists.forEach((addrs) => {
      for (let k = addrs.length - 1; k >= 0; k--) this._add(this.byStart.get(addrs[k]))
    })
    this.allocBytes = s.allocBytes
    this.liveBytes = s.liveBytes
    this.liveCount = s.liveCount
  }
}
