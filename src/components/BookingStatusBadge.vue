<script setup>
import { computed } from 'vue'

const props = defineProps({
  status: { type: String, required: true }
})

const LOOK = {
  'Booked': { cls: 'pulse-badge-booked', label: 'Booked' },
  'Proposed Peer Transfer': { cls: 'pulse-badge-proposed', label: 'Proposed Peer Transfer' },
  'Pending Admin Sign-off': { cls: 'pulse-badge-pending', label: 'Pending Admin Sign-off' },
  'Officially Confirmed Booking': { cls: 'pulse-badge-confirmed', label: 'Officially Confirmed' }
}

const look = computed(() => LOOK[props.status] || { cls: 'pulse-badge-booked', label: props.status })
</script>

<template>
  <span class="pulse-badge" :class="look.cls">{{ look.label }}</span>
</template>
