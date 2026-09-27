<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import {
  state, utilization, loadFile, toggle, stepBy, backToProgram,
  setMode, startTour, tutorialGo, preloadDefault,
} from './store.js'
import { STEPS } from './tutorial.js'
import HeapView from './components/HeapView.vue'
import Player from './components/Player.vue'
import ProgramMenu from './components/ProgramMenu.vue'
import Tutorial from './components/Tutorial.vue'
import Playground from './components/Playground.vue'

const MODES = [
  ['tour', 'How it works'],
  ['programs', 'Programs'],
  ['playground', 'Playground'],
]
const statsStep = computed(() => state.mode === 'tour' && STEPS[state.tutorial].stats)
const throughput = computed(() => (state.mode === 'programs' ? state.throughput : state.baseThroughput))

/* ---------- the two numbers ---------- */
const util = ref(0)
let utilTarget = 0
let raf = 0
function ease() {
  const d = utilTarget - util.value
  util.value = Math.abs(d) < 0.0005 ? utilTarget : util.value + d * 0.15
  raf = util.value === utilTarget ? 0 : requestAnimationFrame(ease)
}
watch(() => [state.tick, state.mode], () => {
  utilTarget = utilization()
  if (!raf) raf = requestAnimationFrame(ease)
})

function opsPerSec(n) {
  if (!n) return ['—', '']
  if (n >= 1e6) return [(n / 1e6).toFixed(1), 'M']
  if (n >= 1e3) return [(n / 1e3).toFixed(0), 'K']
  return [n.toFixed(0), '']
}

/* ---------- keys & drop ---------- */
function onKey(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return
  if (state.mode === 'tour') {
    if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') tutorialGo(state.tutorial + 1)
    else if (e.key === 'ArrowLeft') tutorialGo(state.tutorial - 1)
    else return
  } else if (state.mode === 'programs') {
    if (e.key === ' ') toggle()
    else if (e.key === 'ArrowRight') stepBy(e.shiftKey ? 100 : 1)
    else if (e.key === 'ArrowLeft') stepBy(e.shiftKey ? -100 : -1)
    else if (e.key === 'Escape') backToProgram()
    else return
  } else return
  e.preventDefault()
}
const dragging = ref(false)
let depth = 0
const hasFiles = (e) => e.dataTransfer?.types?.includes('Files')
const onEnter = (e) => hasFiles(e) && (depth++, (dragging.value = true))
const onLeave = () => (depth = Math.max(0, depth - 1)) || (dragging.value = false)
function onDrop(e) {
  e.preventDefault()
  depth = 0
  dragging.value = false
  const f = e.dataTransfer?.files?.[0]
  if (f) loadFile(f)
}
const prevent = (e) => e.preventDefault()
const events = { keydown: onKey, dragenter: onEnter, dragleave: onLeave, dragover: prevent, drop: onDrop }

onMounted(() => {
  for (const [k, fn] of Object.entries(events)) window.addEventListener(k, fn)
  startTour()
  preloadDefault()
})
onBeforeUnmount(() => {
  for (const [k, fn] of Object.entries(events)) window.removeEventListener(k, fn)
})
</script>

<template>
  <div class="app">
    <header class="top">
      <div class="brand">
        <img src="/favicon.svg" alt="" />
        <span>heapscope</span>
      </div>
      <nav class="modes" aria-label="Mode">
        <button v-for="[key, title] in MODES" :key="key" :aria-pressed="state.mode === key" @click="setMode(key)">{{ title }}</button>
      </nav>
      <span class="brand ghost" aria-hidden="true"><img src="/favicon.svg" alt="" /><span>heapscope</span></span>
    </header>

    <main class="middle">
      <div class="stat left" :class="{ lit: statsStep }">
        <div class="label">utilization</div>
        <div class="value num">{{ (util * 100).toFixed(1) }}<small>%</small></div>
        <div class="hint">{{ state.mode === 'programs' && !state.edited ? 'of the heap held real data at its fullest' : 'of the heap holds real data' }}</div>
      </div>
      <div class="heap"><HeapView /></div>
      <div class="stat right" :class="{ lit: statsStep, faded: state.mode === 'tour' && !statsStep }">
        <div class="label">throughput</div>
        <div class="value num">{{ opsPerSec(throughput)[0] }}<small>{{ opsPerSec(throughput)[1] }}</small></div>
        <div class="hint">requests handled per second</div>
      </div>
    </main>

    <div class="legend">
      <span><i class="used" />in use</span>
      <span><i class="free" />free hole</span>
      <span><i class="tail" />unused</span>
    </div>

    <footer class="bottom">
      <Tutorial v-if="state.mode === 'tour'" />
      <Playground v-else-if="state.mode === 'playground'" />
      <template v-else>
        <ProgramMenu />
        <Player />
        <span class="or">Click a blue block to free it and see what changes.</span>
      </template>
    </footer>

    <div v-if="state.status === 'error'" class="toast" role="alert">{{ state.error }}</div>
    <Transition name="fade">
      <div v-if="dragging" class="drop"><div>drop a <span class="mono">.rep</span> trace</div></div>
    </Transition>
  </div>
</template>

<style scoped>
.app {
  position: fixed; inset: 0; display: grid; grid-template-rows: auto 1fr auto auto;
  background: radial-gradient(ellipse at 50% 42%, #0f1424 0%, var(--bg) 68%);
}
.top { display: flex; align-items: center; justify-content: space-between; padding: 18px 24px 0; gap: 12px; z-index: 20; }
.brand { display: flex; align-items: center; gap: 9px; font-weight: 650; font-size: 15px; letter-spacing: -0.01em; }
.brand img { width: 18px; height: 18px; }
.brand.ghost { visibility: hidden; }
.modes {
  display: flex; padding: 4px; border-radius: 999px; gap: 2px;
  background: rgba(14, 16, 22, 0.72); border: 1px solid rgba(255, 255, 255, 0.08); backdrop-filter: blur(14px);
}
.modes button {
  height: 34px; padding: 0 16px; border: 0; border-radius: 999px; background: transparent;
  color: var(--ink-2); font-size: 13.5px; font-weight: 550; white-space: nowrap; transition: color 0.15s, background 0.2s;
}
.modes button:hover { color: #fff; }
.modes button[aria-pressed='true'] { background: #fff; color: #07080b; }
.faded { opacity: 0.25; transition: opacity 0.3s; }
.stat { transition: opacity 0.3s, transform 0.3s; }
.stat.lit { transform: scale(1.06); }
.stat.lit .value { color: #fff; }
.hint { margin-top: 8px; font-size: 12.5px; color: var(--ink-3); }

.middle { display: grid; grid-template-columns: 1fr minmax(0, 3.2fr) 1fr; align-items: center; min-height: 0; padding: 8px 12px; }
.heap { position: relative; height: 100%; min-height: 0; }
.stat { text-align: center; padding: 0 12px; pointer-events: none; }
.value { font-size: clamp(34px, 4.6vw, 64px); font-weight: 650; letter-spacing: -0.045em; line-height: 1; }
.value small { font-size: 0.45em; font-weight: 500; margin-left: 3px; color: var(--ink-2); }
.label { margin-bottom: 10px; font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-2); }

.legend { display: flex; justify-content: center; gap: 22px; font-size: 12px; color: var(--ink-3); padding-bottom: 6px; }
.legend span { display: inline-flex; align-items: center; gap: 7px; }
.legend i { width: 10px; height: 10px; border-radius: 2px; }
.legend .used { background: var(--payload); }
.legend .free { background: var(--free); }
.legend .tail { background: #1a1f29; box-shadow: inset 0 0 0 1px #394257; }

.bottom { display: grid; justify-items: center; gap: 14px; padding: 10px 24px 26px; }
.act { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; justify-content: center; }
.or { font-size: 12.5px; color: var(--ink-3); }

.toast {
  position: fixed; top: 70px; left: 50%; transform: translateX(-50%); z-index: 50; padding: 10px 14px; max-width: 90vw;
  border-radius: 12px; background: rgba(40, 14, 10, 0.9); border: 1px solid rgba(255, 72, 40, 0.5); font-size: 13px;
}
.drop { position: fixed; inset: 0; z-index: 70; display: grid; place-items: center; background: rgba(7, 8, 11, 0.7); backdrop-filter: blur(6px); font-size: 20px; font-weight: 600; pointer-events: none; }
.drop div { padding: 40px 60px; border: 2px dashed var(--payload); border-radius: 20px; }
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

@media (max-width: 760px) {
  .top { padding: 14px 16px 0; }
  .brand span, .brand.ghost { display: none; }
  .modes button { padding: 0 11px; font-size: 12.5px; }
  .hint { font-size: 11px; margin-top: 4px; }
  .middle { grid-template-columns: 1fr 1fr; grid-template-rows: auto 1fr; padding: 12px 8px 4px; }
  .heap { grid-column: 1 / -1; grid-row: 2; }
  .stat { padding: 4px 0 8px; }
  .value { font-size: 36px; }
  .label { margin-bottom: 4px; font-size: 10.5px; }
  .bottom { padding: 8px 16px 20px; }
  .or { display: none; }
}
</style>
