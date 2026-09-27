<script setup>
/**
 * The heap as a field of 16-byte cells in address order (left to right, top
 * to bottom), drawn
 * straight into an ImageData buffer each frame and doubled onto a blurred
 * canvas for bloom. Cells flash on malloc / free / merge / heap growth, the
 * malloc control's ghost shows where best fit would land, and clicking a
 * block frees it.
 */
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { state, heap, plannedBytes, onOp, userFree } from '../store.js'
import { layoutFor, gridFor } from '../render/layouts.js'
import { WSIZE } from '../sim/allocator.js'
import { heapApi } from '../heapApi.js'

/* ---------- palette ---------- */
const pack = ([r, g, b]) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0
const P = {
  empty: pack([40, 46, 60]),
  edge: pack([60, 66, 80]),
  used: pack([78, 136, 220]),
  waste: pack([36, 62, 102]),
  free: pack([230, 116, 76]),
  tail: pack([26, 31, 41]),
  flashAlloc: pack([214, 232, 255]),
  flashFree: pack([255, 72, 40]),
  flashMerge: pack([255, 214, 110]),
  flashGrow: pack([150, 110, 255]),
  white: pack([255, 255, 255]),
}

function scale(c, f) {
  const r = Math.min(255, (c & 255) * f)
  const g = Math.min(255, ((c >> 8) & 255) * f)
  const b = Math.min(255, ((c >> 16) & 255) * f)
  return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0
}
function mix(a, b, t) {
  const u = 1 - t
  const r = (a & 255) * u + (b & 255) * t
  const g = ((a >> 8) & 255) * u + ((b >> 8) & 255) * t
  const bl = ((a >> 16) & 255) * u + ((b >> 16) & 255) * t
  return ((255 << 24) | (bl << 16) | (g << 8) | r) >>> 0
}
// Stable per-block brightness wobble so neighbouring blocks stay distinct.
const wobble = (addr) => 0.8 + ((((addr * 2654435761) >>> 0) % 997) / 997) * 0.32

/* ---------- grid ---------- */
const stage = ref(null)
const cv = ref(null)
const glow = ref(null)
const pointer = ref(false)
const callout = ref(null) // on-heap tag for the walkthrough

let W = 0
let H = 0
let ctx = null
let gctx = null
let img = null
let buf = null

let grid = { side: 8, cellBytes: 16, cells: 0 }
let L = layoutFor(8)
let base = new Uint32Array(64)
let heat = new Float32Array(64)
let heatCol = new Uint32Array(64)
let blocks = []
let hover = null // hovered allocated block
let revealAt = performance.now()

const view = { s: 1, ox: 0, oy: 0 }
let box = { x0: 0, y0: 0, x1: 8, y1: 8, key: '' }

function resizeArrays(n) {
  if (n <= base.length) return
  const h2 = new Float32Array(n)
  const c2 = new Uint32Array(n)
  h2.set(heat)
  c2.set(heatCol)
  base = new Uint32Array(n)
  heat = h2
  heatCol = c2
}

function ensureGrid(brk) {
  // Columns come from the biggest the heap will get, so cells never reflow.
  const g = gridFor(Math.max(brk, plannedBytes()))
  g.cells = Math.ceil(brk / g.cellBytes)
  if (g.cellBytes !== grid.cellBytes) {
    heat = new Float32Array(g.side * g.side)
    heatCol = new Uint32Array(g.side * g.side)
    base = new Uint32Array(g.side * g.side)
  }
  grid = g
  L = layoutFor(g.side)
  resizeArrays(g.side * g.side)
}

/** Bounding box of the cells in use; the view frames it and eases as it grows. */
function usedBox() {
  const n = Math.max(1, grid.cells)
  const key = grid.side + ':' + n
  if (box.key === key) return box
  let x0 = Infinity
  let y0 = Infinity
  let x1 = 0
  let y1 = 0
  const step = Math.max(1, (n / 20000) | 0)
  for (let i = 0; i < n; i += step) {
    const x = L.x[i]
    const y = L.y[i]
    if (x < x0) x0 = x
    if (y < y0) y0 = y
    if (x > x1) x1 = x
    if (y > y1) y1 = y
  }
  const lx = L.x[n - 1]
  const ly = L.y[n - 1]
  box = { x0: Math.min(x0, lx), y0: Math.min(y0, ly), x1: Math.max(x1, lx) + 1, y1: Math.max(y1, ly) + 1, key }
  const minSpan = Math.max(4, grid.side / 4)
  if (box.x1 - box.x0 < minSpan) box.x1 = box.x0 + minSpan
  if (box.y1 - box.y0 < minSpan) box.y1 = box.y0 + minSpan
  return box
}

function rebuild() {
  const a = heap()
  if (!a) return
  ensureGrid(a.brk)
  const cb = grid.cellBytes
  const N = grid.cells
  blocks = a.blocks()
  base.fill(P.edge, 0, N)
  const epi = a.epilogue
  for (const b of blocks) {
    const c0 = Math.floor(b.addr / cb)
    const c1 = Math.min(N, Math.ceil((b.addr + b.size) / cb))
    if (!b.alloc) {
      base.fill(b.addr + b.size === epi ? P.tail : P.free, c0, c1)
      continue
    }
    // Requested bytes in bright blue; header + alignment padding darker.
    const w = wobble(b.addr)
    const pEnd = Math.min(c1, Math.ceil((b.addr + WSIZE + b.req) / cb))
    base[c0] = scale(P.used, w * 0.62)
    if (pEnd > c0 + 1) base.fill(scale(P.used, w), c0 + 1, pEnd)
    if (c1 > pEnd) base.fill(scale(P.waste, w), Math.max(pEnd, c0 + 1), c1)
  }
}

/* ---------- flashes ---------- */
let hot = false
function mark(addr, size, color, strength = 1) {
  const cb = grid.cellBytes
  const c0 = Math.max(0, Math.floor(addr / cb))
  const c1 = Math.min(heat.length, Math.ceil((addr + size) / cb))
  for (let i = c0; i < c1; i++) {
    heat[i] = strength
    heatCol[i] = color
  }
  hot = true
}

const off = onOp((ev) => {
  if (ev.kind === 'reset' || ev.kind === 'restart') {
    heat.fill(0)
    if (ev.kind === 'restart') revealAt = performance.now()
    kick()
    return
  }
  const a = heap()
  ensureGrid(a.brk)
  const m = ev.kind === 'realloc' ? ev.m : ev.kind === 'malloc' ? ev : null
  const f = ev.kind === 'realloc' ? ev.f : ev.kind === 'free' ? ev : null
  if (m && m.extended) mark(a.brk - WSIZE - m.extended, m.extended, P.flashGrow, 0.85)
  if (f && f.addr >= 0) mark(f.addr, f.size, f.prevFree || f.nextFree ? P.flashMerge : P.flashFree, 1)
  if (m && m.addr != null) mark(m.addr, m.size, P.flashAlloc, 1)
  kick()
})

/* ---------- frame loop ---------- */
let raf = 0
let lastT = 0
let dirty = true

function kick() {
  if (!raf) {
    lastT = performance.now()
    raf = requestAnimationFrame(frame)
  }
}

function target() {
  const b = usedBox()
  const s = Math.min(W / (b.x1 - b.x0), H / (b.y1 - b.y0)) * 0.92
  return { s, ox: W / 2 - ((b.x0 + b.x1) / 2) * s, oy: H / 2 - ((b.y0 + b.y1) / 2) * s }
}

function frame(t) {
  raf = 0
  const dt = Math.min(0.1, (t - lastT) / 1000)
  lastT = t
  if (dirty) {
    rebuild()
    dirty = false
  }
  const T = target()
  const k = 1 - Math.pow(0.001, dt)
  view.s += (T.s - view.s) * k
  view.ox += (T.ox - view.ox) * k
  view.oy += (T.oy - view.oy) * k
  const settling = Math.abs(T.s - view.s) > 0.002 * T.s || Math.abs(T.ox - view.ox) > 0.3 || Math.abs(T.oy - view.oy) > 0.3
  if (!settling) Object.assign(view, T)
  const revealing = t - revealAt < 1200
  draw(dt, t)
  updateCallout()
  if (hot || settling || revealing || state.probing || hover) raf = requestAnimationFrame(frame)
}

function draw(dt, t) {
  if (!buf) return
  buf.fill(0)
  const side = grid.side
  const total = side * side
  const N = grid.cells
  const s = view.s
  const gap = s >= 7 ? 1 : 0
  const decay = Math.pow(0.03, dt / 0.9)
  let anyHot = false

  // Ghost from the malloc control: everything else dims.
  let g0 = -1
  let g1 = -1
  let gp = 0
  if (state.probing) {
    const p = heap()?.peek(state.probeSize)
    if (p) {
      g0 = Math.floor(p.addr / grid.cellBytes)
      g1 = Math.ceil((p.addr + p.size) / grid.cellBytes)
      gp = 0.6 + 0.3 * Math.sin(t / 130)
    }
  }
  let h0 = -1
  let h1 = -1
  if (hover && !state.probing) {
    h0 = Math.floor(hover.addr / grid.cellBytes)
    h1 = Math.ceil((hover.addr + hover.size) / grid.cellBytes)
  }
  // Load-in: cells appear along the curve.
  const reveal = Math.min(1, (t - revealAt) / 1100)
  const shown = reveal >= 1 ? total : Math.floor(total * reveal * reveal)
  const drawEmpty = s >= 2

  for (let i = 0; i < shown; i++) {
    let c
    if (i < N) {
      c = base[i]
      const h = heat[i]
      if (h > 0.004) {
        c = mix(c, heatCol[i], h)
        heat[i] = h * decay
        anyHot = true
      }
      if (g1 >= 0) c = i >= g0 && i < g1 ? mix(c, P.white, gp) : scale(c, 0.4)
      else if (i >= h0 && i < h1) c = mix(c, P.white, 0.35)
    } else if (i >= g0 && i < g1) {
      c = mix(P.empty, P.flashGrow, gp)
    } else if (drawEmpty) {
      c = -1
    } else continue

    const x = L.x[i]
    const y = L.y[i]
    let px0 = (view.ox + x * s) | 0
    let py0 = (view.oy + y * s) | 0
    let px1 = ((view.ox + (x + 1) * s) | 0) - gap
    let py1 = ((view.oy + (y + 1) * s) | 0) - gap
    if (c === -1) {
      // Address space the heap hasn't reached yet: a faint dot.
      const d = s >= 9 ? 2 : 1
      const cx = ((px0 + px1) >> 1) - (d >> 1)
      const cy = ((py0 + py1) >> 1) - (d >> 1)
      if (cx < 0 || cy < 0 || cx + d > W || cy + d > H) continue
      for (let yy = cy; yy < cy + d; yy++) buf.fill(P.empty, yy * W + cx, yy * W + cx + d)
      continue
    }
    if (px1 <= px0) px1 = px0 + 1
    if (py1 <= py0) py1 = py0 + 1
    if (px1 <= 0 || py1 <= 0 || px0 >= W || py0 >= H) continue
    if (px0 < 0) px0 = 0
    if (py0 < 0) py0 = 0
    if (px1 > W) px1 = W
    if (py1 > H) py1 = H
    for (let yy = py0; yy < py1; yy++) buf.fill(c, yy * W + px0, yy * W + px1)
  }
  hot = anyHot
  ctx.putImageData(img, 0, 0)
  gctx.clearRect(0, 0, W, H)
  gctx.drawImage(cv.value, 0, 0)
}

/** Stage-space box around the cells covering [addr, addr + size). */
function boxOf(addr, size, limit) {
  const cb = grid.cellBytes
  const c0 = Math.floor(addr / cb)
  const c1 = Math.min(limit, Math.ceil((addr + size) / cb))
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -1
  let y1 = -1
  for (let i = c0; i < c1; i++) {
    x0 = Math.min(x0, L.x[i])
    y0 = Math.min(y0, L.y[i])
    x1 = Math.max(x1, L.x[i])
    y1 = Math.max(y1, L.y[i])
  }
  if (x1 < 0) return null
  const s = view.s
  return { x: view.ox + x0 * s, y: view.oy + y0 * s, w: (x1 - x0 + 1) * s, h: (y1 - y0 + 1) * s }
}

heapApi.rectOf = (addr, size) => {
  const b = stage.value && boxOf(addr, size, grid.side * grid.side)
  if (!b) return null
  const r = stage.value.getBoundingClientRect()
  return { x: r.left + b.x, y: r.top + b.y, w: b.w, h: b.h }
}

/** Screen-space box around the walkthrough's focus block. */
function updateCallout() {
  const f = state.focus
  const b = f && boxOf(f.addr, f.size, grid.cells)
  if (!b) {
    if (callout.value) callout.value = null
    return
  }
  const r = {
    x: Math.round(b.x) - 4,
    y: Math.round(b.y) - 4,
    w: Math.round(b.w) + 7,
    h: Math.round(b.h) + 7,
    tag: f.tag,
  }
  r.below = r.y < 40
  // Keep the tag on screen: hug the left/right edge when the box is near it.
  const mid = r.x + r.w / 2
  r.align = mid < 90 ? 'left' : mid > W - 90 ? 'right' : ''
  const o = callout.value
  if (!o || o.x !== r.x || o.y !== r.y || o.w !== r.w || o.h !== r.h || o.tag !== r.tag) callout.value = r
}

/* ---------- sizing ---------- */
let ro = null
function resize() {
  const r = stage.value.getBoundingClientRect()
  W = Math.max(1, Math.floor(r.width))
  H = Math.max(1, Math.floor(r.height))
  for (const c of [cv.value, glow.value]) {
    c.width = W
    c.height = H
  }
  ctx = cv.value.getContext('2d')
  gctx = glow.value.getContext('2d')
  img = ctx.createImageData(W, H)
  buf = new Uint32Array(img.data.buffer)
  dirty = true
  Object.assign(view, target())
  kick()
}

onMounted(() => {
  ro = new ResizeObserver(resize)
  ro.observe(stage.value)
})
onBeforeUnmount(() => {
  ro?.disconnect()
  cancelAnimationFrame(raf)
  off()
})

watch(() => state.tick, () => {
  dirty = true
  kick()
})
watch(() => state.name, () => {
  revealAt = performance.now()
  kick()
})
watch(() => [state.probing, state.probeSize, state.focus], kick)

/* ---------- pointer ---------- */
function blockAt(ev) {
  const r = stage.value.getBoundingClientRect()
  const x = Math.floor((ev.clientX - r.left - view.ox) / view.s)
  const y = Math.floor((ev.clientY - r.top - view.oy) / view.s)
  if (x < 0 || y < 0 || x >= grid.side || y >= grid.side) return null
  const i = L.index[y * grid.side + x]
  if (i >= grid.cells) return null
  const a = i * grid.cellBytes + grid.cellBytes / 2
  let lo = 0
  let hi = blocks.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const b = blocks[mid]
    if (a < b.addr) hi = mid - 1
    else if (a >= b.addr + b.size) lo = mid + 1
    else return b
  }
  return null
}

// Press on a blue block to free it; keep the button down and swipe to free
// every block the pointer crosses.
let sweeping = false

function freeUnder(ev) {
  const b = blockAt(ev)
  if (!b || !b.alloc) return false
  userFree(b.addr)
  hover = null
  pointer.value = false
  return true
}
function onDown(ev) {
  if (state.mode === 'tour') return
  if (freeUnder(ev)) {
    sweeping = true
    stage.value.setPointerCapture(ev.pointerId)
  }
}
function onMove(ev) {
  if (state.mode === 'tour') return
  if (sweeping) {
    freeUnder(ev)
    return
  }
  const b = blockAt(ev)
  const next = b && b.alloc ? b : null
  if (next !== hover) {
    hover = next
    pointer.value = !!next
    kick()
  }
}
function onUp() {
  sweeping = false
}
function onLeave() {
  hover = null
  pointer.value = false
}
</script>

<template>
  <div
    ref="stage"
    class="stage"
    :class="{ pointer }"
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onUp"
    @pointerleave="onLeave"
  >
    <canvas ref="cv" class="main" role="img" aria-label="The heap. Blue blocks are in use; click one to free it." />
    <canvas ref="glow" class="glow" aria-hidden="true" />
    <div
      v-if="callout"
      :key="callout.tag"
      class="callout"
      :style="{ left: callout.x + 'px', top: callout.y + 'px', width: callout.w + 'px', height: callout.h + 'px' }"
    >
      <span class="tag" :class="[callout.align, { below: callout.below }]">{{ callout.tag }}</span>
    </div>
  </div>
</template>

<style scoped>
.stage { position: absolute; inset: 0; overflow: hidden; touch-action: none; }
.stage.pointer { cursor: pointer; }
canvas { position: absolute; inset: 0; width: 100%; height: 100%; image-rendering: pixelated; }
.callout {
  position: absolute; z-index: 3; pointer-events: none; border-radius: 6px;
  border: 2px solid rgba(255, 255, 255, 0.9);
  transition: left 0.3s ease, top 0.3s ease, width 0.3s ease, height 0.3s ease;
  animation: pop 0.35s ease-out, pulse 1.6s ease-in-out 0.35s infinite;
}
.tag {
  position: absolute; left: 50%; bottom: calc(100% + 8px); transform: translateX(-50%);
  padding: 5px 10px; border-radius: 8px; background: #fff; color: #07080b; white-space: nowrap;
  font: 600 13px/1 var(--mono); box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
}
.tag::after {
  content: ''; position: absolute; left: 50%; top: 100%; margin-left: -5px;
  border: 5px solid transparent; border-top-color: #fff;
}
.tag.left { left: 0; transform: none; }
.tag.right { left: auto; right: 0; transform: none; }
.tag.left::after { left: 14px; }
.tag.right::after { left: auto; right: 9px; }
.tag.below { bottom: auto; top: calc(100% + 8px); }
.tag.below::after { top: auto; bottom: 100%; border-top-color: transparent; border-bottom-color: #fff; }
@keyframes pop { from { opacity: 0; transform: scale(1.25); } }
@keyframes pulse { 50% { border-color: rgba(255, 255, 255, 0.5); } }
.glow { pointer-events: none; filter: blur(10px); opacity: 0.16; mix-blend-mode: screen; }
</style>
