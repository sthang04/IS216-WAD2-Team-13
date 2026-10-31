<script setup>

// The week calendar of every SMU facility booking. Logistics Directors can
// release, claim and join waitlists here; everyone else can only look.

import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import {readSimulatorCalendarFocus,bookingMatchesSimulatorFocus,clearSimulatorCalendarFocus} from '../services/simulatorCalendarNavigation.js'
import { useRoute, useRouter } from 'vue-router'
import FacilityTabs from '../components/FacilityTabs.vue'
import PageHero from '../components/PageHero.vue'
import WeekNavigator from '../components/WeekNavigator.vue'
import FacilityFilters from '../components/FacilityFilters.vue'
import FacilityCard from '../components/FacilityCard.vue'
import ConfirmActionModal from '../components/ConfirmActionModal.vue'
import { loadOffers } from '../services/notificationStore'
import { session, activeClubName, canManageActiveClub, showToast } from '../services/sessionState'
import {
  STATUSES, fetchFacilities, fetchCalendar, releaseBooking, undoRelease, claimBooking,
  listenForCalendarChanges, bookingActions, defaultWeekStart, weekStartOf, addDays,
  formatWeekLabel, formatDate, formatTime
} from '../services/facilityService'
import { fetchActiveClubEntries, joinWaitlist, leaveWaitlist } from '../services/waitlistService'

const route = useRoute()
const router = useRouter()

// ---------------- Data ----------------

const facilities = ref([])
const bookings = ref([])
const myEntries = ref([])      // waitlist entries for the CCA we are acting for
const loading = ref(true)
const busyBookingId = ref(null)
const filters = ref({ type: 'All', equipment: 'All', capacity: 'any', availability: 'All', search: '' })
const selectedDay = ref(null)  // a date picked on the week calendar, or null for the whole week
const pending = ref(null)      // the action waiting in the confirm pop-up

// Optional simulator deep link. Without it the original calendar is unchanged.
// These query values filter the view only; bookingActions/RPCs remain authoritative.
const simulatorFocus=computed(()=>readSimulatorCalendarFocus(route.query,facilities.value))
const simulatorRequestedPeriod=computed(()=>simulatorFocus.value&&!simulatorFocus.value.error
 ? [simulatorFocus.value.start,simulatorFocus.value.end].map(t=>new Date(t).toLocaleString('en-SG',{timeZone:'Asia/Singapore'})).join(' to '):'')
function clearSimulatorFocus(){router.replace({query:clearSimulatorCalendarFocus(route.query)})}

// ---------------- Which week ----------------

// The week is kept in the URL (?week=2026-11-02) so a refresh keeps it
const weekStart = computed({
  get() {
    const week = route.query.week
    if (week && /^\d{4}-\d{2}-\d{2}$/.test(week)) {
      return weekStartOf(week)
    }
    return defaultWeekStart()
  },
  set(value) {
    const query = Object.assign({}, route.query)
    query.week = value
    router.replace({ query: query })
  }
})

const weekLabel = computed(() => {
  return formatWeekLabel(weekStart.value)
})

// ---------------- Loading ----------------

async function load() {
  try {
    // Step 1: facilities hardly change, so only load them once
    if (facilities.value.length === 0) {
      facilities.value = await fetchFacilities()
    }

    // Step 2: this week's bookings
    bookings.value = await fetchCalendar({
      from: weekStart.value,
      to: addDays(weekStart.value, 6)
    })

    // Step 3: our CCA's waitlist entries
    if (session.value.activeClubId) {
      myEntries.value = await fetchActiveClubEntries(session.value.activeClubId)
    } else {
      myEntries.value = []
    }
  } catch (error) {
    console.log(error.message)
    showToast('Could not load the calendar: ' + error.message, 'danger')
  }
  loading.value = false
}

watch(weekStart, () => {
  selectedDay.value = null
  load()
})

let stopListening = null
let reloadTimer = null

onMounted(() => {
  load()
  // Another browser released or claimed something: wait a moment, then reload
  stopListening = listenForCalendarChanges(() => {
    clearTimeout(reloadTimer)
    reloadTimer = setTimeout(load, 400)
  })
})

onUnmounted(() => {
  if (stopListening) {
    stopListening()
  }
  clearTimeout(reloadTimer)
})

// ---------------- Filters ----------------

function matchesCapacity(capacity) {
  const band = filters.value.capacity
  if (band === '1-25') {
    return capacity <= 25
  }
  if (band === '26-50') {
    return capacity >= 26 && capacity <= 50
  }
  if (band === '51-150') {
    return capacity >= 51 && capacity <= 150
  }
  if (band === '151+') {
    return capacity > 150
  }
  return true
}

function matchesSearch(booking, facility) {
  const search = filters.value.search.trim().toLowerCase()
  if (search === '') {
    return true
  }

  // Join every searchable word into one string
  let text = facility.name + ' ' + facility.location + ' ' + facility.facility_type
  if (facility.equipment) {
    text += ' ' + facility.equipment.join(' ')
  }
  if (booking.owner_club_name) {
    text += ' ' + booking.owner_club_name
  }
  if (booking.claiming_club_name) {
    text += ' ' + booking.claiming_club_name
  }
  if (booking.fbs_reference) {
    text += ' ' + booking.fbs_reference
  }
  return text.toLowerCase().includes(search)
}

function matchesFacility(facility) {
  if (filters.value.type !== 'All' && facility.facility_type !== filters.value.type) {
    return false
  }
  if (filters.value.equipment !== 'All') {
    const equipment = facility.equipment || []
    if (!equipment.includes(filters.value.equipment)) {
      return false
    }
  }
  return matchesCapacity(facility.capacity)
}

// Bookings that pass the status and day filters
const visibleBookings = computed(() => {
  return bookings.value.filter((booking) => {
    if(!bookingMatchesSimulatorFocus(booking,simulatorFocus.value))return false
    if (filters.value.availability !== 'All' && booking.status !== filters.value.availability) {
      return false
    }
    if (selectedDay.value && booking.booking_date !== selectedDay.value) {
      return false
    }
    return true
  })
})

// Open and pending slots per day, shown on the week calendar tiles
const dayCounts = computed(() => {
  const result = {}
  bookings.value.forEach((booking) => {
    if (!result[booking.booking_date]) {
      result[booking.booking_date] = { available: 0, pending: 0 }
    }
    if (booking.status === STATUSES.PROPOSED) {
      result[booking.booking_date].available += 1
    }
    if (booking.status === STATUSES.PENDING) {
      result[booking.booking_date].pending += 1
    }
  })
  return result
})

// One group per facility, each with its bookings
const groups = computed(() => {
  const isNarrowing = filters.value.availability !== 'All' || filters.value.search.trim() !== '' || selectedDay.value !== null
  const result = []

  facilities.value.forEach((facility) => {
    if(simulatorFocus.value&&!simulatorFocus.value.error&&String(facility.id)!==String(simulatorFocus.value.facilityId))return
    if (!matchesFacility(facility)) {
      return
    }
    // Bookings are already sorted: released, pending, booked, confirmed
    const facilityBookings = visibleBookings.value.filter((booking) => {
      return booking.facility_id === facility.id && matchesSearch(booking, facility)
    })
    // While filtering, hide facilities with nothing to show
    if (facilityBookings.length > 0 || !isNarrowing) {
      result.push({ facility: facility, bookings: facilityBookings })
    }
  })
  return result
})

// Totals shown at the top of the page
const counts = computed(() => {
  const result = { booked: 0, available: 0, pending: 0 }
  groups.value.forEach((group) => {
    group.bookings.forEach((booking) => {
      if (booking.status === STATUSES.BOOKED) {
        result.booked += 1
      } else if (booking.status === STATUSES.PROPOSED) {
        result.available += 1
      } else if (booking.status === STATUSES.PENDING) {
        result.pending += 1
      }
    })
  })
  return result
})

// booking_id -> our waitlist entry for it
const entryByBooking = computed(() => {
  const result = {}
  myEntries.value.forEach((entry) => {
    result[entry.booking_id] = entry
  })
  return result
})

// booking_id -> the buttons that booking shows
const actionsByBooking = computed(() => {
  const result = {}
  bookings.value.forEach((booking) => {
    result[booking.booking_id] = bookingActions(booking, {
      clubId: session.value.activeClubId,
      canManage: canManageActiveClub.value,
      isOslAdmin: session.value.isOslAdmin,
      waitlistEntry: entryByBooking.value[booking.booking_id]
    })
  })
  return result
})

// ---------------- Actions ----------------

// Text for the confirm pop-up of each action
const CONFIRM_TEXT = {
  release: {
    title: 'Release this slot?',
    message: 'It becomes a Proposed Peer Transfer. If other CCAs are waitlisted, the first one gets a 30-minute offer; otherwise any CCA can claim it.',
    confirmLabel: 'Release slot'
  },
  undo: {
    title: 'Undo this release?',
    message: 'The slot goes back to Booked for your CCA.',
    confirmLabel: 'Undo release'
  },
  claim: {
    title: 'Claim this slot?',
    message: 'The booking becomes Pending Admin Sign-off. It is only official once OSL approves the transfer.',
    confirmLabel: 'Submit claim'
  },
  leave: {
    title: 'Decline this offer?',
    message: 'You are holding the 30-minute offer. Leaving the waitlist passes the slot to the next CCA in the queue.',
    confirmLabel: 'Decline and leave',
    danger: true
  }
}

function slotDetails(booking) {
  return [
    { label: 'Facility', value: booking.facility_name },
    { label: 'When', value: formatDate(booking.booking_date, true) + ', ' + formatTime(booking.start_time) + ' – ' + formatTime(booking.end_time) },
    { label: 'Holder', value: booking.owner_club_name },
    { label: 'FBS reference', value: booking.fbs_reference }
  ]
}

// A button on a booking card was clicked
function onAction(type, booking) {
  // OSL: open the approvals page for this transfer
  if (type === 'review') {
    router.push({ path: '/facilities/admin', query: { transfer: booking.transfer_id } })
    return
  }

  // Joining the waitlist needs no confirmation
  if (type === 'join') {
    runAction(booking, joinTheWaitlist)
    return
  }

  // Leaving is only confirmed when we are holding an offer
  const entry = entryByBooking.value[booking.booking_id]
  if (type === 'leave' && (!entry || entry.status !== 'OFFERED')) {
    runAction(booking, leaveTheWaitlist)
    return
  }

  // Everything else opens the confirm pop-up
  const text = CONFIRM_TEXT[type]
  pending.value = {
    type: type,
    booking: booking,
    title: text.title,
    message: text.message,
    confirmLabel: text.confirmLabel,
    danger: text.danger,
    details: slotDetails(booking)
  }
}

async function joinTheWaitlist(booking) {
  const result = await joinWaitlist(booking.booking_id, session.value.activeClubId)
  showToast(activeClubName.value + ' is #' + result.queue_position + ' on the waitlist for ' + booking.facility_name + '.', 'success')
}

async function leaveTheWaitlist(booking) {
  await leaveWaitlist(booking.booking_id, session.value.activeClubId)
  showToast('Left the waitlist for ' + booking.facility_name + '.', 'info')
}

// The confirm pop-up's main button was clicked
async function confirmPending() {
  const type = pending.value.type
  const booking = pending.value.booking

  await runAction(booking, async () => {
    const clubId = session.value.activeClubId

    if (type === 'release') {
      const result = await releaseBooking(booking.booking_id, clubId)
      if (result.waitlist_offer_entry_id) {
        showToast('Released. The first CCA on the waitlist now has 30 minutes to claim ' + booking.facility_name + '.', 'success')
      } else {
        showToast('Released. ' + booking.facility_name + ' is now open for other CCAs to claim.', 'success')
      }
    } else if (type === 'undo') {
      await undoRelease(booking.booking_id, clubId)
      showToast('Release undone. ' + booking.facility_name + ' is Booked for ' + activeClubName.value + ' again.', 'success')
    } else if (type === 'claim') {
      await claimBooking(booking.booking_id, clubId)
      showToast('Claim submitted: Pending Admin Sign-off. The transfer request has been emailed to OSL.', 'success')
    } else if (type === 'leave') {
      await leaveWaitlist(booking.booking_id, clubId)
      showToast('Offer declined. The next CCA in the queue has been notified.', 'info')
    }
  })
  pending.value = null
}

// Show the card as busy, run the action, then reload the page data
async function runAction(booking, action) {
  busyBookingId.value = booking.booking_id
  try {
    await action(booking)
  } catch (error) {
    console.log(error.message)
    showToast(error.message, 'danger')
  }
  busyBookingId.value = null
  loadOffers()
  await load()
}
</script>

<template>
  <FacilityTabs :waitlist-count="myEntries.length" :offer-count="myEntries.filter(e => e.status === 'OFFERED').length" />

  <PageHero
    title="Pulse - Master Facility Calendar"
    subtitle="Find released CCA facility slots and coordinate peer transfers through one streamlined workflow."
    :stats="[
      { label: 'Booked', value: counts.booked, tone: 'plain' },
      { label: 'Available to claim', value: counts.available, tone: 'green' },
      { label: 'Pending approval', value: counts.pending, tone: 'sky' }
    ]"
  />

  <WeekNavigator
    v-model:week-start="weekStart"
    v-model:selected-day="selectedDay"
    :day-counts="dayCounts"
    selectable
  />

  <div v-if="session.memberships.length && !canManageActiveClub" class="pulse-banner pulse-banner-view">
    <strong>View only.</strong> You are {{ session.memberships.find(m => m.club_id === session.activeClubId)?.role_name }} of {{ activeClubName }}.
    Only its Logistics Director can release, claim or join waitlists.
  </div>
  <div v-else-if="!session.memberships.length && !session.isOslAdmin" class="pulse-banner pulse-banner-view">
    <strong>Browsing as a public viewer.</strong> Sign in as a CCA Logistics Director to release or claim slots.
  </div>
  <div v-else-if="canManageActiveClub && myEntries.some(e => e.status === 'OFFERED')" class="pulse-banner pulse-banner-hot">
    <strong>{{ activeClubName }} has a live waitlist offer.</strong>
    Look for "Accept offer" below, or open the <RouterLink to="/facilities/waitlist">Waitlist</RouterLink> tab.
  </div>

  <div v-if="simulatorFocus && !loading" class="pulse-banner pulse-banner-view" role="status" data-testid="simulator-calendar-focus">
    <template v-if="simulatorFocus.error">{{ simulatorFocus.error }}</template>
    <template v-else>
      <strong>{{ simulatorFocus.facilityName }}</strong> | Requested (Singapore): {{ simulatorRequestedPeriod }}.
      Showing overlapping calendar slots; check full time coverage, capacity and suitability.
      This request has not booked or claimed anything. Use the normal calendar actions and approvals.
    </template>
    <button type="button" class="btn btn-sm btn-outline-secondary ms-2" @click="clearSimulatorFocus">Clear simulator focus</button>
  </div>
  <FacilityFilters v-model:filters="filters" :facilities="facilities" :week-label="weekLabel" />

  <div v-if="loading" class="text-center py-5">
    <div class="spinner-border text-danger" role="status"></div>
    <p class="text-muted small mt-2">Loading facility data…</p>
  </div>
  <div v-else-if="!groups.length" class="pulse-panel text-center p-5">
    <h2 class="h6 fw-bold">No facilities match these filters</h2>
    <p class="text-muted small mb-0">Try another week or loosen the filters.</p>
  </div>
  <div v-else class="d-flex flex-column gap-4">
    <FacilityCard
      v-for="(group, i) in groups"
      :key="group.facility.id"
      :index="i"
      :highlight-club-id="session.activeClubId"
      :facility="group.facility"
      :bookings="group.bookings"
      :actions-by-booking="actionsByBooking"
      :waitlist-by-booking="canManageActiveClub ? entryByBooking : {}"
      :busy-booking-id="busyBookingId"
      @action="onAction"
    />
  </div>

  <ConfirmActionModal
    :show="!!pending"
    :title="pending?.title"
    :message="pending?.message"
    :details="pending?.details || []"
    :confirm-label="pending?.confirmLabel"
    :danger="pending?.danger"
    :busy="busyBookingId !== null"
    @confirm="confirmPending"
    @cancel="pending = null"
  />
</template>
