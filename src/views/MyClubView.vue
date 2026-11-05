<script setup>

// Everything about the CCA we are acting for, for the selected week:
// slots we hold, slots we released, and how our transfers went.

import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageHero from '../components/PageHero.vue'
import FacilityTabs from '../components/FacilityTabs.vue'
import WeekNavigator from '../components/WeekNavigator.vue'
import BookingSlotCard from '../components/BookingSlotCard.vue'
import ConfirmActionModal from '../components/ConfirmActionModal.vue'
import { loadOffers } from '../services/notificationStore'
import { session, activeMembership, activeClubName, canManageActiveClub, showToast } from '../services/sessionState'
import {
  STATUSES, fetchCalendar, fetchClubTransfers, releaseBooking, undoRelease,
  listenForCalendarChanges, bookingActions, defaultWeekStart, weekStartOf, addDays,
  formatDate, formatTime, formatReference
} from '../services/facilityService'
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

// The folder tabs: each one opens a section of the page
const TABS = [
  { key: 'assigned', label: 'My Bookings', tone: 'own' },
  { key: 'pending', label: 'Pending', tone: 'pending' },
  { key: 'released', label: 'Released', tone: 'claim' },
  { key: 'successful', label: 'Successful', tone: 'success' },
  { key: 'rejected', label: 'Rejected', tone: 'rejected' }
]
const activeTab = ref('assigned')
const TAB_COLOURS = {
  assigned: 'var(--pf-primary)',
  pending: 'var(--pf-sky)',
  released: 'var(--pf-violet)',
  successful: 'var(--pf-green)',
  rejected: '#8a8494'
}
const emailNeedsAttention = computed(() => pendingTransfers.value.some((transfer) => emailFailed(transfer)))

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
    { label: 'FBS reference', value: formatReference(row.fbs_reference) }
  ]
}

function onBookingAction(type, booking) {
  if (type === 'release') {
    pending.value = {
      type: 'release',
      id: booking.booking_id,
      row: booking,
      title: 'Release this slot?',
      message: 'It becomes Available to Claim. Waitlisted CCAs are offered it first, in queue order.',
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
      activeTab.value = 'released'
    } else if (type === 'undo') {
      await undoRelease(row.booking_id, clubId)
      showToast('Release undone.', 'success')
      activeTab.value = 'assigned'
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
      ? 'Your CCA’s bookings and transfers, week by week. Every transfer needs OSL approval.'
      : 'Your CCA’s bookings and transfers, week by week.'"
    :stats="session.activeClubId ? [
      { label: 'Facilities booked', value: assigned.length, tone: 'plain' },
      { label: 'Pending transfers', value: pendingTransfers.length, tone: 'sky' }
    ] : []"
  />


  <div v-if="!session.activeClubId" class="pulse-panel p-5 text-center pulse-empty">
    <h2 class="h6 fw-bold">My Club is for CCA members</h2>
    <p class="text-muted small mb-0">
      {{ session.isOslAdmin ? 'OSL reviews transfers from the OSL Review tab.' : 'Pick a persona that belongs to a CCA to see its bookings.' }}
    </p>
  </div>

  <template v-else>
    <WeekNavigator v-model:week-start="weekStart" />

    <div v-if="!session.isDev && !canManageActiveClub" class="pulse-banner pulse-banner-view">
      <strong>View only.</strong> Release and claim are limited to {{ activeClubName }}'s Logistics Director.
    </div>
    <RouterLink v-if="liveOffers" to="/facilities/waitlist" class="pulse-banner pulse-banner-hot d-block text-decoration-none">
      <strong>{{ liveOffers }} live waitlist offer{{ liveOffers === 1 ? '' : 's' }}</strong> for {{ activeClubName }}. Open the Waitlist tab to accept →
    </RouterLink>

    <div v-if="loading" class="text-center py-5"><div class="spinner-border text-danger" role="status"></div></div>

    <div v-else class="pulse-folder" :style="{ '--active-tab': TAB_COLOURS[activeTab] }">
      <div class="pulse-folder-tabs" role="tablist" aria-label="My Club sections">
        <button
          v-for="tab in TABS"
          :id="`tab-${tab.key}`"
          :key="tab.key"
          type="button"
          role="tab"
          class="pulse-folder-tab"
          :class="[`tone-${tab.tone}`, { active: activeTab === tab.key }]"
          :aria-selected="activeTab === tab.key"
          :aria-controls="`section-${tab.key}`"
          @click="activeTab = tab.key"
        >{{ tab.label }}<span v-if="tab.key === 'pending' && emailNeedsAttention" class="pulse-folder-alert" title="An email to OSL failed"></span></button>
      </div>

      <div class="pulse-folder-page">
        <Transition name="pulse-folder-swap" mode="out-in">
          <!-- What we hold this week -->
          <section v-if="activeTab === 'assigned'" id="section-assigned" key="assigned" role="tabpanel" aria-labelledby="tab-assigned" class="pulse-folder-section">
            <header class="pulse-section-head tone-plain">
              <div>
                <h2 class="h6 fw-bold mb-0">My Assigned Bookings</h2>
                <p class="text-muted small mb-0">Slots {{ activeClubName }} holds this week.</p>
              </div>
            </header>
            <p v-if="!assigned.length" class="p-3 text-muted small mb-0">No bookings this week.</p>
            <BookingSlotCard
              v-for="(b, i) in assigned"
              :key="b.booking_id"
              :index="i"
              :booking="b"
              :actions="actionsFor(b)"
              :busy="busyId === b.booking_id"
              :highlight-club-id="session.activeClubId"
              plain-owner
              show-facility
              @action="onBookingAction"
            />
          </section>

          <!-- Waiting on OSL -->
          <section v-else-if="activeTab === 'pending'" id="section-pending" key="pending" role="tabpanel" aria-labelledby="tab-pending" class="pulse-folder-section">
            <header class="pulse-section-head tone-sky">
              <div>
                <h2 class="h6 fw-bold mb-0">Pending Transfers</h2>
                <p class="text-muted small mb-0">Waiting for OSL to approve.</p>
              </div>
            </header>
            <p v-if="!pendingTransfers.length" class="p-3 text-muted small mb-0">Nothing waiting for OSL this week.</p>
            <div v-for="(t, i) in pendingTransfers" :key="t.transfer_id" class="pulse-slot is-pending" :style="{ '--i': i }">
              <div class="pulse-slot-when">
                <div class="fw-semibold">{{ formatDate(t.booking_date) }}</div>
                <div class="small text-muted">{{ formatTime(t.start_time) }} – {{ formatTime(t.end_time) }}</div>
                <div class="small fw-semibold mt-1">{{ t.facility_name }}</div>
              </div>
              <div class="pulse-slot-status"><span class="pulse-badge pulse-badge-pending">Awaiting OSL approval</span></div>
              <div class="pulse-slot-who small">
                <component :is="t.direction === 'OUTGOING' ? 'strong' : 'span'">{{ t.releasing_club_name }}</component> →
                <component :is="t.direction === 'OUTGOING' ? 'span' : 'strong'">{{ t.claiming_club_name }}</component>
              </div>
              <div class="pulse-slot-ref small font-monospace">{{ formatReference(t.fbs_reference) }}</div>
              <div class="pulse-slot-actions">
                <template v-if="emailFailed(t)">
                  <button v-if="t.direction === 'OUTGOING' && canManageActiveClub" type="button" class="btn btn-sm btn-pulse-primary pulse-attention" :disabled="busyId === t.transfer_id" @click="askResendOsl(t)">Resend to OSL</button>
                  <span v-else class="small text-warning-emphasis">Email to OSL failed</span>
                </template>
                <span v-else-if="emailSent(t)" class="small text-success fw-semibold">✓ Emailed to OSL</span>
                <span v-else class="small text-muted">Sending to OSL…</span>
              </div>
            </div>
          </section>

          <!-- Released, not yet claimed -->
          <section v-else-if="activeTab === 'released'" id="section-released" key="released" role="tabpanel" aria-labelledby="tab-released" class="pulse-folder-section">
            <header class="pulse-section-head tone-amber">
              <div>
                <h2 class="h6 fw-bold mb-0">Released by My Club</h2>
                <p class="text-muted small mb-0">Released this week and not claimed yet.</p>
              </div>
            </header>
            <p v-if="!released.length" class="p-3 text-muted small mb-0">Nothing released this week.</p>
            <BookingSlotCard
              v-for="(b, i) in released"
              :key="b.booking_id"
              :index="i"
              :booking="b"
              :actions="actionsFor(b)"
              :busy="busyId === b.booking_id"
              :highlight-club-id="session.activeClubId"
              plain-owner
              show-facility
              @action="onBookingAction"
            />
          </section>

          <!-- Approved -->
          <section v-else-if="activeTab === 'successful'" id="section-successful" key="successful" role="tabpanel" aria-labelledby="tab-successful" class="pulse-folder-section">
            <header class="pulse-section-head tone-green">
              <div>
                <h2 class="h6 fw-bold mb-0">Successful Transfers</h2>
                <p class="text-muted small mb-0">Approved by OSL. Slots you received also appear under My Bookings.</p>
              </div>
            </header>
            <p v-if="!successfulTransfers.length" class="p-3 text-muted small mb-0">No approved transfers this week.</p>
            <div v-for="(t, i) in successfulTransfers" :key="t.transfer_id" class="pulse-slot" :class="t.direction === 'OUTGOING' ? 'is-handed-over' : 'is-confirmed'" :style="{ '--i': i }">
              <div class="pulse-slot-when">
                <div class="fw-semibold">{{ formatDate(t.booking_date) }}</div>
                <div class="small text-muted">{{ formatTime(t.start_time) }} – {{ formatTime(t.end_time) }}</div>
                <div class="small fw-semibold mt-1">{{ t.facility_name }}</div>
              </div>
              <div class="pulse-slot-status">
                <span class="pulse-transfer-tag" :class="t.direction === 'OUTGOING' ? 'out' : 'in'">{{ t.direction === 'OUTGOING' ? 'Handed over' : 'Received' }}</span>
              </div>
              <div class="pulse-slot-who small">
                <component :is="t.direction === 'OUTGOING' ? 'strong' : 'span'">{{ t.releasing_club_name }}</component> →
                <component :is="t.direction === 'OUTGOING' ? 'span' : 'strong'">{{ t.claiming_club_name }}</component>
              </div>
              <div class="pulse-slot-ref small font-monospace">{{ formatReference(t.fbs_reference) }}</div>
              <div class="pulse-slot-actions small text-muted">Approved {{ t.decided_at ? new Date(t.decided_at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' }) : '' }}</div>
            </div>
          </section>

          <!-- Rejected -->
          <section v-else id="section-rejected" key="rejected" role="tabpanel" aria-labelledby="tab-rejected" class="pulse-folder-section">
            <header class="pulse-section-head tone-red">
              <div>
                <h2 class="h6 fw-bold mb-0">Rejected Transfers</h2>
                <p class="text-muted small mb-0">Rejected by OSL, or not approved 48 hours before the booking. The slot stays with the releasing CCA.</p>
              </div>
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
              </div>
              <div class="pulse-slot-who small">
                <component :is="t.direction === 'OUTGOING' ? 'strong' : 'span'">{{ t.releasing_club_name }}</component> →
                <component :is="t.direction === 'OUTGOING' ? 'span' : 'strong'">{{ t.claiming_club_name }}</component>
                <div v-if="t.rejection_reason" class="text-muted">Reason: {{ t.rejection_reason }}</div>
              </div>
              <div class="pulse-slot-ref small font-monospace">{{ formatReference(t.fbs_reference) }}</div>
              <div class="pulse-slot-actions small text-muted">{{ t.decided_at ? new Date(t.decided_at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' }) : '' }}</div>
            </div>
          </section>
        </Transition>
      </div>
    </div>
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
