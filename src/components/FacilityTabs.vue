<script setup>
// FacilityTabs.vue
// Calendar / My Club / Waitlist tabs under the page hero.
// OSL review is a fourth tab only OSL administrators see (the database also checks).

import { computed } from 'vue'
import { session } from '../services/sessionState'
import { notificationStore } from '../services/notificationStore'

defineProps({
  waitlistCount: { type: Number, default: 0 },
  offerCount: { type: Number, default: 0 }
})

// OSL staff don't belong to a CCA, so My Club and Waitlist mean nothing to them
const showClubTabs = computed(() => {
  return !session.value.isOslAdmin || session.value.memberships.length > 0
})

// Highlight the Waitlist tab whenever our CCA is holding an offer
const hasOffer = computed(() => {
  return notificationStore.value.offers.length > 0
})
</script>

<template>
  <nav class="pulse-tabs mb-4" aria-label="Facility calendar sections">
    <RouterLink to="/facilities" class="pulse-tab" exact-active-class="active">
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>
      All Facilities
    </RouterLink>
    <RouterLink v-if="showClubTabs" to="/facilities/my-club" class="pulse-tab" exact-active-class="active">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17.5" cy="9" r="2.5"/><path d="M16 14.5a5 5 0 0 1 6 5"/></svg>
      My Club
    </RouterLink>
    <RouterLink
      v-if="showClubTabs"
      to="/facilities/waitlist"
      class="pulse-tab"
      :class="{ 'pulse-tab-offer': hasOffer || offerCount }"
      exact-active-class="active"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/></svg>
      Waitlist
      <span v-if="offerCount" class="pulse-tab-count pulse-tab-count-hot" :title="`${offerCount} live offer(s)`">{{ offerCount }}</span>
      <span v-else-if="waitlistCount" class="pulse-tab-count">{{ waitlistCount }}</span>
    </RouterLink>
    <RouterLink v-if="session.isOslAdmin" to="/facilities/admin" class="pulse-tab pulse-tab-osl" exact-active-class="active">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>
      OSL Review
    </RouterLink>
  </nav>
</template>
