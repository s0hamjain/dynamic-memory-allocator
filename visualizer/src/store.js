/**
 * App state. Three modes share one heap view:
 *
 *   tour       - the "How it works" walkthrough: a tiny scripted program
 *   programs   - replay a real trace; clicking a block forks a private copy
 *   playground - a free-form heap the user builds and breaks by hand
 *
 * The allocator models live outside Vue's reactivity; components watch
 * `state.tick` (bumps whenever the visible heap changes) and listen to
 * individual allocator events through onOp() to animate them.
 */
import { reactive, shallowRef, markRaw } from 'vue'
import { Replayer } from './sim/replay.js'
import { Allocator } from './sim/allocator.js'
import { DEFAULT_PROGRAM } from './programs.js'
import { STEPS } from './tutorial.js'

const loaders = import.meta.glob('../traces/*.rep', { query: '?raw', import: 'default' })

export const state = reactive({
  mode: 'tour', // tour | programs | playground
  status: 'idle', // program loading: idle | loading | ready | error
  error: '',
  name: '',
  step: 0,
  n: 0,
  playing: false,
  speed: 3,
  tick: 0,
  throughput: 0, // the loaded program's
  baseThroughput: 0, // the default program's, shown outside programs mode
  probeSize: 128,
  probing: false,
  edited: false, // programs mode: the user has changed the heap
  tutorial: 0, // walkthrough step
  focus: null, // { addr, size, tag } the walkthrough is pointing at
})

export const analysis = shallowRef(null)
let replayer = null

/* ---------- op events (drive the flashes) ---------- */

const listeners = new Set()
export function onOp(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const emit = (ev) => listeners.forEach((fn) => fn(ev))

/* ---------- the heap on screen ---------- */

const mine = { a: null } // programs mode, after the user edits
const tut = { a: null, ids: {} }
const pg = { a: null }

export function heap() {
  if (state.mode === 'tour') return tut.a
  if (state.mode === 'playground') return pg.a
  return state.edited ? mine.a : replayer?.a
}

/** The largest heap this view will need, so the grid rarely has to reflow. */
export function plannedBytes() {
  const a = heap()
  const now = a ? a.brk : 0
  if (state.mode === 'tour') return Math.max(now, 10 * 1024)
  if (state.mode === 'playground') return Math.max(now, 16 * 1024)
  const planned = analysis.value ? analysis.value.heap[analysis.value.n] : 0
  return Math.max(planned, now)
}

/**
 * Share of the heap holding real data. Programs report their fullest moment
 * (the malloc-lab definition); the tour and playground report right now.
 */
export function utilization() {
  const a = heap()
  if (!a || !a.brk) return 0
  if (state.mode === 'programs' && !state.edited) return analysis.value.peak[state.step] / a.brk
  return a.liveBytes / a.brk
}

/* ---------- loading programs ---------- */

let worker = null
let token = 0

function analyzeText(text, name) {
  if (!worker) worker = new Worker(new URL('./sim/worker.js', import.meta.url), { type: 'module' })
  const my = ++token
  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      if (data.token !== my || data.progress != null) return
      if (data.error) reject(new Error(data.error))
      else resolve(data)
    }
    worker.postMessage({ text, name, token: my })
  })
}

let loadSeq = 0
async function load(getText, name, autoplay = true) {
  pause()
  state.edited = false
  state.status = 'loading'
  state.error = ''
  state.name = name
  const my = ++loadSeq
  try {
    const data = await analyzeText(await getText(), name)
    if (my !== loadSeq) return
    analysis.value = markRaw(data.analysis)
    replayer = new Replayer(data.trace, data.analysis)
    state.n = data.analysis.n
    state.step = 0
    state.throughput = data.analysis.throughput
    if (name === DEFAULT_PROGRAM && !state.baseThroughput) state.baseThroughput = state.throughput
    // Short programs play slowly enough to follow; long ones take ~30 s.
    state.speed = state.n <= 100 ? 2.5 : Math.max(20, Math.round(state.n / 30))
    state.status = 'ready'
    if (state.mode === 'programs') {
      state.tick++
      emit({ kind: 'restart' })
      if (autoplay) setTimeout(play, 500)
    }
  } catch (e) {
    if (my !== loadSeq) return
    state.status = 'error'
    state.error = e.message
  }
}

export function loadProgram(name) {
  const loader = loaders[`../traces/${name}.rep`]
  if (!loader) return
  setMode('programs', false)
  load(loader, name)
}
export function loadFile(file) {
  setMode('programs', false)
  load(() => file.text(), file.name.replace(/\.rep$/, ''))
}
/** Load the default program without showing it (for its throughput number). */
export const preloadDefault = () => load(loaders[`../traces/${DEFAULT_PROGRAM}.rep`], DEFAULT_PROGRAM, false)

/* ---------- modes ---------- */

export function setMode(mode, autoplay = true) {
  if (state.mode === mode) return
  pause()
  if (state.mode === 'programs' && state.edited) {
    state.edited = false
    mine.a = null
  }
  state.mode = mode
  state.focus = null
  state.probing = false
  if (mode === 'tour') runTutorial((state.tutorial = 0))
  if (mode === 'playground' && !pg.a) resetPlayground(false)
  state.tick++
  emit({ kind: 'restart' })
  if (mode === 'programs' && replayer && autoplay) {
    replayer.seek(0)
    state.step = 0
    setTimeout(play, 400)
  }
}

/* ---------- replay ---------- */

export function seek(step) {
  if (!replayer || state.mode !== 'programs') return
  if (state.edited) backToProgram()
  step = Math.max(0, Math.min(state.n, Math.round(step)))
  const d = step - replayer.step
  if (d > 0 && d <= 800) replayer.seek(step, emit)
  else {
    replayer.seek(step)
    if (d) emit({ kind: 'reset' })
  }
  state.step = step
  state.tick++
}

let raf = 0
let last = 0
let carry = 0
let loopTimer = 0

/** At the end, linger a moment, then replay from the start. */
function scheduleLoop() {
  clearTimeout(loopTimer)
  loopTimer = setTimeout(() => {
    if (state.playing || state.edited || state.mode !== 'programs' || state.step < state.n) return
    replayer.seek(0)
    state.step = 0
    state.tick++
    emit({ kind: 'restart' })
    play()
  }, 2200)
}

function frame(now) {
  const dt = Math.min(0.25, (now - last) / 1000)
  last = now
  carry += dt * state.speed
  const k = Math.floor(carry)
  if (k > 0) {
    carry -= k
    seek(state.step + k)
  }
  if (state.step >= state.n) {
    pause()
    scheduleLoop()
    return
  }
  raf = requestAnimationFrame(frame)
}

export function play() {
  if (!replayer || state.playing || state.status !== 'ready' || state.mode !== 'programs') return
  if (state.edited) backToProgram()
  if (state.step >= state.n) seek(0)
  state.playing = true
  last = performance.now()
  carry = 1
  raf = requestAnimationFrame(frame)
}

export function pause() {
  clearTimeout(loopTimer)
  state.playing = false
  cancelAnimationFrame(raf)
}

export const toggle = () => (state.playing ? pause() : play())

export function stepBy(d) {
  pause()
  seek(state.step + d)
}

/* ---------- poking at the heap ---------- */

let nextId = 1 << 30

/** The allocator the user's clicks act on (forking a program if needed). */
function editable() {
  if (state.mode === 'playground') return pg.a
  if (state.mode !== 'programs' || !replayer) return null
  if (!state.edited) {
    pause()
    mine.a = markRaw(new Allocator())
    mine.a.restore(replayer.a.snapshot())
    state.edited = true
  }
  return mine.a
}

export function userMalloc(size) {
  const a = size > 0 ? editable() : null
  if (!a) return null
  const b = a.malloc(size, nextId++, -1)
  emit(a.ev)
  state.tick++
  return b
}

export function userFree(addr) {
  const a = editable()
  if (!a) return
  a.free(addr)
  emit(a.ev)
  state.tick++
}

export function backToProgram() {
  if (!state.edited) return
  state.edited = false
  mine.a = null
  state.tick++
  emit({ kind: 'reset' })
}

/* ---------- playground ---------- */

let burst = 0

export function resetPlayground(animate = true) {
  cancelAnimationFrame(burst)
  pg.a = markRaw(new Allocator())
  pg.a.malloc(0) // mm_init: an empty 4 KB heap
  if (animate) {
    state.tick++
    emit({ kind: 'restart' })
  }
}

/** Run fn once per frame, `count` times. */
function stagger(count, fn) {
  cancelAnimationFrame(burst)
  let i = 0
  const tickOnce = () => {
    if (state.mode !== 'playground') return
    if (fn(i++) === false || i >= count) return
    burst = requestAnimationFrame(tickOnce)
  }
  tickOnce()
}

/** A spray of random-sized allocations. */
export function fillUp() {
  stagger(24, () => {
    const size = Math.round(Math.exp(Math.log(16) + Math.random() * Math.log(40)))
    userMalloc(size)
  })
}

/** Free every other block, left to right: instant fragmentation. */
export function swissCheese() {
  const targets = pg.a.blocks().filter((b) => b.alloc).filter((_, k) => k % 2 === 0).map((b) => b.addr)
  if (!targets.length) return
  stagger(targets.length, (i) => userFree(targets[i]))
}

/* ---------- walkthrough ---------- */

/** Run steps 0..k on a fresh allocator; only step k's ops animate. */
function runTutorial(k) {
  tut.a = markRaw(new Allocator())
  tut.ids = {}
  let focus = null
  for (let s = 0; s <= k; s++) {
    for (const op of STEPS[s].ops) {
      const a = tut.a
      if (op.init) a.malloc(0)
      else if (op.malloc) tut.ids[op.as] = a.malloc(op.malloc, 1, -1).addr
      else a.free(tut.ids[op.free])
      if (s === k && !op.init) emit(a.ev)
      if (s === k && a.ev && a.ev.addr >= 0 && STEPS[s].tag) focus = { addr: a.ev.addr, size: a.ev.size, tag: STEPS[s].tag }
    }
  }
  state.focus = focus
  state.tick++
}

export function tutorialGo(k) {
  if (state.mode !== 'tour') return
  if (k >= STEPS.length) return setMode('playground')
  k = Math.max(0, k)
  if (k < state.tutorial) emit({ kind: 'reset' })
  state.tutorial = k
  runTutorial(k)
}

export function startTour() {
  runTutorial((state.tutorial = 0))
}
