<script setup>
import { ref, computed } from 'vue'
import { timeAgo } from '../services/notificationService'

// Swipe left to show the bin; keep going past half the width to delete.
// Letting go part-way leaves the bin showing so it can be tapped instead.
const props = defineProps({
  item: { type: Object, required: true }
})
const emit = defineEmits(['open', 'delete'])

const BIN_WIDTH = 72

const row = ref(null)
const offset = ref(0)
const dragging = ref(false)
const leaving = ref(false)

let startX = 0
let startY = 0
let startOffset = 0
let tracking = false
let moved = false

const progress = computed(() => Math.min(1, -offset.value / BIN_WIDTH))
const armed = computed(() => row.value && -offset.value > row.value.offsetWidth * 0.5)

function onPointerDown(event) {
  if (leaving.value || (event.pointerType === 'mouse' && event.button !== 0)) return
  tracking = true
  moved = false
  startX = event.clientX
  startY = event.clientY
  startOffset = offset.value
}

function onPointerMove(event) {
  if (!tracking) return
  const dx = event.clientX - startX
  const dy = event.clientY - startY

  if (!dragging.value) {
    // Vertical movement means the user is scrolling the list.
    if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) { tracking = false; return }
    if (Math.abs(dx) < 8) return
    dragging.value = true
    moved = true
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  offset.value = Math.min(0, startOffset + dx)
}

function onPointerUp() {
  if (!tracking) return
  tracking = false
  if (!dragging.value) return
  dragging.value = false

  if (armed.value) remove()
  else offset.value = -offset.value > BIN_WIDTH * 0.6 ? -BIN_WIDTH : 0
}

function remove() {
  leaving.value = true
  offset.value = -(row.value?.offsetWidth || 400)
  setTimeout(() => emit('delete', props.item), 180)
}

function onClick() {
  // A swipe ends with a click event; ignore it.
  if (moved) { moved = false; return }
  if (offset.value !== 0) { offset.value = 0; return }
  emit('open', props.item)
}
</script>

<template>
  <div ref="row" class="pulse-swipe" :class="{ armed }">
    <button
      type="button"
      class="pulse-swipe-bin"
      :style="{ '--bin-scale': 0.6 + progress * 0.4, opacity: progress }"
      :tabindex="offset ? 0 : -1"
      aria-label="Delete notification"
      @click="remove"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"></path>
      </svg>
    </button>

    <button
      type="button"
      class="pulse-notification-item pulse-swipe-content"
      :class="{ unread: !item.is_read, dragging }"
      :style="{ transform: `translateX(${offset}px)` }"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @click="onClick"
      @keydown.delete.prevent="remove"
    >
      <div class="d-flex justify-content-between gap-2">
        <span class="fw-semibold small">{{ item.title }}</span>
        <span class="text-muted pulse-tiny text-nowrap">{{ timeAgo(item.created_at) }}</span>
      </div>
      <div class="text-muted pulse-tiny mt-1">{{ item.message }}</div>
    </button>
  </div>
</template>
