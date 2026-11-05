<script setup>
// Shows one item at a time and moves on slowly by itself.
// It stops while someone hovers or focuses on it, and stays still
// for people who ask their device for less motion.
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  // [{ key, tag, tone, title, meta, detail, side }]
  slides: { type: Array, required: true },
  label: { type: String, required: true },
  clickHint: { type: String, default: '' }  // set when choosing a slide does something
})
const emit = defineEmits(['select'])

const ROTATE_MS = 6000
const TONES = { green: 'var(--pf-green)', red: 'var(--pf-red)', violet: 'var(--pf-violet)', primary: 'var(--pf-primary)', teal: '#0d9488' }

const index = ref(0)
const paused = ref(false)
const still = ref(false)
const current = computed(() => props.slides[index.value] || props.slides[0] || null)

// The list can shrink when a search is typed or the week changes
watch(() => props.slides.length, (length) => {
  if (index.value >= length) index.value = 0
})

let timer = null
onMounted(() => {
  still.value = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (still.value) return
  timer = setInterval(() => {
    if (!paused.value && props.slides.length > 1) {
      index.value = (index.value + 1) % props.slides.length
    }
  }, ROTATE_MS)
})
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <div
    v-if="current"
    class="pulse-spotlight"
    :style="{ '--tone': TONES[current.tone] || TONES.primary, '--rotate': `${ROTATE_MS}ms` }"
    :class="{ 'is-paused': paused }"
    :aria-label="label"
    role="group"
    @mouseenter="paused = true"
    @mouseleave="paused = false"
    @focusin="paused = true"
    @focusout="paused = false"
  >
    <Transition name="pulse-spot" mode="out-in">
      <component
        :is="clickHint ? 'button' : 'div'"
        :key="current.key"
        :type="clickHint ? 'button' : undefined"
        :title="clickHint || undefined"
        class="pulse-spotlight-slide"
        @click="clickHint && emit('select', current)"
      >
        <span class="pulse-spotlight-tag">{{ current.tag }}</span>
        <span class="pulse-spotlight-text">
          <strong>{{ current.title }}</strong>
          <span v-if="current.meta" class="text-muted"> · {{ current.meta }}</span>
          <span v-if="current.detail" class="d-block small">{{ current.detail }}</span>
        </span>
        <span v-if="current.side" class="small text-muted">{{ current.side }}</span>
      </component>
    </Transition>
    <div v-if="slides.length > 1" class="pulse-spotlight-dots">
      <button
        v-for="(slide, i) in slides"
        :key="slide.key"
        type="button"
        class="pulse-spotlight-dot"
        :class="{ active: i === index }"
        :aria-label="`Show ${i + 1} of ${slides.length}`"
        :aria-current="i === index ? 'true' : undefined"
        @click="index = i"
      ></button>
    </div>
    <span v-if="slides.length > 1 && !still" :key="`bar-${current.key}`" class="pulse-spotlight-bar" aria-hidden="true"></span>
  </div>
</template>
