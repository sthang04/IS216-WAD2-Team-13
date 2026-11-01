<script setup>
// SplitFlap.vue
// Shows a number like an old airport departure board: each digit flips through
// random digits, left to right, then settles on the real value and stays still.

import { ref, watch, onUnmounted } from 'vue'

const props = defineProps({
  value: { type: [Number, String], default: 0 },
  delay: { type: Number, default: 0 }    // ms to wait before this board starts (to stagger several boards)
})

const DIGITS = '0123456789'
const TICK_MS = 120         // one flap every 120 ms
const SETTLE_MS = 360       // first digit settles after this long (3 flaps)
const STAGGER_MS = 120      // each later digit settles this much after the one before

const chars = ref(String(props.value).split(''))
const flips = ref(chars.value.map(() => 0))   // bumping a flip number replays that digit's flap animation
let timers = []

function stop() {
  timers.forEach((id) => clearTimeout(id))
  timers = []
}

function animate(target) {
  stop()
  const goal = String(target).split('')
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduce) {
    chars.value = goal
    flips.value = goal.map(() => 0)
    return
  }

  chars.value = goal.map(() => ' ')
  flips.value = goal.map(() => 0)

  goal.forEach((finalChar, i) => {
    const settleAt = props.delay + SETTLE_MS + i * STAGGER_MS
    // Spin through random digits until this position settles
    for (let t = props.delay; t < settleAt; t += TICK_MS) {
      timers.push(setTimeout(() => {
        chars.value[i] = DIGITS.includes(finalChar) ? DIGITS[Math.floor(Math.random() * 10)] : finalChar
        flips.value[i] += 1
      }, t))
    }
    timers.push(setTimeout(() => {
      chars.value[i] = finalChar
      flips.value[i] += 1
    }, settleAt))
  })
}

// Plays when the page opens, and again whenever the number changes (e.g. after loading)
watch(() => props.value, animate, { immediate: true })
onUnmounted(stop)
</script>

<template>
  <span class="split-flap" :aria-label="String(value)" role="text">
    <span v-for="(char, i) in chars" :key="i" class="split-flap-cell" aria-hidden="true">
      <span :key="flips[i]" class="split-flap-char">{{ char }}</span>
    </span>
  </span>
</template>

<style scoped>
.split-flap {
  display: inline-flex;
  gap: 2px;
  font-variant-numeric: tabular-nums;
}

/* One tile per digit; it takes the text colour of wherever it is used */
.split-flap-cell {
  position: relative;
  display: inline-block;
  min-width: 0.85em;
  padding: 0.02em 0.12em;
  text-align: center;
  border-radius: 0.18em;
  background: color-mix(in srgb, currentColor 16%, transparent);
  box-shadow: inset 0 -1px 0 color-mix(in srgb, currentColor 18%, transparent);
  perspective: 300px;
  overflow: hidden;
}

.split-flap-char {
  display: inline-block;
  transform-origin: 50% 50%;
  animation: split-flap-drop 110ms ease-out;
}

@keyframes split-flap-drop {
  from { transform: rotateX(-80deg); opacity: 0.4; }
  to   { transform: rotateX(0); opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .split-flap-char { animation: none; }
}
</style>
