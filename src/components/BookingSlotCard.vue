<script setup>
import { computed } from 'vue'
import BookingStatusBadge from './BookingStatusBadge.vue'
import { formatDate, formatTime } from '../services/facilityCalendarService'

const props = defineProps({
  booking: { type: Object, required: true },
  actions: { type: Array, default: () => [] },
  busy: { type: Boolean, default: false },
  showFacility: { type: Boolean, default: false },
  highlightClubId: { type: Number, default: null },   // the CCA the viewer is acting for
  index: { type: Number, default: 0 }
})
const emit = defineEmits(['action'])

const STATUS_CLASS = {
  'Proposed Peer Transfer': 'is-proposed',
  'Pending Admin Sign-off': 'is-pending',
  'Booked': 'is-booked',
  'Officially Confirmed Booking': 'is-confirmed'
}

const rowClass = computed(() => [
  STATUS_CLASS[props.booking.status] || '',
  {
    'is-mine': props.highlightClubId && props.booking.owner_club_id === props.highlightClubId,
    'is-offered-to-me': props.highlightClubId && props.booking.offered_club_id === props.highlightClubId
  }
])
</script>

<template>
  <div class="pulse-slot" :class="rowClass" :style="{ '--i': index }">
    <div class="pulse-slot-when">
      <div class="fw-semibold">{{ formatDate(booking.booking_date) }}</div>
      <div class="text-muted small">{{ formatTime(booking.start_time) }} – {{ formatTime(booking.end_time) }}</div>
      <div v-if="showFacility" class="small fw-semibold mt-1">{{ booking.facility_name }}</div>
    </div>

    <div class="pulse-slot-status">
      <BookingStatusBadge :status="booking.status" />
      <div v-if="booking.offered_club_name" class="small mt-1" :class="booking.offered_club_id === highlightClubId ? 'text-pulse fw-semibold' : 'text-muted'">
        {{ booking.offered_club_id === highlightClubId ? 'Offered to you (30 min)' : `Held for ${booking.offered_club_name}` }}
      </div>
      <div v-else-if="booking.waitlist_count" class="small text-muted mt-1">{{ booking.waitlist_count }} on waitlist</div>
    </div>

    <div class="pulse-slot-who small">
      <div>
        <span class="text-muted">Holder:</span>
        <strong>{{ booking.owner_club_name || 'Unknown CCA' }}</strong>
        <span v-if="highlightClubId && booking.owner_club_id === highlightClubId" class="pulse-you">you</span>
      </div>
      <div v-if="booking.status === 'Pending Admin Sign-off' && booking.claiming_club_name">
        <span class="text-muted">Claiming:</span> <strong class="text-pulse">{{ booking.claiming_club_name }}</strong>
      </div>
      <div v-if="booking.status === 'Officially Confirmed Booking' && booking.releasing_club_name">
        <span class="text-muted">From:</span> {{ booking.releasing_club_name }}
      </div>
    </div>

    <div class="pulse-slot-ref small">
      <span class="font-monospace">{{ booking.fbs_reference }}</span>
      <span v-if="booking.is_demo_reference" class="pulse-chip pulse-chip-sm ms-1" title="Illustrative reference, not a real FBS slip">demo</span>
    </div>

    <div class="pulse-slot-actions">
      <template v-for="action in actions" :key="action.type">
        <span v-if="action.type === 'locked'" class="pulse-locked" :title="action.hint">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
          {{ action.label }}
        </span>
        <button
          v-else
          type="button"
          class="btn btn-sm"
          :class="{
            'btn-pulse-primary': action.variant === 'primary',
            'btn-outline-secondary': action.variant === 'outline',
            'btn-pulse-amber': action.variant === 'warning'
          }"
          :disabled="busy || action.disabled"
          :title="action.hint || ''"
          @click="emit('action', action.type, booking)"
        >
          <span v-if="busy" class="spinner-border spinner-border-sm me-1"></span>{{ action.label }}
        </button>
      </template>
      <span v-if="!actions.length && booking.status === 'Pending Admin Sign-off'" class="small text-muted">Awaiting OSL</span>
      <span v-else-if="!actions.length && booking.status === 'Officially Confirmed Booking'" class="small text-success fw-semibold">✓ Confirmed</span>
    </div>
  </div>
</template>
