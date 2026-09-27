<script setup>
import { computed } from 'vue'
import { state, tutorialGo, setMode } from '../store.js'
import { STEPS } from '../tutorial.js'

const step = computed(() => STEPS[state.tutorial] || STEPS[0])
const last = computed(() => state.tutorial === STEPS.length - 1)
</script>

<template>
  <div class="tut">
    <Transition name="swap" mode="out-in">
      <p :key="state.tutorial" class="text">{{ step.text }}</p>
    </Transition>
    <div class="row">
      <button class="skip" @click="setMode('playground')">skip</button>
      <div class="dots" aria-hidden="true">
        <i v-for="(_, k) in STEPS" :key="k" :class="{ on: k === state.tutorial, done: k < state.tutorial }" @click="tutorialGo(k)" />
      </div>
      <div class="nav">
        <button class="back" :disabled="state.tutorial === 0" aria-label="Back" @click="tutorialGo(state.tutorial - 1)">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>
        </button>
        <button class="next" @click="tutorialGo(state.tutorial + 1)">
          {{ last ? 'Open the playground' : 'Next' }}
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5 10.5 8 6 12.5" /></svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tut {
  width: min(560px, 100%); padding: 18px 20px 14px; border-radius: 18px;
  background: rgba(16, 19, 26, 0.85); border: 1px solid rgba(255, 255, 255, 0.1); backdrop-filter: blur(16px);
  box-shadow: 0 20px 50px -20px rgba(0, 0, 0, 0.8);
}
.text { margin: 0 0 16px; min-height: 2.9em; font-size: 16.5px; line-height: 1.45; color: #fff; text-align: center; text-wrap: balance; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.skip { border: 0; background: none; padding: 6px 4px; font-size: 12.5px; color: rgba(243, 245, 248, 0.4); }
.skip:hover { color: #fff; }
.dots { display: flex; gap: 6px; }
.dots i { width: 7px; height: 7px; border-radius: 50%; background: rgba(255, 255, 255, 0.15); cursor: pointer; transition: all 0.25s; }
.dots i.done { background: rgba(78, 136, 220, 0.6); }
.dots i.on { width: 20px; border-radius: 4px; background: var(--payload); }
.nav { display: flex; gap: 6px; }
.back, .next { display: inline-flex; align-items: center; justify-content: center; gap: 4px; height: 38px; border: 0; border-radius: 999px; font-weight: 600; font-size: 13.5px; }
.back { width: 38px; background: rgba(255, 255, 255, 0.08); color: #fff; }
.back:disabled { opacity: 0.3; cursor: default; }
.back svg, .next svg { width: 15px; height: 15px; }
.next { padding: 0 14px 0 18px; background: #fff; color: #07080b; transition: transform 0.15s; }
.next:hover { transform: scale(1.04); }
.swap-enter-active, .swap-leave-active { transition: opacity 0.15s, transform 0.15s; }
.swap-enter-from { opacity: 0; transform: translateY(6px); }
.swap-leave-to { opacity: 0; transform: translateY(-6px); }
@media (max-width: 480px) { .text { font-size: 15px; } .dots { display: none; } }
</style>
