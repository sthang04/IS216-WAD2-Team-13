<script setup>

// Everything about the CCA we are acting for, for the selected week:
// slots we hold, slots we released, and how our transfers went.

import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageHero from '../components/PageHero.vue'
import FacilityTabs from '../components/FacilityTabs.vue'
import WeekNavigator from '../components/WeekNavigator.vue'
import BookingSlotCard from '../components/BookingSlotCard.vue'
import BookingStatusBadge from '../components/BookingStatusBadge.vue'
import ConfirmActionModal from '../components/ConfirmActionModal.vue'
import { loadOffers } from '../services/notificationStore'
import { session, activeMembership, activeClubName, canManageActiveClub, showToast } from '../services/sessionState'
import {
  STATUSES, fetchCalendar, fetchClubTransfers, releaseBooking, undoRelease,
  listenForCalendarChanges, bookingActions, defaultWeekStart, weekStartOf, addDays,
  formatDate, formatTime
} from '../services/facilityCalendarService'
import { fetchActiveClubEntries } from '../services/waitlistService'
import { requestOslEmail } from '../services/transferService'

const route = useRoute()
const router = useRouter()

// ---------------- Data ----------------

const weekRows = ref([])        // our bookings this week
const transfers = ref([])       // every transfer we released or claimed
const waitlistEntries = ref([])
const loading = ref(true)
const busyId = ref(null)
const pending = ref(null)       // the action waiting in the confirm pop-up

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

const weekEnd = computed(() => {
  return addDays(weekStart.value, 6)
})

// ---------------- Loading ----------------

async function load() {
  const clubId = session.value.activeClubId
  if (!clubId) {
    loading.value = false
    return
  }
  try {
    weekRows.value = await fetchCalendar({ from: weekStart.value, to: weekEnd.value, ownerClubId: clubId })
    transfers.value = await fetchClubTransfers(clubId)
    waitlistEntries.value = await fetchActiveClubEntries(clubId)
  } catch (error) {
    console.log(error.message)
    showToast('Could not load ' + activeClubName.value + ': ' + error.message, 'danger')
  }
  loading.value = false
}

watch(weekStart, load)

let stopListening = null

onMounted(() => {
  load()
  stopListening = listenForCalendarChanges(load)
})

onUnmounted(() => {
  if (stopListening) {
    stopListening()
  }
})

// ---------------- Lists on the page ----------------

// Earliest slot first
function byDateTime(a, b) {
  const first = a.booking_date + ' ' + a.start_time
  const second = b.booking_date + ' ' + b.start_time
  return first.localeCompare(second)
}

function isInWeek(row) {
  return row.booking_date >= weekStart.value && row.booking_date <= weekEnd.value
}

// Slots our CCA holds this week
const assigned = computed(() => {
  const rows = weekRows.value.filter((booking) => {
    return booking.status === STATUSES.BOOKED || booking.status === STATUSES.CONFIRMED
  })
  return rows.sort(byDateTime)
})

// Slots we released this week
const released = computed(() => {
  const rows = weekRows.value.filter((booking) => booking.status === STATUSES.PROPOSED)
  return rows.sort(byDateTime)
})

const weekTransfers = computed(() => {
  return transfers.value.filter(isInWeek).sort(byDateTime)
})

const pendingTransfers = computed(() => {
  return weekTransfers.value.filter((transfer) => transfer.state === 'CLAIMED')
})

const successfulTransfers = computed(() => {
  return weekTransfers.value.filter((transfer) => transfer.state === 'APPROVED')
})

const rejectedTransfers = computed(() => {
  return weekTransfers.value.filter((transfer) => transfer.state === 'REJECTED' || transfer.state === 'EXPIRED')
})

const liveOffers = computed(() => {
  let count = 0
  waitlistEntries.value.forEach((entry) => {
    if (entry.status === 'OFFERED') {
      count += 1
    }
  })
  return count
})

// The five boxes at the top of the page
const stats = computed(() => {
  return [
    { key: 'assigned', label: 'Assigned this week', value: assigned.value.length, tone: 'plain' },
    { key: 'released', label: 'Released by us', value: released.value.length, tone: 'amber' },
    { key: 'pending', label: 'Pending transfers', value: pendingTransfers.value.length, tone: 'sky' },
    { key: 'successful', label: 'Successful transfers', value: successfulTransfers.value.length, tone: 'green' },
    { key: 'rejected', label: 'Rejected transfers', value: rejectedTransfers.value.length, tone: 'red' }
  ]
})

// Clicking a box scrolls to its section
function scrollTo(key) {
  const section = document.getElementById('section-' + key)
  if (section) {
    section.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

function actionsFor(booking) {
  return bookingActions(booking, {
    clubId: session.value.activeClubId,
    canManage: canManageActiveClub.value,
    isOslAdmin: false
  })
}

function emailSent(transfer) {
  const status = transfer.osl_email_status
  return status === 'QUEUED' || status === 'SENDING' || status === 'SENT'
}

function emailFailed(transfer) {
  return transfer.osl_email_status === 'FAILED'
}

// ---------------- Actions ----------------

function slotDetails(row) {
  return [
    { label: 'Facility', value: row.facility_name },
    { label: 'When', value: formatDate(row.booking_date, true) + ', ' + formatTime(row.start_time) + ' – ' + formatTime(row.end_time) },
    { label: 'FBS reference', value: row.fbs_reference }
  ]
}

function onBookingAction(type, booking) {
  if (type === 'release') {
    pending.value = {
      type: 'release',
      id: booking.booking_id,
      row: booking,
      title: 'Release this slot?',
      message: 'It becomes a Proposed Peer Transfer. Waitlisted CCAs are offered it first, in queue order.',
      confirmLabel: 'Release slot',
      details: slotDetails(booking)
    }
  } else if (type === 'undo') {
    pending.value = {
      type: 'undo',
      id: booking.booking_id,
      row: booking,
      title: 'Undo this release?',
      message: 'The slot goes back to Booked for your CCA.',
      confirmLabel: 'Undo release',
      details: slotDetails(booking)
    }
  }
}

// The OSL request is emailed automatically when a CCA claims.
// This button is only for when that email failed.
function askResendOsl(transfer) {
  const details = slotDetails(transfer)
  details.push({ label: 'Transfer', value: transfer.releasing_club_name + ' → ' + transfer.claiming_club_name })

  pending.value = {
    type: 'resend',
    id: transfer.transfer_id,
    row: transfer,
    title: 'Resend the transfer request to OSL?',
    message: 'The automatic email to OSL did not go through. Pulse will try again, signed with your name as Logistics Director.',
    confirmLabel: 'Resend to OSL',
    details: details
  }
}

async function confirmPending() {
  const type = pending.value.type
  const row = pending.value.row
  const clubId = session.value.activeClubId
  busyId.value = pending.value.id

  try {
    if (type === 'release') {
      await releaseBooking(row.booking_id, clubId)
      showToast(row.facility_name + ' released.', 'success')
    } else if (type === 'undo') {
      await undoRelease(row.booking_id, clubId)
      showToast('Release undone.', 'success')
    } else if (type === 'resend') {
      await requestOslEmail(row.transfer_id, clubId)
      showToast('Request queued for OSL.', 'success')
    }
  } catch (error) {
    console.log(error.message)
    showToast(error.message, 'danger')
  }

  busyId.value = null
  pending.value = null
  load()
  loadOffers()
}
</script>

<template>
  <FacilityTabs :waitlist-count="waitlistEntries.length" :offer-count="liveOffers" />

  <PageHero
    tag="My Club"
    :title="activeClubName || 'My Club'"
    :subtitle="activeMembership
      ? (canManageActiveClub ? 'You are the Logistics Director: you can release and claim slots. Claims are emailed to OSL automatically.'
                             : `You are ${activeMembership.role_name}. You can see everything here, but only the Logistics Director can act.`)
      : 'Your club\'s bookings, releases and transfers, week by week.'"
  />


  <div v-if="!session.activeClubId" class="pulse-panel p-5 text-center pulse-empty">
    <h2 class="h6 fw-bold">My Club is for CCA members</h2>
    <p class="text-muted small mb-0">
      {{ session.isOslAdmin ? 'OSL reviews transfers from the OSL Review tab.' : 'Pick a persona that belongs to a CCA to see its bookings.' }}
    </p>
  </div>

  <template v-else>
    <WeekNavigator v-model:week-start="weekStart" />

    <div class="pulse-stat-grid mb-4">
      <button v-for="stat in stats" :key="stat.key" type="button" class="pulse-stat-card" :class="`tone-${stat.tone}`" @click="scrollTo(stat.key)">
        <span class="pulse-stat-card-num">{{ stat.value }}</span>
        <span class="pulse-stat-card-label">{{ stat.label }}</span>
      </button>
    </div>

    <div v-if="!canManageActiveClub" class="pulse-banner pulse-banner-view">
      <strong>View only.</strong> Release and claim are limited to {{ activeClubName }}'s Logistics Director.
    </div>
    <RouterLink v-if="liveOffers" to="/facilities/waitlist" class="pulse-banner pulse-banner-hot d-block text-decoration-none">
      <strong>{{ liveOffers }} live waitlist offer{{ liveOffers === 1 ? '' : 's' }}</strong> for {{ activeClubName }}. Open the Waitlist tab to accept →
    </RouterLink>

    <div v-if="loading" class="text-center py-5"><div class="spinner-border text-danger" role="status"></div></div>

    <template v-else>
      <!-- 1. What we hold this week -->
      <section id="section-assigned" class="pulse-panel pulse-section overflow-hidden mb-4" style="--i: 0">
        <header class="pulse-section-head tone-plain">
          <div>
            <h2 class="h6 fw-bold mb-0">My Assigned Bookings</h2>
            <p class="text-muted small mb-0">Recurring FBS allocations and officially confirmed transfers {{ activeClubName }} holds this week.</p>
          </div>
          <span class="pulse-count">{{ assigned.length }}</span>
        </header>
        <p v-if="!assigned.length" class="p-3 text-muted small mb-0">No assigned bookings this week.</p>
        <BookingSlotCard
          v-for="(b, i) in assigned"
          :key="b.booking_id"
          :index="i"
          :booking="b"
          :actions="actionsFor(b)"
          :busy="busyId === b.booking_id"
          show-facility
          @action="onBookingAction"
        />
      </section>

      <!-- 2. Waiting on OSL -->
      <section id="section-pending" class="pulse-panel pulse-section overflow-hidden mb-4" style="--i: 1">
        <header class="pulse-section-head tone-sky">
          <div>
            <h2 class="h6 fw-bold mb-0">Pending Transfers</h2>
            <p class="text-muted small mb-0">Claims made by {{ activeClubName }}, or on slots it released. Only OSL can approve them.</p>
          </div>
          <span class="pulse-count">{{ pendingTransfers.length }}</span>
        </header>
        <p v-if="!pendingTransfers.length" class="p-3 text-muted small mb-0">No transfers waiting for OSL this week.</p>
        <div v-for="(t, i) in pendingTransfers" :key="t.transfer_id" class="pulse-slot is-pending" :style="{ '--i': i }">
          <div class="pulse-slot-when">
            <div class="fw-semibold">{{ formatDate(t.booking_date) }}</div>
            <div class="small text-muted">{{ formatTime(t.start_time) }} – {{ formatTime(t.end_time) }}</div>
            <div class="small fw-semibold mt-1">{{ t.facility_name }}</div>
          </div>
          <div class="pulse-slot-status">
            <BookingStatusBadge status="Pending Admin Sign-off" />
            <div class="small mt-1"><span class="pulse-direction" :class="t.direction === 'OUTGOING' ? 'out' : 'in'">{{ t.direction === 'OUTGOING' ? '↗ Outgoing' : '↙ Incoming' }}</span></div>
          </div>
          <div class="pulse-slot-who small">{{ t.releasing_club_name }} → <strong>{{ t.claiming_club_name }}</strong></div>
          <div class="pulse-slot-ref small font-monospace">{{ t.fbs_reference }}</div>
          <div class="pulse-slot-actions">
            <template v-if="emailFailed(t)">
              <button v-if="t.direction === 'OUTGOING' && canManageActiveClub" type="button" class="btn btn-sm btn-pulse-primary pulse-attention" :disabled="busyId === t.transfer_id" @click="askResendOsl(t)">Resend to OSL</button>
              <span v-else class="small text-warning-emphasis">Email to OSL failed</span>
            </template>
            <span v-else-if="emailSent(t)" class="small text-success fw-semibold">✓ Emailed to OSL for review</span>
            <span v-else class="small text-muted">Sending to OSL…</span>
          </div>
        </div>
      </section>

      <!-- 3. Released, not yet claimed -->
      <section id="section-released" class="pulse-panel pulse-section overflow-hidden mb-4" style="--i: 2">
        <header class="pulse-section-head tone-amber">
          <div>
            <h2 class="h6 fw-bold mb-0">Released by My Club</h2>
            <p class="text-muted small mb-0">Offered as Proposed Peer Transfers this week and not claimed yet.</p>
          </div>
          <span class="pulse-count">{{ released.length }}</span>
        </header>
        <p v-if="!released.length" class="p-3 text-muted small mb-0">Nothing released this week.</p>
        <BookingSlotCard
          v-for="(b, i) in released"
          :key="b.booking_id"
          :index="i"
          :booking="b"
          :actions="actionsFor(b)"
          :busy="busyId === b.booking_id"
          show-facility
          @action="onBookingAction"
        />
      </section>

      <!-- 4. Approved -->
      <section id="section-successful" class="pulse-panel pulse-section overflow-hidden mb-4" style="--i: 3">
        <header class="pulse-section-head tone-green">
          <div>
            <h2 class="h6 fw-bold mb-0">Successful Transfers</h2>
            <p class="text-muted small mb-0">Approved by OSL. Incoming slots also appear under My Assigned Bookings.</p>
          </div>
          <span class="pulse-count">{{ successfulTransfers.length }}</span>
        </header>
        <p v-if="!successfulTransfers.length" class="p-3 text-muted small mb-0">No approved transfers this week.</p>
        <div v-for="(t, i) in successfulTransfers" :key="t.transfer_id" class="pulse-slot is-confirmed" :style="{ '--i': i }">
          <div class="pulse-slot-when">
            <div class="fw-semibold">{{ formatDate(t.booking_date) }}</div>
            <div class="small text-muted">{{ formatTime(t.start_time) }} – {{ formatTime(t.end_time) }}</div>
            <div class="small fw-semibold mt-1">{{ t.facility_name }}</div>
          </div>
          <div class="pulse-slot-status">
            <BookingStatusBadge status="Officially Confirmed Booking" />
            <div class="small mt-1"><span class="pulse-direction" :class="t.direction === 'OUTGOING' ? 'out' : 'in'">{{ t.direction === 'OUTGOING' ? '↗ Handed over' : '↙ Received' }}</span></div>
          </div>
          <div class="pulse-slot-who small">{{ t.releasing_club_name }} → <strong>{{ t.claiming_club_name }}</strong></div>
          <div class="pulse-slot-ref small font-monospace">{{ t.fbs_reference }}</div>
          <div class="pulse-slot-actions small text-muted">Approved {{ t.decided_at ? new Date(t.decided_at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' }) : '' }}</div>
        </div>
      </section>

      <!-- 5. Rejected -->
      <section id="section-rejected" class="pulse-panel pulse-section overflow-hidden mb-4" style="--i: 4">
        <header class="pulse-section-head tone-red">
          <div>
            <h2 class="h6 fw-bold mb-0">Rejected Transfers</h2>
            <p class="text-muted small mb-0">OSL rejected these, or did not sign off 48 hours before the booking (the slot then stays with the releasing CCA). The history is kept.</p>
          </div>
          <span class="pulse-count">{{ rejectedTransfers.length }}</span>
        </header>
        <p v-if="!rejectedTransfers.length" class="p-3 text-muted small mb-0">No rejected transfers this week.</p>
        <div v-for="(t, i) in rejectedTransfers" :key="t.transfer_id" class="pulse-slot is-rejected" :style="{ '--i': i }">
          <div class="pulse-slot-when">
            <div class="fw-semibold">{{ formatDate(t.booking_date) }}</div>
            <div class="small text-muted">{{ formatTime(t.start_time) }} – {{ formatTime(t.end_time) }}</div>
            <div class="small fw-semibold mt-1">{{ t.facility_name }}</div>
          </div>
          <div class="pulse-slot-status">
            <span class="pulse-badge pulse-badge-rejected">{{ t.state === 'EXPIRED' ? 'Deadline passed' : 'Not approved' }}</span>
            <div class="small mt-1"><span class="pulse-direction" :class="t.direction === 'OUTGOING' ? 'out' : 'in'">{{ t.direction === 'OUTGOING' ? '↗ Outgoing' : '↙ Incoming' }}</span></div>
          </div>
          <div class="pulse-slot-who small">
            {{ t.releasing_club_name }} → <strong>{{ t.claiming_club_name }}</strong>
            <div v-if="t.rejection_reason" class="text-muted">Reason: {{ t.rejection_reason }}</div>
          </div>
          <div class="pulse-slot-ref small font-monospace">{{ t.fbs_reference }}</div>
          <div class="pulse-slot-actions small text-muted">{{ t.decided_at ? new Date(t.decided_at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' }) : '' }}</div>
        </div>
      </section>
    </template>
  </template>

  <ConfirmActionModal
    :show="!!pending"
    :title="pending?.title"
    :message="pending?.message"
    :details="pending?.details || []"
    :confirm-label="pending?.confirmLabel"
    :busy="busyId !== null"
    @confirm="confirmPending"
    @cancel="pending = null"
  />
</template>
