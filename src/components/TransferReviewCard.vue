<script setup>
import { ref, computed } from 'vue'
import BookingStatusBadge from './BookingStatusBadge.vue'
import { formatDate, formatTime } from '../services/facilityCalendarService'
import { AUDIT_ACTION_LABELS } from '../services/transferService'

const props = defineProps({
  transfer: { type: Object, required: true },
  history: { type: Array, default: null },      // null = not loaded yet
  busy: { type: Boolean, default: false },
  highlighted: { type: Boolean, default: false }
})
const emit = defineEmits(['approve', 'reject', 'load-history'])

const copied = ref('')
async function copy(text, key) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = key
    setTimeout(() => { copied.value = '' }, 1500)
  } catch { /* clipboard blocked */ }
}

const showHistory = ref(false)
function toggleHistory() {
  showHistory.value = !showHistory.value
  if (showHistory.value && props.history === null) emit('load-history', props.transfer)
}

// SSU Clause 9.1(c): OSL signs off at least 48 hours before the booking.
const deadline = computed(() => {
  const hours = Number(props.transfer.hours_to_deadline)
  if (props.transfer.signoff_deadline == null || Number.isNaN(hours)) return null
  const when = stamp(props.transfer.signoff_deadline)
  if (hours <= 0) return { tone: 'is-expired', text: `Deadline passed (${when}). The slot stays with the releasing CCA.`, expired: true }
  const left = hours < 24 ? `${Math.max(1, Math.floor(hours))}h left` : `${Math.floor(hours / 24)}d ${Math.floor(hours % 24)}h left`
  return { tone: hours < 24 ? 'is-soon' : 'is-ok', text: `Sign off by ${when} (48h before the ${props.transfer.start_time?.slice(0, 5)} slot) · ${left}`, expired: false }
})

function stamp(ts) {
  // Always Singapore time, so the deadline lines up with the booking slot whatever the laptop's time zone
  return ts ? new Date(ts).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'
}
</script>

<template>
  <article class="pulse-panel p-3 p-lg-4" :class="{ 'pulse-highlight': highlighted }" :id="`transfer-${transfer.transfer_id}`">
    <div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
      <div>
        <div class="pulse-eyebrow">Transfer review</div>
        <h3 class="h5 fw-bold mb-0">{{ transfer.facility_name }}</h3>
        <div class="small text-muted">{{ transfer.location }}</div>
      </div>
      <BookingStatusBadge :status="transfer.booking_status" />
    </div>

    <dl class="pulse-detail-grid small">
      <dt>Releasing CCA</dt><dd>{{ transfer.releasing_club_name }} <span class="text-muted">· {{ transfer.released_by_name }}</span></dd>
      <dt>Claiming CCA</dt><dd>{{ transfer.claiming_club_name }} <span class="text-muted">· {{ transfer.claimed_by_name }}</span></dd>
      <dt>Booking date</dt><dd>{{ formatDate(transfer.booking_date, true) }}</dd>
      <dt>Time</dt><dd>{{ formatTime(transfer.start_time) }} – {{ formatTime(transfer.end_time) }}</dd>
      <dt>Claimed at</dt><dd>{{ stamp(transfer.claimed_at) }}</dd>
      <template v-if="deadline">
        <dt>48-hour deadline</dt>
        <dd><span class="pulse-deadline" :class="deadline.tone">{{ deadline.text }}</span></dd>
      </template>
      <dt>OSL request email</dt>
      <dd>
        <span v-if="transfer.osl_email_status === 'SENT'" class="text-success">Emailed automatically when claimed</span>
        <span v-else-if="transfer.osl_email_status === 'FAILED'" class="text-warning-emphasis">Email failed; the releasing CCA can resend it</span>
        <span v-else class="text-muted">Sending…</span>
      </dd>
    </dl>

    <div class="row g-2 mt-1">
      <div class="col-12 col-md-6">
        <div class="pulse-ref-box">
          <div class="pulse-eyebrow">Official FBS reference</div>
          <div class="d-flex justify-content-between align-items-center gap-2">
            <span class="font-monospace fw-semibold">{{ transfer.fbs_reference }}</span>
            <button type="button" class="btn btn-sm btn-outline-secondary" @click="copy(transfer.fbs_reference, 'fbs')">{{ copied === 'fbs' ? 'Copied' : 'Copy' }}</button>
          </div>
          <div v-if="transfer.is_demo_reference" class="small text-muted mt-1">Demo reference: check against the real FBS slip.</div>
        </div>
      </div>
      <div class="col-12 col-md-6">
        <div class="pulse-ref-box">
          <div class="pulse-eyebrow">Pulse audit voucher (OSL only)</div>
          <div class="d-flex justify-content-between align-items-center gap-2">
            <span class="font-monospace fw-semibold">{{ transfer.audit_voucher_id }}</span>
            <button type="button" class="btn btn-sm btn-outline-secondary" @click="copy(transfer.audit_voucher_id, 'voucher')">{{ copied === 'voucher' ? 'Copied' : 'Copy' }}</button>
          </div>
        </div>
      </div>
    </div>

    <div class="d-flex flex-wrap gap-2 mt-3">
      <button type="button" class="btn btn-success" :disabled="busy || deadline?.expired" :title="deadline?.expired ? 'The 48-hour sign-off deadline has passed' : ''" @click="emit('approve', transfer)">Approve</button>
      <button type="button" class="btn btn-outline-danger" :disabled="busy" @click="emit('reject', transfer)">Reject</button>
      <button type="button" class="btn btn-link ms-auto" @click="toggleHistory">{{ showHistory ? 'Hide' : 'Show' }} audit history</button>
    </div>

    <div v-if="showHistory" class="mt-3 border-top pt-3">
      <div v-if="history === null" class="small text-muted">Loading history…</div>
      <ol v-else class="pulse-timeline small mb-0">
        <li v-for="event in history" :key="event.audit_event_id">
          <strong>{{ AUDIT_ACTION_LABELS[event.action] || event.action }}</strong>
          <span class="text-muted"> · {{ event.actor_name || 'System' }}<template v-if="event.actor_club_name"> ({{ event.actor_club_name }})</template> · {{ stamp(event.created_at) }}</span>
          <div v-if="event.details?.reason" class="text-muted">Reason: {{ event.details.reason }}</div>
          <div v-if="event.audit_voucher_id" class="text-muted font-monospace">{{ event.audit_voucher_id }}</div>
        </li>
      </ol>
    </div>
  </article>
</template>
