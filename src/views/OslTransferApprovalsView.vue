<script setup>

// OSL staff only: approve or reject claimed facility transfers.
// The database checks again that the person is an OSL admin.

import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import TransferReviewCard from '../components/TransferReviewCard.vue'
import PageHero from '../components/PageHero.vue'
import FacilityTabs from '../components/FacilityTabs.vue'
import ConfirmActionModal from '../components/ConfirmActionModal.vue'
import { session, showToast } from '../services/sessionState'
import { listenForCalendarChanges, formatDate, formatTime } from '../services/facilityCalendarService'
import { fetchPendingTransfers, fetchRecentDecisions, fetchAuditHistory, approveTransfer, rejectTransfer } from '../services/transferService'

const route = useRoute()
const router = useRouter()

const pendingTransfers = ref([])
const decisions = ref([])
const histories = ref({})      // transfer_id -> audit history rows
const search = ref('')
const loading = ref(true)
const busyId = ref(null)
const decision = ref(null)     // { kind: 'approve' or 'reject', transfer }
const sortBy = ref('date-asc')
const focusId = ref(null)      // transfer opened from the OSL email link

const SORTS = [
  { value: 'date-asc', label: 'Booking slot (earliest)' },
  { value: 'recent', label: 'Approval request (latest)' },
  { value: 'name-asc', label: 'Facility (A–Z)' },
  { value: 'cca-asc', label: 'CCA (A–Z)' }
]

// ---------------- Loading ----------------

async function load() {
  if (!session.value.isOslAdmin) {
    loading.value = false
    return
  }
  try {
    pendingTransfers.value = await fetchPendingTransfers()
    decisions.value = await fetchRecentDecisions()
  } catch (error) {
    console.log(error.message)
    showToast(error.message, 'danger')
  }
  loading.value = false
}

let stopListening = null

onMounted(async () => {
  await load()
  stopListening = listenForCalendarChanges(load)
})

onUnmounted(() => {
  if (stopListening) {
    stopListening()
  }
})

// Email links and bell notifications both arrive as ?transfer=ID,
// even while this page is already open
watch(() => route.query.transfer, async (id) => {
  if (!id) {
    return
  }
  if (!loading.value) {
    await load()
  }
  focusId.value = String(id)
}, { immediate: true })

// ---------------- Sorting and searching ----------------

function compareText(a, b) {
  return (a || '').localeCompare(b || '', undefined, { sensitivity: 'base' })
}

function compareSlot(a, b) {
  const first = a.booking_date + ' ' + a.start_time
  const second = b.booking_date + ' ' + b.start_time
  return first.localeCompare(second)
}

// Pending rows have claimed_at; decisions have decided_at
function requestTime(row) {
  return String(row.claimed_at || row.decided_at || '')
}

function sortRows(rows) {
  const copy = rows.slice()
  copy.sort((a, b) => {
    if (sortBy.value === 'recent') {
      return requestTime(b).localeCompare(requestTime(a))
    }
    if (sortBy.value === 'name-asc') {
      return compareText(a.facility_name, b.facility_name) || compareSlot(a, b)
    }
    if (sortBy.value === 'cca-asc') {
      return compareText(a.releasing_club_name, b.releasing_club_name) || compareSlot(a, b)
    }
    return compareSlot(a, b)
  })
  return copy
}

function matchesSearch(transfer, searchText) {
  const words = [
    transfer.fbs_reference,
    transfer.audit_voucher_id,
    transfer.facility_name,
    transfer.releasing_club_name,
    transfer.claiming_club_name,
    transfer.booking_date,
    formatDate(transfer.booking_date, true)
  ]
  const text = words.filter((word) => word).join(' ').toLowerCase()
  return text.includes(searchText)
}

function searchAndSort(rows) {
  const searchText = search.value.trim().toLowerCase()
  if (searchText === '') {
    return sortRows(rows)
  }
  return sortRows(rows.filter((row) => matchesSearch(row, searchText)))
}

const filtered = computed(() => {
  return searchAndSort(pendingTransfers.value)
})

const sortedDecisions = computed(() => {
  return searchAndSort(decisions.value)
})

// ---------------- Opening one transfer from a link ----------------

const focusTransfer = computed(() => {
  if (!focusId.value) {
    return null
  }
  const found = pendingTransfers.value.find((t) => String(t.transfer_id) === focusId.value)
  return found || null
})

// Already decided? Show the decision instead
const focusDecision = computed(() => {
  if (!focusId.value || focusTransfer.value) {
    return null
  }
  const found = decisions.value.find((d) => String(d.transfer_id) === focusId.value)
  return found || null
})

function closeFocus() {
  focusId.value = null
  if (route.query.transfer) {
    const query = Object.assign({}, route.query)
    delete query.transfer
    router.replace({ query: query })
  }
}

function decideFromFocus(kind, transfer) {
  closeFocus()
  decision.value = { kind: kind, transfer: transfer }
}

async function loadHistory(transfer) {
  try {
    histories.value[transfer.transfer_id] = await fetchAuditHistory(transfer.booking_id)
  } catch (error) {
    console.log(error.message)
    showToast(error.message, 'danger')
  }
}

// ---------------- Approve / reject ----------------

// Text for the confirm pop-up
const modal = computed(() => {
  if (!decision.value) {
    return null
  }
  const t = decision.value.transfer
  const details = [
    { label: 'FBS reference', value: t.fbs_reference },
    { label: 'Facility', value: t.facility_name },
    { label: 'When', value: formatDate(t.booking_date, true) + ', ' + formatTime(t.start_time) + ' – ' + formatTime(t.end_time) },
    { label: 'Transfer', value: t.releasing_club_name + ' → ' + t.claiming_club_name }
  ]

  if (decision.value.kind === 'approve') {
    return {
      title: 'Approve this transfer?',
      message: 'Confirm you have checked the FBS reference, original slot, owner, claiming CCA and booking slip. The booking becomes an Officially Confirmed Booking and the confirmation email is queued.',
      confirmLabel: 'Approve transfer',
      details: details
    }
  }
  return {
    title: 'Reject this transfer?',
    message: 'The claim is kept in the audit history and the slot returns to Proposed Peer Transfer.',
    confirmLabel: 'Reject transfer',
    danger: true,
    reasonLabel: 'Reason (shared with both CCAs)',
    details: details
  }
})

async function confirmDecision(reason) {
  const kind = decision.value.kind
  const transfer = decision.value.transfer
  busyId.value = transfer.transfer_id

  try {
    if (kind === 'approve') {
      await approveTransfer(transfer.transfer_id)
      showToast('Approved. ' + transfer.facility_name + ' now belongs to ' + transfer.claiming_club_name + '; confirmation email queued.', 'success')
    } else {
      await rejectTransfer(transfer.transfer_id, reason)
      showToast('Rejected. ' + transfer.facility_name + ' is back on offer.', 'info')
    }
  } catch (error) {
    console.log(error.message)
    showToast(error.message, 'danger')
  }

  busyId.value = null
  decision.value = null
  load()
}
</script>

<template>
  <FacilityTabs />

  <PageHero
    variant="admin"
    tag="Office of Student Life"
    title="Transfer approvals"
    subtitle="Verify each claim against FBS before it becomes an Officially Confirmed Booking."
    :stats="session.isOslAdmin ? [
      { label: 'Awaiting sign-off', value: pendingTransfers.length, tone: 'sky' },
      { label: 'Approved', value: decisions.filter(d => d.state === 'APPROVED').length, tone: 'green' },
      { label: 'Rejected', value: decisions.filter(d => d.state === 'REJECTED' || d.state === 'EXPIRED').length, tone: 'red' }
    ] : []"
  />


  <div v-if="!session.isOslAdmin" class="pulse-panel p-5 text-center">
    <h2 class="h6 fw-bold">OSL administrators only</h2>
    <p class="text-muted small mb-0">This page shows internal audit vouchers. The database refuses these requests for anyone else.</p>
  </div>

  <template v-else>
    <section class="pulse-panel p-3 mb-4 d-flex flex-wrap gap-2 align-items-center">
      <input
        v-model="search"
        type="search"
        class="form-control pulse-search flex-grow-1 w-auto"
        style="min-width: 220px"
        placeholder="Search FBS reference, facility, CCA, date or audit voucher…"
        aria-label="Search transfers"
      />
      <label class="d-flex align-items-center gap-2 small text-muted mb-0">
        Sort by
        <select v-model="sortBy" class="form-select form-select-sm w-auto" aria-label="Sort transfers">
          <option v-for="option in SORTS" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
      </label>
    </section>

    <div v-if="loading" class="text-center py-5"><div class="spinner-border text-danger" role="status"></div></div>

    <template v-else>
      <h2 class="h6 fw-bold mb-2">Pending Admin Sign-off ({{ filtered.length }})</h2>
      <p v-if="!filtered.length" class="pulse-panel p-4 text-muted small">
        {{ pendingTransfers.length ? 'No pending transfers match your search.' : 'Nothing is waiting for approval.' }}
      </p>
      <div class="d-flex flex-column gap-3 mb-5">
        <TransferReviewCard
          v-for="t in filtered"
          :key="t.transfer_id"
          :transfer="t"
          :history="histories[t.transfer_id] ?? null"
          :busy="busyId === t.transfer_id"
          :highlighted="String(t.transfer_id) === String(route.query.transfer)"
          @approve="decision = { kind: 'approve', transfer: $event }"
          @reject="decision = { kind: 'reject', transfer: $event }"
          @load-history="loadHistory"
        />
      </div>

      <section class="pulse-panel overflow-hidden">
        <header class="p-3 border-bottom"><h2 class="h6 fw-bold mb-0">Recent decisions</h2></header>
        <p v-if="!sortedDecisions.length" class="p-3 text-muted small mb-0">{{ decisions.length ? 'No decisions match your search.' : 'No decisions yet.' }}</p>
        <div v-else class="table-responsive">
          <table class="table table-sm align-middle mb-0 small">
            <thead><tr><th class="ps-3">Decision</th><th>Booking</th><th>Transfer</th><th>FBS reference</th><th>Audit voucher</th><th>Confirmation email</th></tr></thead>
            <tbody>
              <tr v-for="d in sortedDecisions" :key="d.transfer_id">
                <td class="ps-3">
                  <span class="pulse-badge" :class="d.state === 'APPROVED' ? 'pulse-badge-confirmed' : 'pulse-badge-rejected'">{{ d.state === 'APPROVED' ? 'Approved' : 'Rejected' }}</span>
                  <div v-if="d.rejection_reason" class="text-muted">{{ d.rejection_reason }}</div>
                </td>
                <td>{{ d.facility_name }}<div class="text-muted">{{ formatDate(d.booking_date) }}, {{ formatTime(d.start_time) }}</div></td>
                <td>{{ d.releasing_club_name }} → {{ d.claiming_club_name }}</td>
                <td class="font-monospace">{{ d.fbs_reference }}</td>
                <td class="font-monospace">{{ d.audit_voucher_id }}</td>
                <td>{{ d.confirmation_email_status || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </template>

  <!-- Opened from the link in the OSL request email -->
  <div v-if="focusId && session.isOslAdmin && !loading" class="pulse-modal-backdrop" @click.self="closeFocus">
    <div class="pulse-modal pulse-modal-review" role="dialog" aria-modal="true" aria-label="Transfer request">
      <div class="d-flex justify-content-between align-items-center mb-2">
        <h2 class="h6 fw-bold mb-0">Transfer request</h2>
        <button type="button" class="btn-close" aria-label="Close" @click="closeFocus"></button>
      </div>
      <TransferReviewCard
        v-if="focusTransfer"
        :transfer="focusTransfer"
        :history="histories[focusTransfer.transfer_id] ?? null"
        :busy="busyId === focusTransfer.transfer_id"
        @approve="decideFromFocus('approve', $event)"
        @reject="decideFromFocus('reject', $event)"
        @load-history="loadHistory"
      />
      <div v-else class="pulse-panel p-4 text-center">
        <template v-if="focusDecision">
          <span class="pulse-badge" :class="focusDecision.state === 'APPROVED' ? 'pulse-badge-confirmed' : 'pulse-badge-rejected'">
            {{ focusDecision.state === 'APPROVED' ? 'Already approved' : 'Already rejected' }}
          </span>
          <p class="small mt-2 mb-0">
            {{ focusDecision.facility_name }}, {{ formatDate(focusDecision.booking_date) }} ·
            {{ focusDecision.releasing_club_name }} → {{ focusDecision.claiming_club_name }}
          </p>
        </template>
        <p v-else class="small text-muted mb-0">This request is no longer waiting for approval.</p>
      </div>
    </div>
  </div>

  <ConfirmActionModal
    :show="!!modal"
    :title="modal?.title"
    :message="modal?.message"
    :details="modal?.details || []"
    :confirm-label="modal?.confirmLabel"
    :danger="modal?.danger"
    :reason-label="modal?.reasonLabel || ''"
    :busy="busyId !== null"
    @confirm="confirmDecision"
    @cancel="decision = null"
  />
</template>
