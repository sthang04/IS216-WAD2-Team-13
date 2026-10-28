<script setup>
import { ref, watch, onUnmounted } from 'vue'

const props = defineProps({
  tag: { type: String, default: 'SMU Facilities' },
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  stats: { type: Array, default: () => [] },     // [{ label, value, tone }]
  variant: { type: String, default: 'default' }  // 'default' | 'admin'
})

// Numbers count up when they change, purely for feel.
const shown = ref(props.stats.map(() => 0))
let frame = null
watch(() => props.stats.map(s => s.value), (targets) => {
  cancelAnimationFrame(frame)
  const from = targets.map((_, i) => shown.value[i] ?? 0)
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const start = performance.now()
  const step = (now) => {
    const t = reduce ? 1 : Math.min(1, (now - start) / 600)
    const ease = 1 - Math.pow(1 - t, 3)
    shown.value = targets.map((to, i) => Math.round(from[i] + (to - from[i]) * ease))
    if (t < 1) frame = requestAnimationFrame(step)
  }
  frame = requestAnimationFrame(step)
}, { immediate: true })
onUnmounted(() => cancelAnimationFrame(frame))
</script>

<template>
  <section class="pulse-hero mb-4" :class="{ 'pulse-hero-admin': variant === 'admin' }">
    <div class="pulse-hero-glow" aria-hidden="true"></div>
    <div class="row align-items-center g-3 position-relative">
      <div class="col-lg-7">
        <span class="pulse-hero-tag">{{ tag }}</span>
        <h1 class="pulse-hero-title">{{ title }}</h1>
        <p v-if="subtitle" class="pulse-hero-sub mb-0">{{ subtitle }}</p>
        <slot />
      </div>
      <div v-if="stats.length" class="col-lg-5">
        <div class="d-flex flex-wrap gap-2 justify-content-lg-end">
          <div v-for="(stat, i) in stats" :key="stat.label" class="pulse-stat" :class="`pulse-stat-${stat.tone || 'plain'}`">
            <div class="pulse-stat-num">{{ shown[i] }}</div>
            <div class="pulse-stat-label">{{ stat.label }}</div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
