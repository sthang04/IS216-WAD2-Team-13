
<script setup>
import BookingSlotCard from './BookingSlotCard.vue'
import { capacityLabel } from '../services/facilityService'
 
defineProps({
  facility: { type: Object, required: true },
  bookings: { type: Array, default: () => [] },
  actionsByBooking: { type: Object, default: () => ({}) },
  waitlistByBooking: { type: Object, default: () => ({}) },   // booking_id -> our CCA's queue entry (Logistics Directors only)
  busyBookingId: { type: Number, default: null },
  highlightClubId: { type: Number, default: null },
  index: { type: Number, default: 0 }
})
const emit = defineEmits(['action'])
 
const TYPE_CLASS = {
  'Dance Studio': 'type-dance',
  'Acoustic Room': 'type-acoustic',
  'Sports Court': 'type-sports',
  'Multi-Purpose': 'type-multi'
}
</script>
 
<template>
  <article class="pulse-panel pulse-facility overflow-hidden" :class="TYPE_CLASS[facility.facility_type]" :style="{ '--i': index }" :id="`facility-${facility.id}`">
    <header class="p-3 p-lg-4 border-bottom d-flex flex-wrap justify-content-between gap-3">
      <div class="flex-grow-1" style="min-width: 240px;">
        <div class="d-flex align-items-center flex-wrap gap-2 mb-1">
          <h3 class="h5 fw-bold mb-0">{{ facility.name }}</h3>
          <span class="pulse-type-chip">{{ facility.facility_type }}</span>
          <span v-if="bookings.some(b => b.status === 'Proposed Peer Transfer')" class="pulse-chip pulse-chip-hot">
            {{ bookings.filter(b => b.status === 'Proposed Peer Transfer').length }} released
          </span>
        </div>
        <div class="text-muted small">{{ facility.location }}</div>
        <div class="small mt-1">
          Capacity: <strong>{{ capacityLabel(facility) }}</strong>
          <span v-if="facility.capacity_is_estimate" class="text-muted"> · prototype estimate, not an official room limit</span>
        </div>
        <div class="d-flex flex-wrap gap-1 mt-2">
          <span v-for="item in facility.equipment" :key="item" class="pf-tag">{{ item }}</span>
        </div>
      </div>
      <figure v-if="facility.photo_url" class="mb-0 pulse-facility-photo">
        <img :src="facility.photo_url" :alt="facility.name" loading="lazy" @error="$event.target.closest('figure').style.display = 'none'" />
        <figcaption class="text-muted">{{ facility.photo_note }}</figcaption>
      </figure>
    </header>
 
    <div v-if="!bookings.length" class="p-3 p-lg-4 text-muted small">No bookings at this facility for the selected week.</div>
    <div v-else>
      <BookingSlotCard
        v-for="(booking, i) in bookings"
        :key="booking.booking_id"
        :booking="booking"
        :index="i"
        :actions="actionsByBooking[booking.booking_id] || []"
        :busy="busyBookingId === booking.booking_id"
        :highlight-club-id="highlightClubId"
        :waitlist-entry="waitlistByBooking[booking.booking_id] || null"
        @action="(type, b) => emit('action', type, b)"
      />
    </div>
  </article>
</template>