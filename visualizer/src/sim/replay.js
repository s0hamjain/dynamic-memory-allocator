/**
 * Trace replay on top of the Allocator model.
 *
 * analyze() runs the whole trace once, recording per-step metrics for the
 * timeline charts, per-op results for the op log, and periodic checkpoints.
 * A Replayer then uses those checkpoints to jump to any step quickly
 * (restore the nearest checkpoint, then re-run a short stretch of ops).
 */
import { Allocator } from './allocator.js'
import { OP_ALLOC, OP_FREE, OP_REALLOC } from './trace.js'

export const F_EXTENDED = 1 // sbrk was called
export const F_SPLIT = 2 // the chosen block was split
export const F_COALESCED = 4 // a free merged with a neighbour
export const F_FROM_LIST = 8 // alloc satisfied from the free lists
export const F_RECYCLED = 16 // alloc returned an address used before

const CHECKPOINT_BUDGET = 48 * 2 ** 20 // bytes of snapshot data per trace
const MIN_CHECKPOINT_GAP = 500

/** Apply op i of the trace to the allocator; ptr maps id -> address. */
export function applyOp(a, trace, ptr, i) {
  const t = trace.type[i]
  const id = trace.id[i]
  if (t === OP_ALLOC) {
    const b = a.malloc(trace.size[i], id, i)
    ptr[id] = b ? b.addr : -1
  } else if (t === OP_FREE) {
    a.free(id >= 0 && ptr[id] >= 0 ? ptr[id] : null)
    if (id >= 0) ptr[id] = -1
  } else if (t === OP_REALLOC) {
    const b = a.realloc(ptr[id] >= 0 ? ptr[id] : null, trace.size[i], id, i)
    ptr[id] = b ? b.addr : -1
  }
  return a.ev
}

export function analyze(trace, onProgress) {
  const n = trace.numOps
  const a = new Allocator()
  a.addrUses = new Map()
  const ptr = new Float64Array(trace.numIds).fill(-1)

  // Per step s = state after s ops (index 0 is the untouched heap).
  const heap = new Float64Array(n + 1)
  const live = new Float64Array(n + 1)
  const peak = new Float64Array(n + 1)
  const allocBytes = new Float64Array(n + 1)
  const freeBlocks = new Uint32Array(n + 1)
  const largest = new Float64Array(n + 1)
  // Per op i.
  const opAddr = new Float64Array(n).fill(-1)
  const opSize = new Float64Array(n)
  const opFlags = new Uint8Array(n)
  const opGen = new Uint32Array(n) // how many times malloc has returned opAddr
  // Running totals, per step.
  const cumMallocs = new Uint32Array(n + 1)
  const cumFromList = new Uint32Array(n + 1)
  const cumRecycled = new Uint32Array(n + 1)

  const checkpoints = [{ step: 0, state: a.snapshot() }]
  let nextCheckpoint = MIN_CHECKPOINT_GAP

  let pk = 0
  let mallocs = 0
  let fromList = 0
  let recycled = 0
  let sbrks = 0
  for (let i = 0; i < n; i++) {
    const ev = applyOp(a, trace, ptr, i)
    const s = i + 1
    heap[s] = a.brk
    live[s] = a.liveBytes
    if (a.liveBytes > pk) pk = a.liveBytes
    peak[s] = pk
    allocBytes[s] = a.allocBytes
    freeBlocks[s] = a.freeCount()
    largest[s] = a.largestFree()

    let f = 0
    const fev = ev.kind === 'free' ? ev : ev.f
    if (fev && (fev.prevFree || fev.nextFree)) f |= F_COALESCED
    if (ev.kind !== 'free' && ev.addr != null) {
      mallocs++
      if (ev.extended) {
        f |= F_EXTENDED
        sbrks++
      } else {
        f |= F_FROM_LIST
        fromList++
      }
      if (ev.split >= 0) f |= F_SPLIT
      const g = a.addrUses.get(ev.addr)
      opGen[i] = g
      if (g > 1) {
        f |= F_RECYCLED
        recycled++
      }
      opAddr[i] = ev.addr
      opSize[i] = ev.size
    } else if (ev.kind === 'free' && ev.addr >= 0) {
      opAddr[i] = ev.freedAddr
      opSize[i] = ev.freedSize
    }
    opFlags[i] = f
    cumMallocs[s] = mallocs
    cumFromList[s] = fromList
    cumRecycled[s] = recycled

    if (s >= nextCheckpoint && s < n) {
      const state = a.snapshot()
      checkpoints.push({ step: s, state })
      const cost = state.addr.length * 24 + 1024
      nextCheckpoint = s + Math.max(MIN_CHECKPOINT_GAP, Math.ceil((cost * n) / CHECKPOINT_BUDGET))
    }
    if (onProgress && (i & 8191) === 0) onProgress(i / n)
  }

  return {
    n, heap, live, peak, allocBytes, freeBlocks, largest,
    opAddr, opSize, opFlags, opGen, cumMallocs, cumFromList, cumRecycled, checkpoints,
    summary: {
      finalHeap: a.brk,
      peakLive: pk,
      utilization: a.brk ? pk / a.brk : 0,
      mallocs, fromList, recycled, sbrks,
    },
  }
}

/** Every transferable buffer in an analysis, for postMessage. */
export function transferList(r) {
  const out = [r.heap, r.live, r.peak, r.allocBytes, r.freeBlocks, r.largest,
    r.opAddr, r.opSize, r.opFlags, r.opGen, r.cumMallocs, r.cumFromList, r.cumRecycled].map((x) => x.buffer)
  for (const { state } of r.checkpoints) {
    out.push(state.addr.buffer, state.req.buffer, state.meta.buffer)
    for (const l of state.lists) out.push(l.buffer)
  }
  return out
}

export class Replayer {
  constructor(trace, analysis) {
    this.trace = trace
    this.analysis = analysis
    this.a = new Allocator()
    this.ptr = new Float64Array(trace.numIds).fill(-1)
    this.step = 0
    this.ev = null
    this._restore(analysis.checkpoints[0])
  }

  _restore(cp) {
    this.a.restore(cp.state)
    this.ptr.fill(-1)
    for (const b of this.a.byStart.values()) if (b.alloc && b.id >= 0) this.ptr[b.id] = b.addr
    this.step = cp.step
    this.ev = null
  }

  /** How many times malloc has returned this allocated block's address. */
  gen(b) {
    return b.op >= 0 ? this.analysis.opGen[b.op] : 0
  }

  /** Move to the state after `target` ops. onEv(ev, i) sees each op re-run. */
  seek(target, onEv) {
    target = Math.max(0, Math.min(this.analysis.n, target))
    if (target === this.step) return
    const cps = this.analysis.checkpoints
    let lo = 0
    let hi = cps.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (cps[mid].step < target) lo = mid // strictly before, so ev is set
      else hi = mid - 1
    }
    // Jump when going backwards, or when a checkpoint saves real work.
    if (target < this.step || cps[lo].step > this.step + 64) this._restore(cps[lo])
    while (this.step < target) {
      this.ev = applyOp(this.a, this.trace, this.ptr, this.step)
      if (onEv) onEv(this.ev, this.step)
      this.step++
    }
  }
}
