<script setup>
import { computed } from 'vue'

const props = defineProps({
  status: { type: String, required: true },
  // true: our CCA holds it. false: another CCA does. null: the viewer has no CCA (OSL, guests).
  ours: { type: Boolean, default: null },
  // My Club: everything is ours, and red there means handed over
  plain: { type: Boolean, default: false }
})

const look = computed(() => {
  switch (props.status) {
    case 'Proposed Peer Transfer':
      return { cls: 'pulse-badge-proposed', label: 'Available to Claim' }
    case 'Pending Admin Sign-off':
      return { cls: 'pulse-badge-pending', label: 'Awaiting OSL approval' }
    case 'Booked':
      if (props.ours === true) return { cls: props.plain ? 'pulse-badge-booked' : 'pulse-badge-own', label: 'Booked' }
      return { cls: 'pulse-badge-booked', label: props.ours === false ? 'Unavailable' : 'Booked' }
    case 'Officially Confirmed Booking':
      if (props.ours === false) return { cls: 'pulse-badge-booked', label: 'Unavailable' }
      return { cls: 'pulse-badge-confirmed', label: 'Successfully Transferred' }
    default:
      return { cls: 'pulse-badge-booked', label: props.status }
  }
})
</script>

<template>
  <span class="pulse-badge" :class="look.cls">{{ look.label }}</span>
</template>
