<script setup>
import SplitFlap from './SplitFlap.vue'

defineProps({
  tag: { type: String, default: 'SMU Facilities' },
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  stats: { type: Array, default: () => [] },     // [{ label, value, tone }]
  variant: { type: String, default: 'default' }  // 'default' | 'admin'
})

// The numbers flip in like an airport departure board (SplitFlap), then stay still.
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
            <div class="pulse-stat-num"><SplitFlap :value="stat.value" :delay="i * 80" /></div>
            <div class="pulse-stat-label">{{ stat.label }}</div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
