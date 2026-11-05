<script setup>
import { computed } from 'vue'

const props = defineProps({
  status: { type: String, required: true },
  // Officially Confirmed is green only when it is our CCA's win; other CCAs' confirmed slots are grey
  ours: { type: Boolean, default: true }
})

const LOOK = {
  'Booked': { cls: 'pulse-badge-booked', label: 'Booked' },
  // Database value stays 'Proposed Peer Transfer'; users see what they can do with it
  'Proposed Peer Transfer': { cls: 'pulse-badge-proposed', label: 'Available to Claim' },
  'Pending Admin Sign-off': { cls: 'pulse-badge-pending', label: 'Awaiting OSL approval' },
  'Officially Confirmed Booking': { cls: 'pulse-badge-confirmed', label: 'Officially Confirmed' }
}

const look = computed(() => {
  const found = LOOK[props.status] || { cls: 'pulse-badge-booked', label: props.status }
  if (props.status === 'Officially Confirmed Booking' && !props.ours) {
    return { cls: 'pulse-badge-booked', label: found.label }
  }
  return found
})
</script>

<template>
  <span class="pulse-badge" :class="look.cls">{{ look.label }}</span>
</template>
