<script setup>
import { computed, ref } from 'vue'
import { state, toggle, seek, pause, backToProgram } from '../store.js'

const bar = ref(null)
const progress = computed(() => (state.n ? state.step / state.n : 0))

let down = false
function at(ev) {
  const r = bar.value.getBoundingClientRect()
  return ((ev.clientX - r.left) / r.width) * state.n
}
function onDown(ev) {
  down = true
  bar.value.setPointerCapture(ev.pointerId)
  pause()
  seek(at(ev))
}
function onMove(ev) {
  if (down) seek(at(ev))
}
const onUp = () => (down = false)
</script>

<template>
  <div class="player">
    <button class="play" :class="{ on: state.playing }" :aria-label="state.playing ? 'Pause' : 'Play'" @click="toggle">
      <svg v-if="!state.playing" viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 2.9v10.2a.7.7 0 0 0 1.06.6l8.1-5.1a.7.7 0 0 0 0-1.2l-8.1-5.1a.7.7 0 0 0-1.06.6z" /></svg>
      <svg v-else viewBox="0 0 16 16" fill="currentColor"><rect x="3.5" y="2.5" width="3" height="11" rx="1" /><rect x="9.5" y="2.5" width="3" height="11" rx="1" /></svg>
    </button>
    <div
      ref="bar"
      class="bar"
      :class="{ dim: state.edited }"
      role="slider"
      aria-label="Position in program"
      :aria-valuenow="state.step"
      :aria-valuemax="state.n"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
    >
      <div class="track"><i :style="{ width: progress * 100 + '%' }" /></div>
      <span class="knob" :style="{ left: progress * 100 + '%' }" />
    </div>
    <Transition name="fade">
      <button v-if="state.edited" class="back" @click="backToProgram">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 3.5 2.5 6.5l3 3" /><path d="M2.5 6.5h7a4 4 0 0 1 0 8H7" /></svg>
        undo my changes
      </button>
    </Transition>
  </div>
</template>

<style scoped>
.player { display: flex; align-items: center; gap: 18px; width: min(560px, 100%); }
.play {
  flex: none; width: 52px; height: 52px; border: 0; border-radius: 50%;
  display: grid; place-items: center; background: #fff; color: #07080b;
  transition: transform 0.15s, box-shadow 0.3s;
}
.play:hover { transform: scale(1.06); }
.play svg { width: 18px; height: 18px; }
.bar { position: relative; flex: 1; height: 28px; cursor: pointer; touch-action: none; transition: opacity 0.2s; }
.bar.dim { opacity: 0.35; }
.track { position: absolute; left: 0; right: 0; top: 12px; height: 4px; border-radius: 4px; background: rgba(255, 255, 255, 0.1); overflow: hidden; }
.track i { display: block; height: 100%; background: var(--payload); }
.knob {
  position: absolute; top: 8px; width: 12px; height: 12px; margin-left: -6px; border-radius: 50%;
  background: #fff; pointer-events: none;
}
.back {
  flex: none; display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px; border-radius: 999px;
  border: 1px solid rgba(150, 110, 255, 0.5); background: rgba(150, 110, 255, 0.14); color: #d8ccff; font-size: 12.5px;
}
.back svg { width: 14px; height: 14px; }
.back:hover { background: rgba(150, 110, 255, 0.25); }
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
