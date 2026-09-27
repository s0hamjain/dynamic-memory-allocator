<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { state, loadProgram, loadFile } from '../store.js'
import { GROUPS, titleOf } from '../programs.js'

const open = ref(false)
const root = ref(null)
const fileInput = ref(null)

function pick(name) {
  open.value = false
  loadProgram(name)
}
function onFile(e) {
  const f = e.target.files?.[0]
  if (f) {
    open.value = false
    loadFile(f)
  }
  e.target.value = ''
}
function outside(e) {
  if (open.value && root.value && !root.value.contains(e.target)) open.value = false
}
onMounted(() => document.addEventListener('pointerdown', outside))
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside))
</script>

<template>
  <div class="menu-root" ref="root">
    <button class="current" :aria-expanded="open" @click="open = !open">
      <span class="title">{{ titleOf(state.name) || '…' }}</span>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m4 6 4 4 4-4" /></svg>
    </button>
    <Transition name="pop">
      <div v-if="open" class="menu">
        <section v-for="g in GROUPS" :key="g.title">
          <h3>{{ g.title }}</h3>
          <button v-for="[name, title] in g.items" :key="name" class="item" :class="{ on: state.name === name }" @click="pick(name)">
            {{ title }}
          </button>
        </section>
        <button class="upload" @click="fileInput.click()">Open your own .rep trace…</button>
        <input ref="fileInput" type="file" accept=".rep,.txt,text/plain" hidden @change="onFile" />
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.menu-root { position: relative; }
.current {
  display: inline-flex; align-items: center; gap: 10px; height: 40px; padding: 0 14px 0 18px; border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.1); background: rgba(14, 16, 22, 0.72); backdrop-filter: blur(14px);
  font-size: 14px; font-weight: 550; transition: border-color 0.15s;
}
.current:hover { border-color: rgba(255, 255, 255, 0.25); }
.current svg { width: 14px; height: 14px; color: rgba(243, 245, 248, 0.45); }
.title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 60vw; }
.menu {
  position: absolute; bottom: 48px; left: 50%; transform: translateX(-50%); z-index: 40;
  width: min(820px, calc(100vw - 32px)); max-height: 70vh; overflow-y: auto;
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px 18px; padding: 18px;
  border-radius: 16px; border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(18, 21, 28, 0.94); backdrop-filter: blur(18px); box-shadow: 0 20px 60px -20px rgba(0, 0, 0, 0.8);
}
h3 { margin: 0 0 6px 8px; font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(243, 245, 248, 0.38); }
.item {
  display: block; width: 100%; padding: 7px 8px; border: 0; border-radius: 8px; background: transparent;
  text-align: left; font-size: 13px; color: rgba(243, 245, 248, 0.72);
}
.item:hover { background: rgba(255, 255, 255, 0.07); color: #fff; }
.item.on { color: #fff; background: rgba(78, 136, 220, 0.2); }
.upload {
  grid-column: 1 / -1; margin-top: 8px; height: 36px; border: 1px dashed rgba(255, 255, 255, 0.18); border-radius: 10px;
  background: transparent; color: rgba(243, 245, 248, 0.5); font-size: 12.5px;
}
.upload:hover { color: #fff; border-color: rgba(255, 255, 255, 0.35); }
.pop-enter-active, .pop-leave-active { transition: opacity 0.15s, transform 0.15s; }
.pop-enter-from, .pop-leave-to { opacity: 0; transform: translate(-50%, 6px); }
@media (max-width: 860px) { .menu { grid-template-columns: 1fr 1fr; } }
@media (max-width: 480px) { .menu { grid-template-columns: 1fr; } }
</style>
