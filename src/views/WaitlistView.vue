<script setup>

// The waitlists our CCA is in: live offers to accept, queues we are
// waiting in, and what happened to older entries.

import { ref, computed, onMounted, onUnmounted } from 'vue'
import FacilityTabs from '../components/FacilityTabs.vue'
import PageHero from '../components/PageHero.vue'
import WaitlistOfferCard from '../components/WaitlistOfferCard.vue'
import ConfirmActionModal from '../components/ConfirmActionModal.vue'
import { loadOffers } from '../services/notificationStore'
import { session, activeClubName, canManageActiveClub, showToast } from '../services/sessionState'
import { claimBooking, listenForCalendarChanges, formatDate, formatTime } from '../services/facilityService'
import { fetchClubWaitlist, fetchQueue, leaveWaitlist } from '../services/waitlistService'

const entries = ref([])
const queues = ref({})       // booking_id -> queue rows, loaded when "Show queue" is clicked
const loading = ref(true)
const busyId = ref(null)
const accepting = ref(null)  // the offer waiting in the confirm pop-up

// queue_position 1 = next in line, so (position - 1) CCAs are in front
function inFrontLabel(count) {
  const n = Math.max(0, count)
  return n + ' CCA' + (n === 1 ? '' : 's') + ' in front of you'
}

const HISTORY_LABELS = {
  EXPIRED: 'Offer expired',
  DECLINED: 'Declined',
  LEFT: 'Left queue',
  CLAIMED: 'Claimed'
}

function actionTime(entry) {
  const at = entry.left_at || entry.claimed_at
  return at ? new Date(at).toLocaleString('en-SG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''
}


async function load() {
  if (!session.value.activeClubId) {
    loading.value = false
    return
  }
  try {
    entries.value = await fetchClubWaitlist(session.value.activeClubId)
  } catch (error) {
    console.log(error.message)
    showToast(error.message, 'danger')
  }
  loading.value = false
}

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

const offers = computed(() => {
  return entries.value.filter((entry) => entry.status === 'OFFERED')
})

const waiting = computed(() => {
  return entries.value.filter((entry) => entry.status === 'WAITING')
})

const history = computed(() => {
  return entries.value.filter((entry) => entry.status !== 'WAITING' && entry.status !== 'OFFERED')
})

// Show or hide the full queue for one booking
async function toggleQueue(entry) {
  const id = entry.booking_id
  if (queues.value[id]) {
    delete queues.value[id]
    return
  }
  try {
    queues.value[id] = await fetchQueue(id)
  } catch (error) {
    console.log(error.message)
    showToast(error.message, 'danger')
  }
}

async function confirmAccept() {
  const entry = accepting.value
  busyId.value = entry.entry_id
  try {
    await claimBooking(entry.booking_id, session.value.activeClubId)
    showToast('Offer accepted. ' + entry.facility_name + ' is awaiting OSL approval.', 'success')
  } catch (error) {
    console.log(error.message)
    showToast(error.message, 'danger')
  }
  busyId.value = null
  accepting.value = null
  load()
  loadOffers()
}

async function leave(entry) {
  // Declining an offer passes it on, so check first
  if (entry.status === 'OFFERED') {
    const sure = confirm('Decline your offer? It passes to the next CCA in the queue.')
    if (!sure) {
      return
    }
  }

  busyId.value = entry.entry_id
  try {
    await leaveWaitlist(entry.booking_id, session.value.activeClubId)
    if (entry.status === 'OFFERED') {
      showToast('Offer declined.', 'info')
    } else {
      showToast('Left the waitlist.', 'info')
    }
  } catch (error) {
    console.log(error.message)
    showToast(error.message, 'danger')
  }
  busyId.value = null
  load()
  loadOffers()
}

// When an offer runs out, the database passes it on.
// Give it 5 seconds, then reload.
function onExpired() {
  setTimeout(() => {
    load()
    loadOffers()
  }, 5000)
}
</script>

<template>
  <FacilityTabs :waitlist-count="offers.length + waiting.length" :offer-count="offers.length" />

  <PageHero
    tag="Waitlist"
    :title="activeClubName ? `${activeClubName} Waitlist` : 'Waitlist'"
    subtitle="First come, first served. When a slot is released, the first CCA in the queue gets 30 minutes to accept."
    :stats="[
      { label: 'Live offers', value: offers.length, tone: 'green' },
      { label: 'Queues joined', value: waiting.length, tone: 'sky' }
    ]"
  />


  <div v-if="!session.isDev && session.activeClubId && !canManageActiveClub" class="pulse-banner pulse-banner-view">
    <strong>View only.</strong> You can follow {{ activeClubName }}'s queue positions; only its Logistics Director can join, leave or accept.
  </div>

  <div v-if="!session.activeClubId" class="pulse-panel p-5 text-center">
    <h2 class="h6 fw-bold">Waitlists belong to CCAs</h2>
    <p class="text-muted small mb-0">Anyone can browse the calendar. Pick a persona that belongs to a CCA to see its queue.</p>
  </div>

  <div v-else-if="loading" class="text-center py-5"><div class="spinner-border text-danger" role="status"></div></div>

  <template v-else>
    <section v-if="offers.length" class="d-flex flex-column gap-3 mb-4">
      <WaitlistOfferCard
        v-for="entry in offers"
        :key="entry.entry_id"
        :entry="entry"
        :busy="busyId === entry.entry_id || !canManageActiveClub"
        @accept="accepting = $event"
        @decline="leave"
        @expired="onExpired"
      />
    </section>

    <section class="pulse-panel overflow-hidden mb-4">
      <header class="p-3 border-bottom">
        <h2 class="h6 fw-bold mb-0">In the queue</h2>
        <p class="text-muted small mb-0">Join a queue from All Facilities by choosing Join waitlist.</p>
      </header>
      <div v-if="!waiting.length" class="p-4 text-center">
        <p class="text-muted small">{{ activeClubName }} is not queuing for any slot.</p>
        <RouterLink to="/facilities" class="btn btn-sm btn-pulse-primary">Browse facilities</RouterLink>
      </div>
      <template v-for="entry in waiting" :key="entry.entry_id">
        <div class="pulse-slot">
          <div class="pulse-slot-when">
            <div class="fw-semibold">{{ formatDate(entry.booking_date) }}</div>
            <div class="small text-muted">{{ formatTime(entry.start_time) }} – {{ formatTime(entry.end_time) }}</div>
          </div>
          <div class="pulse-slot-status">
            <span class="pulse-badge pulse-badge-booked">#{{ entry.queue_position }} in queue</span>
            <div class="small text-pulse fw-semibold mt-1">{{ inFrontLabel(entry.queue_position - 1) }}</div>
          </div>
          <div class="pulse-slot-who small">
            <strong>{{ entry.facility_name }}</strong>
            <div class="text-muted">Holder: {{ entry.owner_club_name }}</div>
          </div>
          <div class="pulse-slot-ref small"><button type="button" class="btn btn-link btn-sm p-0" @click="toggleQueue(entry)">{{ queues[entry.booking_id] ? 'Hide' : 'View' }} queue</button></div>
          <div class="pulse-slot-actions">
            <button v-if="canManageActiveClub" type="button" class="btn btn-sm btn-outline-secondary" :disabled="busyId === entry.entry_id" @click="leave(entry)">Leave</button>
          </div>
        </div>
        <ol v-if="queues[entry.booking_id]" class="pulse-queue small">
          <li v-for="q in queues[entry.booking_id]" :key="q.entry_id" :class="{ 'fw-semibold': q.club_id === session.activeClubId }">
            {{ q.club_name }} <span class="text-muted">· {{ q.status === 'OFFERED' ? 'holding offer' : 'waiting' }}</span>
          </li>
        </ol>
      </template>
    </section>

    <section v-if="history.length" class="pulse-panel overflow-hidden">
      <header class="p-3 border-bottom">
        <h2 class="h6 fw-bold mb-0">Past waitlist activity</h2>
        <p class="text-muted small mb-0">Dates are the booking dates. Times beside each status show when it happened.</p>
      </header>
      <div v-for="entry in history" :key="entry.entry_id" class="pulse-slot no-ref text-muted">
        <div class="pulse-slot-when">
          <div class="fw-semibold">{{ formatDate(entry.booking_date) }}</div>
          <div class="small">{{ formatTime(entry.start_time) }} – {{ formatTime(entry.end_time) }}</div>
        </div>
        <div class="pulse-slot-status small">
          {{ HISTORY_LABELS[entry.status] }}
          <div v-if="actionTime(entry)" class="text-muted">{{ actionTime(entry) }}</div>
        </div>
        <div class="pulse-slot-who small">{{ entry.facility_name }} · {{ entry.owner_club_name }}</div>
        <div class="pulse-slot-actions"></div>
      </div>
    </section>
  </template>

  <ConfirmActionModal
    :show="!!accepting"
    title="Accept this waitlist offer?"
    message="OSL has to approve this claim before it is official."
    warning="Once OSL approves, this slot is yours and you can’t release it again."
    :details="accepting ? [
      { label: 'Facility', value: accepting.facility_name },
      { label: 'When', value: `${formatDate(accepting.booking_date, true)}, ${formatTime(accepting.start_time)} – ${formatTime(accepting.end_time)}` }
    ] : []"
    confirm-label="Accept and claim"
    :busy="busyId !== null"
    @confirm="confirmAccept"
    @cancel="accepting = null"
  />
</template>
