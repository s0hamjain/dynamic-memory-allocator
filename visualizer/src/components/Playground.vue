<script setup>
/**
 * Build and break a heap by hand. Drag a size onto the heap and let go: the
 * block flies to wherever malloc decides to put it (the ghost shows where
 * while you drag). Buttons spray allocations or punch holes.
 */
import { ref, nextTick, onBeforeUnmount } from 'vue'
import { state, heap, userMalloc, fillUp, swissCheese, resetPlayground } from '../store.js'
import { heapApi } from '../heapApi.js'

const SIZES = [16, 64, 256, 1024, 4096]
const label = (n) => (n >= 1024 ? `${n / 1024} KB` : `${n} B`)
// Glyph length grows with log2(size): 16 B shows 2 cells, 4 KB shows 9.
const cellsOf = (n) => Math.round(2 + Math.log2(n / 16) * 0.875)

const drag = ref(null) // { size, x, y, moved, x0, y0 }
const flights = ref([]) // blocks in the air
let flightId = 0

function onDown(ev, size) {
  ev.preventDefault()
  drag.value = { size, x: ev.clientX, y: ev.clientY, x0: ev.clientX, y0: ev.clientY, moved: false }
  state.probeSize = size
  state.probing = true
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}
function onMove(ev) {
  const d = drag.value
  if (!d) return
  d.x = ev.clientX
  d.y = ev.clientY
  if (Math.abs(d.x - d.x0) + Math.abs(d.y - d.y0) > 6) d.moved = true
}
function onUp(ev) {
  window.removeEventListener('pointermove', onMove)
  window.removeEventListener('pointerup', onUp)
  const d = drag.value
  drag.value = null
  state.probing = false
  if (!d) return
  const overHeap = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.stage')
  if (!d.moved) fly(d.size, d.x0, d.y0)
  else if (overHeap) fly(d.size, ev.clientX, ev.clientY)
}
onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onMove)
  window.removeEventListener('pointerup', onUp)
})

/** Animate a block from (x, y) to where malloc(size) will land, then malloc. */
async function fly(size, x, y) {
  const p = heap()?.peek(size)
  const to = p && heapApi.rectOf(p.addr, p.size)
  if (!to) {
    userMalloc(size)
    return
  }
  const id = ++flightId
  flights.value.push({ id, size })
  await nextTick()
  const el = document.querySelector(`[data-flight="${id}"]`)
  const s = 28
  const anim = el.animate(
    [
      { left: `${x - s / 2}px`, top: `${y - s / 2}px`, width: `${s}px`, height: `${s}px`, opacity: 1 },
      { left: `${to.x}px`, top: `${to.y}px`, width: `${Math.max(6, to.w)}px`, height: `${Math.max(6, to.h)}px`, opacity: 0.9 },
    ],
    { duration: 420, easing: 'cubic-bezier(0.5, 0, 0.2, 1)', fill: 'forwards' },
  )
  anim.onfinish = () => {
    userMalloc(size)
    flights.value = flights.value.filter((f) => f.id !== id)
  }
}
</script>

<template>
  <div class="pg">
    <div class="tray">
      <button
        v-for="size in SIZES"
        :key="size"
        class="chip"
        :title="`Drag malloc(${size}) onto the heap, or click`"
        @pointerdown="onDown($event, size)"
      >
        <span class="glyph"><i v-for="k in cellsOf(size)" :key="k" /></span>
        <span class="lab">{{ label(size) }}</span>
      </button>
    </div>
    <div class="tools">
      <button class="tool" @click="fillUp">
        <svg viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" opacity=".4" /></svg>
        Fill it up
      </button>
      <button class="tool" @click="swissCheese">
        <svg viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" opacity=".3" /><rect x="2" y="9" width="5" height="5" rx="1" opacity=".3" /><rect x="9" y="9" width="5" height="5" rx="1" /></svg>
        Swiss cheese
      </button>
      <button class="tool quiet" @click="resetPlayground()">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8a5.5 5.5 0 1 0 1.8-4.1M2.5 2.5v3h3" /></svg>
        Clear
      </button>
    </div>
    <p class="hint">Drag a block onto the heap and let go. Swipe across blue blocks to free them.</p>

    <Teleport to="body">
      <div v-if="drag && drag.moved" class="held" :style="{ left: drag.x + 'px', top: drag.y + 'px' }">
        <span class="glyph"><i v-for="k in cellsOf(drag.size)" :key="k" /></span>
        malloc({{ drag.size }})
      </div>
      <div v-for="f in flights" :key="f.id" :data-flight="f.id" class="flyer" />
    </Teleport>
  </div>
</template>

<style scoped>
.pg { display: grid; justify-items: center; gap: 14px; }
.tray { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
.chip {
  display: grid; justify-items: center; gap: 8px; min-width: 76px; padding: 12px 12px 10px; border-radius: 14px;
  border: 1px solid rgba(78, 136, 220, 0.35); background: rgba(78, 136, 220, 0.08); color: #fff;
  cursor: grab; touch-action: none; user-select: none;
  transition: transform 0.15s, background 0.15s, box-shadow 0.2s;
}
.chip:hover { transform: translateY(-3px); background: rgba(78, 136, 220, 0.16); box-shadow: 0 8px 20px -10px rgba(0, 0, 0, 0.6); }
.chip:active { cursor: grabbing; }
.glyph { display: flex; gap: 2px; height: 10px; }
.glyph i { width: 8px; height: 10px; border-radius: 2px; background: var(--payload); }
.glyph i:first-child { background: #2d5fa8; }
.lab { font: 600 13px/1 var(--mono); }
.tools { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
.tool {
  display: inline-flex; align-items: center; gap: 7px; height: 34px; padding: 0 14px; border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.12); background: rgba(255, 255, 255, 0.04); color: var(--ink); font-size: 13px;
  transition: background 0.15s, border-color 0.15s;
}
.tool:hover { background: rgba(255, 255, 255, 0.1); border-color: rgba(255, 255, 255, 0.25); }
.tool svg { width: 14px; height: 14px; color: var(--free); }
.tool:first-child svg { color: var(--payload); }
.tool.quiet { color: var(--ink-2); }
.tool.quiet svg { color: var(--ink-3); }
.hint { margin: 0; font-size: 12.5px; color: var(--ink-3); text-align: center; }

.held {
  position: fixed; z-index: 100; pointer-events: none; transform: translate(-50%, -130%);
  display: inline-flex; align-items: center; gap: 8px; padding: 7px 11px; border-radius: 10px;
  background: #fff; color: #07080b; font: 600 12.5px/1 var(--mono); box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
}
.held .glyph i { box-shadow: none; }
@media (max-width: 480px) {
  .tray { gap: 6px; flex-wrap: nowrap; }
  .chip { min-width: 0; flex: 1; padding: 10px 6px 8px; }
  .glyph i { width: 4px; }
  .lab { font-size: 11.5px; }
}
.flyer {
  position: fixed; z-index: 100; pointer-events: none; border-radius: 4px;
  background: #cfe0f7; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
}
</style>
