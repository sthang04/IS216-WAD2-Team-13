<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { formatDate, formatTime } from '../services/facilityService'
import { secondsLeft, formatCountdown } from '../services/waitlistService'

const props = defineProps({
  entry: { type: Object, required: true },
  busy: { type: Boolean, default: false }
})
const emit = defineEmits(['accept', 'decline', 'expired'])

// Visual countdown only; the server job expires the offer.
const now = ref(Date.now())
let timer = null
onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now()
    if (remaining.value === 0) {
      clearInterval(timer)
      emit('expired')
    }
  }, 1000)
})
onUnmounted(() => clearInterval(timer))

const remaining = computed(() => secondsLeft(props.entry.offer_expires_at, now.value))
const urgent = computed(() => remaining.value < 600)
</script>

<template>
  <div class="pulse-offer-card">
    <div class="d-flex flex-wrap justify-content-between align-items-start gap-3">
      <div>
        <div class="pulse-eyebrow text-pulse">Waitlist offer · you are #1</div>
        <h3 class="h5 fw-bold mb-1">{{ entry.facility_name }}</h3>
        <div class="small">
          {{ formatDate(entry.booking_date, true) }}, {{ formatTime(entry.start_time) }} – {{ formatTime(entry.end_time) }}
          · released by <strong>{{ entry.owner_club_name }}</strong>
        </div>
        <div class="small text-muted font-monospace mt-1">{{ entry.fbs_reference }}</div>
      </div>
      <div class="text-end">
        <div class="pulse-countdown" :class="{ urgent }">{{ formatCountdown(remaining) }}</div>
        <div class="small text-muted">left to accept</div>
      </div>
    </div>
    <div class="d-flex gap-2 mt-3">
      <button type="button" class="btn btn-pulse-primary" :disabled="busy || remaining === 0" @click="emit('accept', entry)">Accept and claim</button>
      <button type="button" class="btn btn-outline-secondary" :disabled="busy" @click="emit('decline', entry)">Decline</button>
    </div>
  </div>
</template>
