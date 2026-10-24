<script setup>
import { ref, computed } from 'vue';

const props = defineProps({
  apiMode: { type: Boolean, default: false },
  readOnly: { type: Boolean, default: false }
});

const emit = defineEmits(['back']);

const selectedSubcommittee = ref('All ExCo')
const showClassBaseline = ref(true)
const toastMsg = ref('')

// Guests can look around but not make changes
function blockedForGuest() {
  if (!props.readOnly) return false
  toastMsg.value = 'Guest view is read-only. Sign in as a CCA ExCo to make changes.'
  return true
}

const days = ['Mon 12 Oct', 'Tue 13 Oct', 'Wed 14 Oct', 'Thu 15 Oct', 'Fri 16 Oct', 'Sat 17 Oct', 'Sun 18 Oct']
const hours = [
  '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', 
  '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'
]

// Heatmap data: availability count out of 12 members
// 0, 4, 8, 12
const heatmapMatrix = ref([
  // Mon
  [0, 8, 0, 4, 8, 0, 4, 0, 0, 0, 0, 8, 4, 0],
  // Tue
  [0, 0, 4, 8, 4, 0, 0, 8, 0, 4, 8, 8, 4, 0],
  // Wed
  [0, 0, 8, 0, 0, 0, 0, 0, 4, 8, 4, 0, 0, 8],
  // Thu
  [4, 8, 0, 4, 0, 8, 4, 0, 8, 12, 12, 4, 8, 0],
  // Fri (Best match Friday 16:00-19:00)
  [8, 4, 0, 0, 8, 0, 0, 4, 12, 12, 12, 8, 4, 0],
  // Sat
  [0, 0, 4, 8, 0, 4, 0, 8, 4, 0, 0, 4, 0, 4],
  // Sun
  [4, 0, 8, 4, 0, 0, 8, 0, 4, 8, 8, 4, 0, 8]
])

const unconfirmedMembers = ref([
  { name: 'Darren Koh', role: 'Performance Lead', handle: '@darrenk' },
  { name: 'Marcus Tan', role: 'Stage Manager', handle: '@marcustan' },
  { name: 'Sarah Lim', role: 'Audio Tech', handle: '@sarahlim' }
])

// When2Meet personal user availability toggle map: key is `${dIdx}_${hIdx}`
const myAvailability = ref({
  '4_8': true, '4_9': true, '4_10': true, // Fri 16:00, 17:00, 18:00
  '3_9': true, '3_10': true, // Thu 17:00, 18:00
})

function isMySlotAvailable(dIdx, hIdx) {
  return !!myAvailability.value[`${dIdx}_${hIdx}`]
}

function handleCellClick(d, h, dIdx, hIdx) {
  if (blockedForGuest()) return
  const key = `${dIdx}_${hIdx}`
  const wasAvailable = !!myAvailability.value[key]
  myAvailability.value[key] = !wasAvailable

  if (!wasAvailable) {
    heatmapMatrix.value[dIdx][hIdx] = Math.min(12, heatmapMatrix.value[dIdx][hIdx] + 1)
    toastMsg.value = `When2Meet: Marked Rachel Tan as Available on ${d} @ ${h} (+1 member). Total: ${heatmapMatrix.value[dIdx][hIdx]}/12 members.`
  } else {
    heatmapMatrix.value[dIdx][hIdx] = Math.max(0, heatmapMatrix.value[dIdx][hIdx] - 1)
    toastMsg.value = `When2Meet: Marked Rachel Tan as Unavailable on ${d} @ ${h} (-1 member). Total: ${heatmapMatrix.value[dIdx][hIdx]}/12 members.`
  }

  // Pre-fill meeting form with this slot if clicked
  meetingForm.value.date = d
  meetingForm.value.time = `${h} – ${shiftHour(h, 2)}`
  setTimeout(() => { toastMsg.value = '' }, 4000)
}

function shiftHour(hourStr, deltaHours) {
  const [h] = hourStr.split(':').map(Number)
  const nextH = Math.min(23, h + deltaHours)
  return `${String(nextH).padStart(2, '0')}:00`
}

function isClassSlot(dIdx, hIdx) {
  if (!showClassBaseline.value) return false
  if (dIdx === 0 && (hIdx === 7 || hIdx === 8 || hIdx === 9)) return true
  if (dIdx === 2 && (hIdx === 7 || hIdx === 8 || hIdx === 9 || hIdx === 10)) return true
  return false
}

function getClassName(dIdx, hIdx) {
  if (dIdx === 0) return 'CS101'
  if (dIdx === 2) return 'IS216'
  return ''
}

function pingMemberOnTelegram(member) {
  if (blockedForGuest()) return
  toastMsg.value = `Telegram reminder dispatched to ${member.name} (${member.handle}): "Please confirm your availability for SMU Arts Festival rehearsals."`
  setTimeout(() => {
    toastMsg.value = ''
  }, 4000)
}

function pingAllOnTelegram() {
  if (blockedForGuest()) return
  toastMsg.value = 'Automated Telegram broadcast dispatched to all 3 unconfirmed ExCo members!'
  setTimeout(() => {
    toastMsg.value = ''
  }, 4000)
}

// Meeting Form & Modal State (Requested by Chloe & Sarah)
const showMeetingModal = ref(false)
const meetingConfirmed = ref(false)
const meetingForm = ref({
  date: 'Friday, 16 October 2026',
  time: '16:00 – 19:00',
  title: 'SMU Eurhythmix — Arts Festival Run-of-Show Alignment',
  venue: 'SMU Connexion Meeting Room 3',
  agenda: '1. Stage positioning & lighting cues alignment (Act 1 & 2)\n2. OneMap transit buffer and performer holding area protocol\n3. Address late performer check-in protocols and props handover',
  attendees: 12
})

// Recipient Multi-Select & Search (Requested by Chloe: customize who receives meeting broadcast)
const allMembers = [
  { id: 1, name: 'Rachel Tan', handle: '@racheltan', role: 'President', subcommittee: 'Executive' },
  { id: 2, name: 'Angel Low', handle: '@angellow', role: 'Vice President & Lead Dancer', subcommittee: 'Dancers' },
  { id: 3, name: 'Rachel Chua', handle: '@rachelc', role: 'Choreography Lead', subcommittee: 'Dancers' },
  { id: 4, name: 'Darren Koh', handle: '@darrenk', role: 'Logistics & Props Head', subcommittee: 'Logistics' },
  { id: 5, name: 'Marcus Lim', handle: '@marcuslim', role: 'Sound & Tech Specialist', subcommittee: 'Technical' },
  { id: 6, name: 'Sarah Lim', handle: '@sarahlim', role: 'Rehearsal Coordinator', subcommittee: 'Dancers' },
  { id: 7, name: 'Kevin Wong', handle: '@kevinw', role: 'Marketing & Ticketing Head', subcommittee: 'Marketing' },
  { id: 8, name: 'Chloe Goh', handle: '@chloeg', role: 'Wardrobe & Costume Lead', subcommittee: 'Logistics' },
  { id: 9, name: 'Benjamin Teo', handle: '@benteo', role: 'Stage Operations Lead', subcommittee: 'Technical' },
  { id: 10, name: 'Nadia Syafira', handle: '@nadias', role: 'Welfare Director', subcommittee: 'Executive' },
  { id: 11, name: 'Isaac Tan', handle: '@isaact', role: 'Finance Director', subcommittee: 'Executive' },
  { id: 12, name: 'Valerie Chee', handle: '@valeriec', role: 'Front-of-House Manager', subcommittee: 'Marketing' },
]

const selectedRecipientIds = ref([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
const recipientSearch = ref('')

const filteredRecipients = computed(() => {
  const query = recipientSearch.value.trim().toLowerCase()
  if (!query) return allMembers
  return allMembers.filter(m => 
    m.name.toLowerCase().includes(query) || 
    m.handle.toLowerCase().includes(query) || 
    m.role.toLowerCase().includes(query) ||
    m.subcommittee.toLowerCase().includes(query)
  )
})

function selectAllRecipients() {
  selectedRecipientIds.value = allMembers.map(m => m.id)
}
function selectDancersOnly() {
  selectedRecipientIds.value = allMembers.filter(m => m.subcommittee === 'Dancers').map(m => m.id)
}
function selectLogisticsOnly() {
  selectedRecipientIds.value = allMembers.filter(m => m.subcommittee === 'Logistics' || m.subcommittee === 'Technical').map(m => m.id)
}
function selectExecutiveOnly() {
  selectedRecipientIds.value = allMembers.filter(m => m.subcommittee === 'Executive').map(m => m.id)
}
function toggleRecipient(id) {
  if (selectedRecipientIds.value.includes(id)) {
    if (selectedRecipientIds.value.length === 1) return // keep at least 1
    selectedRecipientIds.value = selectedRecipientIds.value.filter(i => i !== id)
  } else {
    selectedRecipientIds.value.push(id)
  }
}

function openMeetingModal(slotInfo = null) {
  if (blockedForGuest()) return
  if (slotInfo) {
    if (slotInfo.date) meetingForm.value.date = slotInfo.date
    if (slotInfo.time) meetingForm.value.time = slotInfo.time
  }
  showMeetingModal.value = true
}

function confirmAndBroadcastMeeting() {
  meetingConfirmed.value = true
  showMeetingModal.value = false
  
  // Trigger iCalendar file download with custom agenda
  exportToCalendar(meetingForm.value)

  const count = selectedRecipientIds.value.length
  const sampleHandles = allMembers
    .filter(m => selectedRecipientIds.value.includes(m.id))
    .slice(0, 3)
    .map(m => m.handle)
    .join(', ')
  const handlesText = count > 3 ? `${sampleHandles} +${count - 3} more` : sampleHandles

  toastMsg.value = `Meeting scheduled! Telegram broadcast dispatched to ${count} members (${handlesText}) with agenda and calendar invite.`
  setTimeout(() => { toastMsg.value = '' }, 6000)

  // Emit event to App.vue to push into centralized notifications bell!
  emit('meeting-scheduled', {
    title: meetingForm.value.title,
    day: meetingForm.value.date,
    time: meetingForm.value.time,
    venue: meetingForm.value.venue,
    agenda: meetingForm.value.agenda,
    recipientsCount: count
  })
}

// Client-side iCalendar RFC 5545 export
function exportToCalendar(customDetails = null) {
  const title = customDetails?.title || 'SMU Eurhythmix ExCo Weekly Logistics Sync'
  const location = customDetails?.venue || 'SMU Connexion Meeting Room 3'
  const description = customDetails?.agenda || 'Weekly logistics review for SMU Arts Festival Opening Night run-of-show. Exported via Pulse Availability Finder.'
  
  const icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SMU Pulse//Meeting Scheduler//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:pulse-meeting-friday-20261016@smu.edu.sg',
    'DTSTAMP:20261016T080000Z',
    'DTSTART:20261016T080000Z', // 16:00 SGT
    'DTEND:20261016T110000Z',   // 19:00 SGT
    `SUMMARY:${title}`,
    `DESCRIPTION:${description.replace(/\n/g, '\\n')}`,
    `LOCATION:${location}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n')

  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' })
  const link = document.createElement('a')
  link.href = window.URL.createObjectURL(blob)
  link.setAttribute('download', 'smu-eurhythmix-meeting.ics')
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)

  if (!customDetails) {
    toastMsg.value = 'Downloaded smu-eurhythmix-meeting.ics! Open file to add to Google, Outlook, or Apple Calendar.'
    setTimeout(() => {
      toastMsg.value = ''
    }, 4500)
  }
}
</script>

<template>
  <div class="py-2">
    
    <!-- Top Bar with Navigation & Actions -->
    <div class="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-4">
      <div>
        <div class="d-flex align-items-center gap-2 mb-1">
          <span class="badge bg-danger rounded-pill px-2 py-1" style="font-size: 0.65rem; font-weight: 800;">FEATURE 2</span>
          <span v-if="apiMode" class="pulse-api-tag">Supabase DB Availability Query</span>
          <span v-if="apiMode" class="pulse-api-tag">iCalendar RFC 5545 API</span>
        </div>
        <h3 class="fw-bold mb-1">Weekly ExCo Availability Finder</h3>
        <p class="text-muted small mb-0">
          Aggregates schedules across 12 ExCos with timetable pre-loading, eliminating fragmented Telegram polls.
        </p>
      </div>

      <div class="d-flex flex-wrap gap-2">
        <!-- Toggle Recurring Class Blocks -->
        <button 
          type="button" 
          class="btn btn-sm btn-pulse-outline d-flex align-items-center gap-2"
          @click="showClassBaseline = !showClassBaseline"
        >
          <span>{{ showClassBaseline ? '✓' : '○' }}</span>
          <span>Show Class Baselines (IS216, CS101)</span>
        </button>

        <!-- 1-Click iCal Export -->
        <button 
          type="button" 
          class="btn btn-sm btn-pulse-primary d-flex align-items-center gap-2"
          @click="exportToCalendar"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
          </svg>
          <span>Sync to Calendar (.ics)</span>
        </button>
      </div>
    </div>

    <!-- Alert Banner -->
    <div v-if="toastMsg" class="alert alert-success border-0 shadow-sm mb-4 d-flex align-items-center gap-2" role="alert">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
        <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
      </svg>
      <span>{{ toastMsg }}</span>
    </div>

    <!-- Controls Row: Subcommittee Filter & Availability Gradient Legend -->
    <div class="card border-0 shadow-sm p-3 mb-4" style="border-radius: 1rem;">
      <div class="row g-3 align-items-center justify-content-between">
        
        <!-- Filter Pills -->
        <div class="col-12 col-md-auto d-flex flex-wrap align-items-center gap-2">
          <span class="small fw-bold text-muted">Filter by Subcommittee:</span>
          <button 
            v-for="sub in ['All ExCo', 'Logistics', 'Marketing', 'Performance Leads']"
            :key="sub"
            type="button"
            class="pulse-filter-pill"
            :class="{ active: selectedSubcommittee === sub }"
            @click="selectedSubcommittee = sub"
          >
            {{ sub }}
          </button>
        </div>

        <!-- Heatmap Legend -->
        <div class="col-12 col-md-auto d-flex align-items-center gap-3 small fw-bold">
          <span class="d-flex align-items-center gap-1">
            <span style="width: 12px; height: 12px; background: #fff; border: 1px solid #cbd5e1; border-radius: 2px;"></span>
            0 Free
          </span>
          <span class="d-flex align-items-center gap-1">
            <span style="width: 12px; height: 12px; background: #dcfce7; border-radius: 2px;"></span>
            4/12 Free
          </span>
          <span class="d-flex align-items-center gap-1">
            <span style="width: 12px; height: 12px; background: #86efac; border-radius: 2px;"></span>
            8/12 Free
          </span>
          <span class="d-flex align-items-center gap-1">
            <span style="width: 12px; height: 12px; background: #15803d; border-radius: 2px;"></span>
            All 12 Free (Optimal)
          </span>
        </div>

      </div>
    </div>

    <!-- Main Content: Grid + Recommendation Sidebar -->
    <div class="row g-4">
      
      <!-- Left: Heatmap 2D Grid -->
      <div class="col-lg-8">
        <div class="pulse-card p-3 shadow-sm">
          
          <!-- When2Meet Interactive Helper Header -->
          <div class="d-flex flex-wrap justify-content-between align-items-center mb-2 px-1">
            <div class="d-flex align-items-center gap-2">
              <span class="badge bg-primary bg-opacity-10 text-primary border border-primary-subtle fw-bold" style="font-size: 0.675rem;">
                When2Meet Mode Active
              </span>
              <span class="text-muted small" style="font-size: 0.725rem;">
                Click any slot to add/remove your personal availability. Total available ExCos update live.
              </span>
            </div>
            <button 
              type="button" 
              class="btn btn-sm btn-link text-decoration-none text-muted py-0"
              style="font-size: 0.7rem;"
              @click="openMeetingModal()"
            >
              + Quick Schedule
            </button>
          </div>

          <div class="table-responsive">
            <table class="table table-borderless align-middle mb-0 text-center" style="min-width: 650px;">
              <thead>
                <tr class="border-bottom">
                  <th style="width: 70px; font-size: 0.75rem;" class="text-muted text-uppercase">Time</th>
                  <th v-for="d in days" :key="d" style="font-size: 0.775rem;" class="fw-bold">
                    {{ d }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(h, hIdx) in hours" :key="h">
                  <td class="text-muted small fw-semibold py-1" style="font-size: 0.7rem;">{{ h }}</td>
                  
                  <td v-for="(d, dIdx) in days" :key="d" class="p-1" style="height: 3.25rem;">
                    
                    <!-- Class Baseline Block (Polished SMU Academic Slot) -->
                    <div 
                      v-if="isClassSlot(dIdx, hIdx)" 
                      class="pulse-class-pill rounded-2"
                      :title="`Recurring Academic Timetable: ${getClassName(dIdx, hIdx)}`"
                      @click="toastMsg = `${getClassName(dIdx, hIdx)} Class Timetable: Fixed commitment for ${d} @ ${h}.`"
                    >
                      <span class="pulse-class-name">{{ getClassName(dIdx, hIdx) }}</span>
                      <span class="pulse-class-sub">SMU Core</span>
                    </div>

                    <!-- Regular Heatmap Cell (Interactive When2Meet Toggle) -->
                    <div 
                      v-else
                      class="pulse-heat-cell rounded-2 position-relative"
                      :class="[
                        `pulse-heat-${heatmapMatrix[dIdx][hIdx]}`,
                        isMySlotAvailable(dIdx, hIdx) ? 'pulse-heat-my-active' : ''
                      ]"
                      :title="`${d} @ ${h}: ${heatmapMatrix[dIdx][hIdx]}/12 available. Click to toggle your personal availability (When2Meet style)`"
                      @click="handleCellClick(d, h, dIdx, hIdx)"
                    >
                      <span v-if="heatmapMatrix[dIdx][hIdx] > 0" class="pulse-heat-count">
                        {{ heatmapMatrix[dIdx][hIdx] }}/12
                      </span>
                      <span v-else class="pulse-heat-empty">
                        -
                      </span>
                      <!-- Personal Available Indicator Badge -->
                      <span 
                        v-if="isMySlotAvailable(dIdx, hIdx)" 
                        class="position-absolute top-0 end-0 translate-middle-y me-1 badge rounded-pill bg-primary shadow-sm"
                        style="font-size: 0.5rem; padding: 0.15rem 0.35rem;"
                      >
                        You
                      </span>
                    </div>

                  </td>
                </tr>
              </tbody>
            </table>
          </div>

        </div>
      </div>

      <!-- Right: Optimal Recommendation & Telegram Contact Panel -->
      <div class="col-lg-4">
        
        <!-- Optimal Match Card -->
        <div class="pulse-card p-4 shadow-sm mb-4 border-start border-success border-4">
          <div class="text-uppercase fw-bold text-success small mb-1" style="font-size: 0.7rem; letter-spacing: 0.08em;">
            AI Scheduling Engine
          </div>
          <h5 class="fw-bold mb-2">Best Match Found</h5>
          <div class="p-3 rounded-3 bg-success bg-opacity-10 text-success border border-success-subtle mb-3">
            <div class="fw-bold fs-6">Friday, 16 October 2026</div>
            <div class="small">16:00 – 19:00 (3 hours window)</div>
            <div class="small fw-semibold mt-1">✓ All 12 ExCo members confirmed available</div>
          </div>
          <p class="text-muted small mb-3">
            Zero clashes with class schedules or existing facility bookings. Ready to lock schedule and broadcast to all 12 ExCos.
          </p>

          <!-- Meeting Confirmed Alert (If already scheduled) -->
          <div v-if="meetingConfirmed" class="p-3 rounded-3 bg-success bg-opacity-10 border border-success mb-3 text-success small">
            <div class="fw-bold d-flex align-items-center gap-1">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M20 6L9 17l-5-5"></path>
              </svg>
              <span>Meeting Confirmed & Broadcasted!</span>
            </div>
            <div class="mt-1 text-muted" style="font-size: 0.725rem;">
              {{ meetingForm.title }} • {{ meetingForm.date }} ({{ meetingForm.time }}) at {{ meetingForm.venue }}.
            </div>
          </div>

          <!-- Create Meeting & Broadcast Agenda Button (Requested by Chloe & Sarah) -->
          <button 
            type="button" 
            class="btn btn-pulse-primary w-100 py-2 fw-bold mb-2 d-flex align-items-center justify-content-center gap-2" 
            @click="openMeetingModal()"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
            <span>{{ meetingConfirmed ? 'Edit / Reschedule Meeting' : 'Create Meeting & Broadcast Agenda' }}</span>
          </button>

          <!-- Secondary Calendar Sync Button -->
          <button 
            type="button" 
            class="btn btn-outline-secondary w-100 btn-sm py-1 fw-semibold" 
            @click="exportToCalendar(meetingForm)"
          >
            Export to Calendar (.ics)
          </button>
        </div>

        <!-- Prof K Feedback Feature: Telegram Prompt for Unresponsive Members -->
        <div class="pulse-card p-4 shadow-sm">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <div>
              <div class="text-uppercase fw-bold text-muted small" style="font-size: 0.65rem;">Prof K Recommendation</div>
              <h6 class="fw-bold mb-0">Unconfirmed Timetables</h6>
            </div>
            <span class="badge bg-warning bg-opacity-25 text-dark border border-warning" style="font-size: 0.65rem;">
              {{ unconfirmedMembers.length }} Pending
            </span>
          </div>
          <p class="text-muted small mb-3">
            These members haven't updated their weekly availability. Nudge them directly on Telegram with one tap.
          </p>

          <div class="d-flex flex-column gap-2 mb-3">
            <div 
              v-for="m in unconfirmedMembers" 
              :key="m.name"
              class="d-flex justify-content-between align-items-center p-2 rounded-3 bg-light border"
            >
              <div>
                <strong class="small d-block">{{ m.name }}</strong>
                <span class="text-muted" style="font-size: 0.7rem;">{{ m.role }} ({{ m.handle }})</span>
              </div>
              <button 
                type="button" 
                class="btn btn-sm btn-outline-primary py-1 px-2 fw-bold"
                style="font-size: 0.7rem;"
                @click="pingMemberOnTelegram(m)"
              >
                Ping via Telegram
              </button>
            </div>
          </div>

          <button 
            type="button" 
            class="btn btn-outline-secondary w-100 btn-sm py-2 fw-bold"
            @click="pingAllOnTelegram"
          >
            Broadcast Reminder to All Pending (Telegram Bot)
          </button>
        </div>

      </div>

    </div>

    <!-- Create Meeting & Broadcast Agenda Modal (Requested by Chloe & Sarah) -->
    <div v-if="showMeetingModal" class="modal-backdrop fade show" style="background: rgba(15, 23, 42, 0.65); backdrop-filter: blur(4px); z-index: 1055;"></div>
    <div v-if="showMeetingModal" class="modal fade show d-block" tabindex="-1" style="z-index: 1060;">
      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content border-0 shadow-lg rounded-4 overflow-hidden" style="background-color: var(--pulse-card-bg);">
          <div class="modal-header border-bottom px-4 py-3 bg-light">
            <div class="d-flex align-items-center gap-2">
              <div class="pulse-logo-badge" style="width: 1.85rem; height: 1.85rem; font-size: 0.9rem;">
                <span>P</span>
              </div>
              <div>
                <h5 class="modal-title fw-bold mb-0">Schedule ExCo Meeting & Broadcast Agenda</h5>
                <small class="text-muted" style="font-size: 0.75rem;">Dispatches automated invitation and agenda to all 12 ExCo members on Telegram.</small>
              </div>
            </div>
            <button type="button" class="btn-close" @click="showMeetingModal = false"></button>
          </div>
          
          <div class="modal-body p-4">
            <div class="row g-3">
              <!-- Selected Time Window -->
              <div class="col-md-6">
                <label class="form-label small fw-bold text-muted">Confirmed Date & Time Window</label>
                <div class="p-2 rounded-3 bg-light border fw-bold small text-dark d-flex align-items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="16" y1="2" x2="16" y2="6"></line>
                    <line x1="8" y1="2" x2="8" y2="6"></line>
                    <line x1="3" y1="10" x2="21" y2="10"></line>
                  </svg>
                  <span>{{ meetingForm.date }} • {{ meetingForm.time }}</span>
                </div>
              </div>

              <!-- Venue Selection -->
              <div class="col-md-6">
                <label class="form-label small fw-bold text-muted">Venue / Facility Location</label>
                <select v-model="meetingForm.venue" class="form-select form-select-sm fw-bold">
                  <option value="SMU Connexion Meeting Room 3">SMU Connexion Meeting Room 3</option>
                  <option value="Studio L7.2 (Dance)">Studio L7.2 (Dance)</option>
                  <option value="Music Drama Lab (MDL)">Music Drama Lab (MDL)</option>
                  <option value="Basement Studio">Basement Studio</option>
                  <option value="Li Ka Shing B1 Rehearsal Space">Li Ka Shing B1 Rehearsal Space</option>
                </select>
              </div>

              <!-- Meeting Subject -->
              <div class="col-12">
                <label class="form-label small fw-bold text-muted">Meeting Title / Subject</label>
                <input v-model="meetingForm.title" type="text" class="form-control form-control-sm fw-bold" placeholder="e.g. SMU Arts Festival Opening Night - Run of Show Alignment" />
              </div>

              <!-- Meeting Agenda -->
              <div class="col-12">
                <label class="form-label small fw-bold text-muted d-flex justify-content-between align-items-center">
                  <span>Meeting Agenda & Objectives</span>
                  <span class="badge bg-purple text-white" style="font-size: 0.6rem; background-color: var(--pulse-purple-transit);">Auto-Broadcasts to Telegram</span>
                </label>
                <textarea v-model="meetingForm.agenda" class="form-control" rows="4" style="font-size: 0.8rem; font-family: inherit;" placeholder="List key agenda items..."></textarea>
              </div>

              <!-- Target Recipients with Multi-Select & Search (Requested by Chloe) -->
              <div class="col-12">
                <div class="p-3 rounded-3 bg-light border">
                  <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
                    <div>
                      <div class="small fw-bold text-dark">Telegram Broadcast Target ({{ selectedRecipientIds.length }} Selected)</div>
                      <div class="text-muted small" style="font-size: 0.725rem;">Select individual members or filter by committee.</div>
                    </div>
                    <div class="d-flex flex-wrap gap-1">
                      <button type="button" class="btn btn-sm btn-outline-secondary py-0 px-2 rounded-pill" style="font-size: 0.65rem;" @click="selectAllRecipients">
                        All (12)
                      </button>
                      <button type="button" class="btn btn-sm btn-outline-secondary py-0 px-2 rounded-pill" style="font-size: 0.65rem;" @click="selectDancersOnly">
                        Dancers (3)
                      </button>
                      <button type="button" class="btn btn-sm btn-outline-secondary py-0 px-2 rounded-pill" style="font-size: 0.65rem;" @click="selectLogisticsOnly">
                        Logistics/Tech (4)
                      </button>
                      <button type="button" class="btn btn-sm btn-outline-secondary py-0 px-2 rounded-pill" style="font-size: 0.65rem;" @click="selectExecutiveOnly">
                        Executive (3)
                      </button>
                    </div>
                  </div>

                  <!-- Recipient Search Filter Input -->
                  <div class="mb-2">
                    <input 
                      v-model="recipientSearch" 
                      type="text" 
                      class="form-control form-control-sm" 
                      placeholder="Search member by name, handle (e.g. @angellow), or role..."
                      style="font-size: 0.75rem;"
                    />
                  </div>

                  <!-- Recipient Chips List -->
                  <div class="d-flex flex-wrap gap-1" style="max-height: 120px; overflow-y: auto;">
                    <button
                      v-for="member in filteredRecipients"
                      :key="member.id"
                      type="button"
                      class="btn btn-sm py-1 px-2 rounded-pill border d-inline-flex align-items-center gap-1 transition-all"
                      :class="selectedRecipientIds.includes(member.id) ? 'btn-danger text-white' : 'btn-white text-muted'"
                      style="font-size: 0.685rem;"
                      @click="toggleRecipient(member.id)"
                    >
                      <span>{{ selectedRecipientIds.includes(member.id) ? '✓' : '+' }}</span>
                      <span>{{ member.name }}</span>
                      <span class="opacity-75" style="font-size: 0.6rem;">({{ member.handle }})</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="modal-footer border-top px-4 py-3 bg-light d-flex justify-content-between">
            <button type="button" class="btn btn-outline-secondary btn-sm rounded-pill px-3" @click="showMeetingModal = false">
              Cancel
            </button>
            <button type="button" class="btn btn-pulse-primary btn-sm rounded-pill px-4 fw-bold d-flex align-items-center gap-2" @click="confirmAndBroadcastMeeting">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
              <span>Confirm Meeting & Dispatch Telegram Broadcast</span>
            </button>
          </div>
        </div>
      </div>
    </div>

  </div>
</template>
