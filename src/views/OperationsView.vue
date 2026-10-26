<script setup>
import { ref, computed } from 'vue';

const props = defineProps({
  apiMode: { type: Boolean, default: false },
  readOnly: { type: Boolean, default: false }
});

const toastMsg = ref('')

// Guests can look around but not make changes
function blockedForGuest() {
  if (!props.readOnly) return false
  toastMsg.value = 'Guest view is read-only. Sign in as a CCA ExCo to make changes.'
  return true
}
const delayNotice = ref('')
const selectedTaskId = ref('cue-2')
const operationsSearchQuery = ref('')

const tasks = ref([
  {
    id: 'cue-1',
    title: 'Act 1: Symphonia Soundcheck',
    track: 1, // Main Stage
    start: '17:00',
    end: '18:00',
    crew: ['Marcus Tan', 'Sarah Lim'],
    venue: 'Main Hall Stage',
    status: 'Completed',
    dependencies: []
  },
  {
    id: 'transit-1',
    title: 'OneMap Transit Buffer (Holding Room → Main Hall)',
    track: 3, // Concourse
    start: '18:00',
    end: '18:30',
    crew: ['Rachel Tan', 'Darren Koh'],
    venue: 'Campus Concourse (650m, 8m walk)',
    status: 'In Progress',
    dependencies: ['cue-1']
  },
  {
    id: 'cue-2',
    title: 'Act 2: Eurhythmix Tech Rehearsal',
    track: 1, // Main Stage
    start: '18:30',
    end: '19:30',
    crew: ['Angel Low', 'Rachel Chua', 'Darren Koh'],
    venue: 'Main Hall Stage, Li Ka Shing B1',
    status: 'Not Started',
    dependencies: ['transit-1']
  },
  {
    id: 'cue-3',
    title: 'Act 2 Audio & Lighting Programming',
    track: 2, // Technical Booth
    start: '19:30',
    end: '20:15',
    crew: ['Rachel Tan', 'Sarah Lim'],
    venue: 'Audio & Lighting Booth',
    status: 'Not Started',
    dependencies: ['cue-2']
  },
  {
    id: 'cue-4',
    title: 'Opening Night Live Production',
    track: 1, // Main Stage
    start: '20:15',
    end: '22:00',
    crew: ['Full Cast (45 Performers)'],
    venue: 'Main Hall Stage',
    status: 'Not Started',
    dependencies: ['cue-3']
  }
])

// Performer Attendance Roster
const performers = ref([
  { id: 1, name: 'Angel Low', role: 'Lead Dancer (Act 2)', status: 'Checked In', eta: 'On Time', phone: '@angellow' },
  { id: 2, name: 'Rachel Chua', role: 'Performer (Act 2)', status: 'Checked In', eta: 'On Time', phone: '@rachelc' },
  { id: 3, name: 'Darren Koh', role: 'Performer & Props', status: 'In Transit', eta: 'Running 10m Late (SOE Seminar)', phone: '@darrenk' },
  { id: 4, name: 'Marcus Tan', role: 'Stage Manager', status: 'Checked In', eta: 'On Time', phone: '@marcustan' },
  { id: 5, name: 'Sarah Lim', role: 'Sound Engineer', status: 'Checked In', eta: 'On Time', phone: '@sarahlim' }
])

const filteredTasks = computed(() => {
  const q = operationsSearchQuery.value.trim().toLowerCase()
  if (!q) return tasks.value
  return tasks.value.filter(t => 
    t.title.toLowerCase().includes(q) ||
    t.venue.toLowerCase().includes(q) ||
    t.crew.some(c => c.toLowerCase().includes(q))
  )
})

const filteredPerformers = computed(() => {
  const q = operationsSearchQuery.value.trim().toLowerCase()
  if (!q) return performers.value
  return performers.value.filter(p =>
    p.name.toLowerCase().includes(q) ||
    p.role.toLowerCase().includes(q) ||
    p.phone.toLowerCase().includes(q)
  )
})

const isEndorsedToSlims = ref(false)
const slimsEndorseTimestamp = ref('')

function markPerformerPresent(performer) {
  if (blockedForGuest()) return
  performer.status = 'Checked In'
  performer.eta = 'On Site ✓'
  const now = new Date()
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  performer.checkinTime = `${timeStr} SGT`
  performer.checkinMethod = 'ExCo Rehearsal Call Sheet'
  toastMsg.value = `Marked Present: ${performer.name} is on site at Li Ka Shing B1.`
  setTimeout(() => { toastMsg.value = '' }, 4000)
}

function markPerformerLate(performer) {
  if (blockedForGuest()) return
  performer.status = 'Delayed'
  performer.eta = '+15m Late (In Transit)'
  toastMsg.value = `Flagged Late: ${performer.name} running 15 mins behind. Downstream cues updated.`
  setTimeout(() => { toastMsg.value = '' }, 4500)
}

function checkInPerformer(performer, isManualOverride = false) {
  markPerformerPresent(performer)
}

function reportLateETA(performer) {
  markPerformerLate(performer)
}

function endorseAttendanceToSLiMS() {
  if (blockedForGuest()) return
  isEndorsedToSlims.value = true
  const now = new Date()
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  slimsEndorseTimestamp.value = `${timeStr} SGT`
  toastMsg.value = `Attendance officially signed by ExCo! Synced to SMU SLiMS attendance registry for CCA transcript credit.`
  setTimeout(() => { toastMsg.value = '' }, 5000)
}

function broadcastTelegramCallSheet() {
  if (blockedForGuest()) return
  toastMsg.value = `Telegram Bot broadcasted call sheet & cue updates to all performers and crew via linked chat!`
  setTimeout(() => { toastMsg.value = '' }, 4500)
}

// One-Click Delay Cascade (+15 mins)
function applyOneClickDelay() {
  if (blockedForGuest()) return
  // Shifts downstream tasks by 15 mins
  tasks.value = tasks.value.map(task => {
    if (task.status === 'Completed') return task
    return {
      ...task,
      start: shiftTime(task.start, 15),
      end: shiftTime(task.end, 15)
    }
  })
  delayNotice.value = 'One-Click Delay applied: +15 minutes added to Act 2 and downstream production cues. Broadcast sent to all crew via Telegram.'
  setTimeout(() => { delayNotice.value = '' }, 5000)
}

function shiftTime(timeStr, mins) {
  const [h, m] = timeStr.split(':').map(Number)
  let total = h * 60 + m + mins
  let newH = Math.floor(total / 60)
  let newM = total % 60
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`
}

function publishToMobile() {
  if (blockedForGuest()) return
  toastMsg.value = 'Schedule Published Live! Telegram Bot broadcasted updated cues to 42 crew members. Web Push alert triggered.'
  setTimeout(() => { toastMsg.value = '' }, 5000)
}

// On-Call Standby Pool & AI Emergency Matcher
const showAiCopilotModal = ref(false)
const activeCopilotTab = ref('standby') // 'standby' or 'parser'
const targetAbsentPerformer = ref(null)
const isDispatchingStandby = ref(false)

const standbyPool = ref([
  {
    id: 101,
    name: 'Jessica Ong',
    role: 'Lead Dancer (Act 2 Standby)',
    phone: '@jessicaong',
    status: 'On-Call',
    matchScore: 98,
    availability: 'Free in Heatmap (18:00 - 21:00)',
    distance: '4m walk from SMU Connexion',
    qualification: 'Mastered Act 2 choreography in Oct rehearsals'
  },
  {
    id: 102,
    name: 'Ryan Teo',
    role: 'Stage Crew & Props Standby',
    phone: '@ryanteo',
    status: 'On-Call',
    matchScore: 92,
    availability: 'Free in Heatmap (17:30 - 21:30)',
    distance: '2m walk from Li Ka Shing Library',
    qualification: 'Certified stagehand & props coordinator'
  },
  {
    id: 103,
    name: 'Chloe Lim',
    role: 'Ensemble Dancer Standby',
    phone: '@chloelim',
    status: 'On-Call',
    matchScore: 85,
    availability: 'Free in Heatmap (18:30 - 20:30)',
    distance: '6m walk from SOE Concourse',
    qualification: 'Ensemble dance backup'
  }
])

function triggerStandbyForPerformer(p) {
  if (blockedForGuest()) return
  targetAbsentPerformer.value = p
  activeCopilotTab.value = 'standby'
  showAiCopilotModal.value = true
}

function dispatchStandby(candidate) {
  if (blockedForGuest()) return
  isDispatchingStandby.value = true
  setTimeout(() => {
    isDispatchingStandby.value = false
    showAiCopilotModal.value = false

    if (targetAbsentPerformer.value) {
      targetAbsentPerformer.value.status = 'Delayed'
      targetAbsentPerformer.value.eta = `Replaced by ${candidate.name} (On-Call)`
    }

    const targetName = targetAbsentPerformer.value ? targetAbsentPerformer.value.name : 'Darren Koh'
    tasks.value = tasks.value.map(t => {
      if (t.crew.includes(targetName)) {
        return {
          ...t,
          crew: t.crew.map(c => c === targetName ? `${candidate.name} (Standby)` : c)
        }
      }
      return t
    })

    if (!performers.value.some(p => p.name === candidate.name)) {
      performers.value.push({
        id: candidate.id,
        name: candidate.name,
        role: candidate.role,
        status: 'In Transit',
        eta: `Dispatched Standby (${candidate.distance})`,
        phone: candidate.phone
      })
    }

    toastMsg.value = `Emergency Standby Activated: Telegram Bot pinged ${candidate.name} (${candidate.phone}). Reassigned to ${targetName}'s cue slot in real time!`
    setTimeout(() => { toastMsg.value = '' }, 6000)
  }, 600)
}

// AI Telegram Notice & Shopping List Parser
const rawChatInput = ref('')
const isAiParsing = ref(false)
const parsedNoticeResult = ref(null)

const sampleChatNotice = `Hihi everyone, Ardiente will be giving away the following bookings:
8 Oct, Thursday, 15:00-18:00 @ Gym Studio. Pls pm if needed!
Also for rehearsal this Friday at Main Hall Stage:
- Please remember to bring knee pads and black practice tights
- Sound team needs 2 rolls of black gaffer tape and 4 extra AAA batteries
- Logistics team please buy 15 bottles of 100PLUS from Cheers
Poll below on who can make it!`

function loadSampleChat() {
  rawChatInput.value = sampleChatNotice
}

function parseNoticeWithAi() {
  if (!rawChatInput.value.trim()) return
  isAiParsing.value = true
  parsedNoticeResult.value = null
  setTimeout(() => {
    isAiParsing.value = false
    parsedNoticeResult.value = {
      facilityRelease: {
        venue: 'Gym Studio (Sports Court)',
        date: 'Thursday, 8 Oct',
        time: '15:00 - 18:00',
        action: 'Direct Peer Transfer to Marketplace'
      },
      rehearsalCues: {
        location: 'Main Hall Stage (Friday)',
        gearRequired: ['Knee pads', 'Black practice tights'],
        techNeeds: ['2 rolls black gaffer tape', '4x AAA batteries']
      },
      shoppingList: [
        { item: '15 bottles of 100PLUS', store: 'Cheers (Campus Basement)', owner: 'Logistics Leads' },
        { item: 'Black gaffer tape (2 rolls)', store: 'Stationery store', owner: 'Sound Team' },
        { item: '4x AAA batteries', store: 'Cheers', owner: 'Sound Team' }
      ],
      telegramSummary: `[PULSE AI SUMMARY FOR ARDIENTE]
1. Facility Swap: Gym Studio (Thu 8 Oct, 15:00-18:00) listed on Pulse Marketplace.
2. Friday Rehearsal: Main Hall Stage. Bring knee pads + tights.
3. Logistics Assigned: 15x 100PLUS + Gaffer tape claimed by Logistics Team.`
    }
  }, 750)
}
</script>

<template>
  <div class="py-2">
    
    <!-- Top Command Center Bar -->
    <div class="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-4">
      <div>
        <div class="d-flex align-items-center gap-2 mb-1">
          <span class="badge bg-danger rounded-pill px-2 py-1" style="font-size: 0.65rem; font-weight: 800;">FEATURE 4</span>
          <span v-if="apiMode" class="pulse-api-tag">OneMap Routing API</span>
          <span v-if="apiMode" class="pulse-api-tag">Telegram Bot API</span>
          <span v-if="apiMode" class="pulse-api-tag">Web Push API</span>
        </div>
        <h3 class="fw-bold mb-1">Live Operations Command Center</h3>
        <p class="text-muted small mb-0">
          SMU Arts Festival Opening Night — Master Run-of-Show & Crew Timeline with real-time transit buffers.
        </p>
      </div>

      <!-- Live Action Buttons -->
      <div class="d-flex flex-wrap gap-2">
        <button 
          type="button" 
          class="btn btn-sm btn-outline-warning text-dark fw-bold border-warning d-flex align-items-center gap-2"
          @click="applyOneClickDelay"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
          <span>One-Click Delay (+15 mins)</span>
        </button>

        <button 
          type="button" 
          class="btn btn-sm btn-outline-danger fw-bold d-flex align-items-center gap-2 shadow-sm"
          @click="showAiCopilotModal = true; activeCopilotTab = 'standby'"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
          </svg>
          <span>Pulse AI Copilot</span>
        </button>

        <button 
          type="button" 
          class="btn btn-sm btn-pulse-primary d-flex align-items-center gap-2"
          @click="publishToMobile"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect>
            <line x1="12" y1="18" x2="12.01" y2="18"></line>
          </svg>
          <span>Publish Live to Mobile (Telegram & Push)</span>
        </button>
      </div>
    </div>

    <!-- Delay Notice Banner -->
    <div v-if="delayNotice" class="alert alert-warning border-0 shadow-sm mb-4 d-flex align-items-center gap-2" role="alert">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
        <line x1="12" y1="9" x2="12" y2="13"></line>
        <line x1="12" y1="17" x2="12.01" y2="17"></line>
      </svg>
      <span>{{ delayNotice }}</span>
    </div>

    <!-- Toast Banner -->
    <div v-if="toastMsg" class="alert alert-success border-0 shadow-sm mb-4 d-flex align-items-center gap-2" role="alert">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
        <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
      </svg>
      <span>{{ toastMsg }}</span>
    </div>

    <!-- Timeline Overview Metrics -->
    <div class="row g-3 mb-4">
      <div class="col-6 col-md-3">
        <div class="pulse-card p-3 shadow-sm text-center">
          <div class="text-muted small text-uppercase fw-bold" style="font-size: 0.65rem;">Live Date</div>
          <div class="fw-bold fs-6 mt-1">Fri, 23 Oct 2026</div>
        </div>
      </div>
      <div class="col-6 col-md-3">
        <div class="pulse-card p-3 shadow-sm text-center">
          <div class="text-muted small text-uppercase fw-bold" style="font-size: 0.65rem;">Cues Completed</div>
          <div class="fw-bold fs-6 mt-1 text-success">1 / 5 Cues Clear</div>
        </div>
      </div>
      <div class="col-6 col-md-3">
        <div class="pulse-card p-3 shadow-sm text-center">
          <div class="text-muted small text-uppercase fw-bold" style="font-size: 0.65rem;">OneMap Transit Route</div>
          <div class="fw-bold fs-6 mt-1 text-primary">650m (8 mins walk)</div>
        </div>
      </div>
      <div class="col-6 col-md-3">
        <div class="pulse-card p-3 shadow-sm text-center">
          <div class="text-muted small text-uppercase fw-bold" style="font-size: 0.65rem;">Crew Connected</div>
          <div class="fw-bold fs-6 mt-1 text-dark">42 Performers</div>
        </div>
      </div>
    </div>

    <!-- Dynamic Search & Filter Bar for Day-of Operations (Restores Search Visibility) -->
    <div class="card border-0 shadow-sm p-3 mb-4" style="border-radius: 1rem; background-color: var(--pulse-card-bg);">
      <div class="row g-2 align-items-center justify-content-between">
        <div class="col-12 col-md-7">
          <div class="input-group input-group-sm">
            <span class="input-group-text border-end-0 text-muted" style="border-radius: 9999px 0 0 9999px; background-color: var(--pulse-bg);">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            </span>
            <input 
              v-model="operationsSearchQuery" 
              type="text" 
              class="form-control border-start-0" 
              placeholder="Search cue title, crew (e.g. Darren, Angel), or venue..."
              style="border-radius: 0 9999px 9999px 0; background-color: var(--pulse-bg);"
            />
            <button 
              v-if="operationsSearchQuery" 
              type="button" 
              class="btn btn-sm border-start-0 text-muted"
              style="border-radius: 0 9999px 9999px 0; background-color: var(--pulse-bg);"
              @click="operationsSearchQuery = ''"
            >
              ✕
            </button>
          </div>
        </div>
        <div class="col-12 col-md-auto d-flex flex-wrap align-items-center gap-1">
          <span class="text-muted small fw-bold" style="font-size: 0.7rem; text-transform: uppercase;">Quick Filter:</span>
          <button type="button" class="btn btn-sm py-0 px-2 rounded-pill border" :class="!operationsSearchQuery ? 'btn-danger text-white' : 'btn-light text-muted'" style="font-size: 0.675rem;" @click="operationsSearchQuery = ''">All</button>
          <button type="button" class="btn btn-sm py-0 px-2 rounded-pill border" :class="operationsSearchQuery === 'Darren' ? 'btn-danger text-white' : 'btn-light text-muted'" style="font-size: 0.675rem;" @click="operationsSearchQuery = operationsSearchQuery === 'Darren' ? '' : 'Darren'">Darren</button>
          <button type="button" class="btn btn-sm py-0 px-2 rounded-pill border" :class="operationsSearchQuery === 'Angel' ? 'btn-danger text-white' : 'btn-light text-muted'" style="font-size: 0.675rem;" @click="operationsSearchQuery = operationsSearchQuery === 'Angel' ? '' : 'Angel'">Angel</button>
          <button type="button" class="btn btn-sm py-0 px-2 rounded-pill border" :class="operationsSearchQuery === 'Main Hall' ? 'btn-danger text-white' : 'btn-light text-muted'" style="font-size: 0.675rem;" @click="operationsSearchQuery = operationsSearchQuery === 'Main Hall' ? '' : 'Main Hall'">Main Hall</button>
        </div>
      </div>
    </div>

    <!-- Main Section: Multi-Track Timeline + Performer Attendance -->
    <div class="row g-4">
      
      <!-- Multi-Track Timeline -->
      <div class="col-lg-8">
        <div class="pulse-card p-4 shadow-sm mb-4">
          <div class="d-flex justify-content-between align-items-center mb-3">
            <div>
              <h5 class="fw-bold mb-0">Multi-Track Run-of-Show Timeline</h5>
              <small class="text-muted">Parallel cues across stage, technical booth, and performer holding areas.</small>
            </div>
            <span class="badge bg-light text-muted border small">17:00 – 22:00</span>
          </div>

          <div class="d-flex flex-column gap-3">
            <div 
              v-for="task in filteredTasks" 
              :key="task.id"
              class="p-3 rounded-3 border transition-all"
              :class="{
                'bg-success bg-opacity-10 border-success': task.status === 'Completed',
                'bg-warning bg-opacity-10 border-warning': task.status === 'In Progress',
                'pulse-task-unstarted border-slate-200': task.status === 'Not Started'
              }"
            >
              <div class="d-flex justify-content-between align-items-start gap-2">
                <div>
                  <div class="d-flex align-items-center gap-2 mb-1">
                    <strong class="fs-6">{{ task.title }}</strong>
                    <span 
                      class="badge" 
                      :class="{
                        'bg-success': task.status === 'Completed',
                        'bg-warning text-dark': task.status === 'In Progress',
                        'bg-secondary': task.status === 'Not Started'
                      }"
                    >
                      {{ task.status }}
                    </span>
                  </div>
                  <div class="text-muted small d-flex flex-wrap align-items-center gap-3">
                    <span class="d-inline-flex align-items-center gap-1">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                        <circle cx="12" cy="10" r="3"></circle>
                      </svg>
                      {{ task.venue }}
                    </span>
                    <span class="d-inline-flex align-items-center gap-1">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polyline points="12 6 12 12 16 14"></polyline>
                      </svg>
                      {{ task.start }} – {{ task.end }}
                    </span>
                  </div>
                  <div class="text-muted small mt-1 d-flex align-items-center gap-1">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                      <circle cx="9" cy="7" r="4"></circle>
                    </svg>
                    <span>Assigned Crew: {{ task.crew.join(', ') }}</span>
                  </div>
                </div>

                <div v-if="task.id === 'transit-1'" class="badge bg-purple-100 text-purple border border-purple-200 py-1 px-2" style="background-color: #f3e8ff; color: #6b21a8;">
                  OneMap Buffer
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>

      <!-- Right: ExCo Rehearsal Call Sheet & SLiMS Endorsement Board -->
      <div class="col-lg-4">
        <div class="pulse-card p-4 shadow-sm">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <div>
              <div class="text-uppercase fw-bold text-danger small" style="font-size: 0.65rem;">ExCo Day-Of Operations</div>
              <h5 class="fw-bold mb-0">Rehearsal Call Sheet</h5>
            </div>
            <span class="badge bg-success bg-opacity-10 text-success border border-success-subtle small d-flex align-items-center gap-1">
              <span class="pulse-status-dot" style="background-color: #16a34a; width: 6px; height: 6px;"></span>
              SLiMS & Telegram Synced
            </span>
          </div>
          <p class="text-muted small mb-3" style="font-size: 0.75rem;">
            General members have no login accounts. The on-duty Stage Manager / Dance ExCo verifies performer roll-call on-site and endorses attendance directly for SMU SLiMS transcript credits.
          </p>

          <!-- Attendance Stats Counter -->
          <div class="d-flex align-items-center justify-content-between p-2 mb-3 rounded-2 bg-light border">
            <span class="small text-muted" style="font-size: 0.72rem;">Cast Checked In:</span>
            <span class="badge bg-dark px-2 py-1" style="font-size: 0.72rem;">
              {{ performers.filter(p => p.status === 'Checked In').length }} / {{ performers.length }} Present
            </span>
          </div>

          <div class="d-flex flex-column gap-2 mb-3">
            <div 
              v-for="p in filteredPerformers" 
              :key="p.id"
              class="p-3 rounded-3 border bg-light d-flex flex-column gap-1"
            >
              <div class="d-flex justify-content-between align-items-center">
                <strong class="small">{{ p.name }}</strong>
                <span 
                  class="badge"
                  :class="{
                    'bg-success': p.status === 'Checked In',
                    'bg-warning text-dark': p.status === 'In Transit',
                    'bg-danger': p.status === 'Delayed'
                  }"
                  style="font-size: 0.65rem;"
                >
                  {{ p.status === 'Checked In' ? 'Present' : p.status }}
                </span>
              </div>
              <div class="text-muted" style="font-size: 0.725rem;">
                {{ p.role }} • {{ p.phone }}
              </div>
              
              <!-- Check-In Status Information -->
              <div v-if="p.status === 'Checked In'" class="small text-success d-flex align-items-center gap-1 mt-1 fw-semibold" style="font-size: 0.7rem;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <path d="M20 6L9 17l-5-5"></path>
                </svg>
                <span>Present • Checked in {{ p.checkinTime || '18:14 SGT' }} (SLiMS Verified)</span>
              </div>
              <div v-else class="fw-bold text-secondary mt-1" style="font-size: 0.725rem;">
                Status: {{ p.eta }}
              </div>

              <!-- Action Controls -->
              <div class="d-flex gap-2 mt-2">
                <template v-if="p.status !== 'Checked In'">
                  <button 
                    type="button" 
                    class="btn btn-sm btn-outline-success flex-grow-1 py-1 d-flex align-items-center justify-content-center gap-1"
                    style="font-size: 0.7rem; font-weight: 700;"
                    title="Mark performer present on-site"
                    @click="markPerformerPresent(p)"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                      <path d="M20 6L9 17l-5-5"></path>
                    </svg>
                    <span>Mark Present</span>
                  </button>
                  <button 
                    type="button" 
                    class="btn btn-sm btn-outline-warning text-dark py-1 px-2"
                    style="font-size: 0.7rem; font-weight: 700;"
                    title="Flag 15m delay from classes/transit"
                    @click="markPerformerLate(p)"
                  >
                    +15m Late
                  </button>
                  <button 
                    type="button" 
                    class="btn btn-sm btn-outline-danger py-1 px-2"
                    style="font-size: 0.65rem; font-weight: 700;"
                    title="Call On-Call Standby Replacement"
                    @click="triggerStandbyForPerformer(p)"
                  >
                    Call Standby
                  </button>
                </template>
                <template v-else>
                  <button 
                    type="button" 
                    class="btn btn-sm btn-light border py-1 px-2 text-muted"
                    style="font-size: 0.65rem;"
                    title="Update to late/delayed"
                    @click="markPerformerLate(p)"
                  >
                    Mark Delayed
                  </button>
                  <button 
                    type="button" 
                    class="btn btn-sm btn-outline-dark py-1 px-2"
                    style="font-size: 0.65rem; font-weight: 700;"
                    title="Call On-Call Standby Replacement"
                    @click="triggerStandbyForPerformer(p)"
                  >
                    Call Standby
                  </button>
                </template>
              </div>
            </div>
          </div>

          <!-- SLiMS Endorsement & Broadcast CTA -->
          <div class="d-flex flex-column gap-2 mb-3">
            <button 
              type="button" 
              class="btn btn-sm w-100 py-2 rounded-3 fw-bold d-flex align-items-center justify-content-center gap-2"
              :class="isEndorsedToSlims ? 'btn-success' : 'btn-pulse-primary'"
              @click="endorseAttendanceToSLiMS"
            >
              <svg v-if="isEndorsedToSlims" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M20 6L9 17l-5-5"></path>
              </svg>
              <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
                <polyline points="10 9 9 9 8 9"></polyline>
              </svg>
              <span style="font-size: 0.78rem;">
                {{ isEndorsedToSlims ? `Attendance Endorsed (${slimsEndorseTimestamp})` : 'Endorse Attendance to SMU SLiMS' }}
              </span>
            </button>

            <button 
              type="button" 
              class="btn btn-sm btn-outline-secondary w-100 py-1 rounded-3 d-flex align-items-center justify-content-center gap-1"
              style="font-size: 0.725rem;"
              @click="broadcastTelegramCallSheet"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
              <span>Broadcast Call Sheet via Telegram</span>
            </button>
          </div>

          <div class="p-2 rounded-2 bg-light border text-center small text-muted">
            <div class="fw-semibold text-dark mb-1" style="font-size: 0.725rem;">
              SLiMS Verification & Emergency Escalation Protocol
            </div>
            <div style="font-size: 0.7rem;">
              Attendance signed by ExCo syncs to official SMU SLiMS CCA transcripts.
              In case of facility defect or incident, contact <strong>OCIS Campus Security</strong> at <strong>+65 6828 0345 (Ext 7777)</strong> or OSL Advisor <strong>Chloe Ang</strong>.
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Pulse AI Copilot Modal: Standby Matcher & Notice Parser -->
    <div v-if="showAiCopilotModal" class="modal-backdrop fade show" style="background: rgba(15, 23, 42, 0.7); backdrop-filter: blur(4px); z-index: 1065;"></div>
    <div v-if="showAiCopilotModal" class="modal fade show d-block" tabindex="-1" style="z-index: 1070;">
      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content border-0 shadow-lg rounded-4 overflow-hidden" style="background-color: var(--pulse-card-bg); color: var(--pulse-ink);">
          
          <!-- Modal Header with Navigation Tabs -->
          <div class="modal-header border-bottom px-4 py-3 bg-light d-flex justify-content-between align-items-center">
            <div class="d-flex align-items-center gap-2">
              <div class="pulse-logo-badge" style="width: 2rem; height: 2rem; font-size: 0.95rem;">
                <span>AI</span>
              </div>
              <div>
                <h5 class="modal-title fw-bold mb-0">Pulse AI Operational Copilot</h5>
                <small class="text-muted" style="font-size: 0.725rem;">Intelligent On-Call Standby Matching & Telegram Notice Extraction</small>
              </div>
            </div>
            <button type="button" class="btn-close" @click="showAiCopilotModal = false"></button>
          </div>

          <!-- Tab Switcher -->
          <div class="px-4 pt-3 border-bottom pulse-copilot-tab-bar d-flex gap-2">
            <button 
              type="button" 
              class="btn btn-sm pb-2 px-3 border-0 rounded-0 fw-bold"
              :class="activeCopilotTab === 'standby' ? 'border-bottom border-danger border-2 text-danger' : 'text-muted'"
              @click="activeCopilotTab = 'standby'"
            >
              1. On-Call Standby Dispatch
            </button>
            <button 
              type="button" 
              class="btn btn-sm pb-2 px-3 border-0 rounded-0 fw-bold"
              :class="activeCopilotTab === 'parser' ? 'border-bottom border-danger border-2 text-danger' : 'text-muted'"
              @click="activeCopilotTab = 'parser'"
            >
              2. AI Notice & Shopping List Parser
            </button>
          </div>

          <div class="modal-body p-4" style="max-height: 70vh; overflow-y: auto;">
            
            <!-- TAB 1: On-Call Standby Matcher (Emergency Absence Resolution) -->
            <div v-if="activeCopilotTab === 'standby'">
              
              <!-- Problem Context Box -->
              <div class="card p-3 mb-3 border-0 rounded-3" style="background: rgba(239, 68, 68, 0.08); border-left: 4px solid #ef4444 !important;">
                <div class="d-flex justify-content-between align-items-center mb-1">
                  <span class="badge bg-danger rounded-pill px-2 py-0" style="font-size: 0.65rem;">PERFORMER ABSENCE DETECTED</span>
                  <span class="text-muted small" style="font-size: 0.7rem;">Heatmap Cross-Referenced</span>
                </div>
                <div class="fw-bold small text-dark">
                  Target Member: {{ targetAbsentPerformer ? targetAbsentPerformer.name : 'Darren Koh' }} 
                  ({{ targetAbsentPerformer ? targetAbsentPerformer.role : 'Performer & Props' }})
                </div>
                <p class="small text-muted mb-0" style="font-size: 0.75rem;">
                  Member reported emergency / delay for Act 2: Eurhythmix Tech Rehearsal. Pulse AI analyzed available members in the Weekly Availability Heatmap with matching skill tags and OneMap transit proximity.
                </p>
              </div>

              <!-- Standby Candidates List -->
              <h6 class="fw-bold text-dark mb-2" style="font-size: 0.85rem;">Top AI-Matched On-Call Replacements:</h6>
              <div class="d-flex flex-column gap-2 mb-3">
                
                <div 
                  v-for="candidate in standbyPool" 
                  :key="candidate.id"
                  class="p-3 rounded-3 border bg-light d-flex flex-column flex-sm-row justify-content-between align-items-sm-center gap-2"
                >
                  <div>
                    <div class="d-flex align-items-center gap-2 mb-1">
                      <strong class="text-dark small">{{ candidate.name }}</strong>
                      <span class="badge bg-success bg-opacity-10 text-success border border-success-subtle" style="font-size: 0.65rem;">
                        {{ candidate.matchScore }}% AI Match
                      </span>
                      <span class="badge bg-light text-muted border" style="font-size: 0.65rem;">{{ candidate.status }}</span>
                    </div>
                    <div class="text-muted small" style="font-size: 0.725rem;">
                      {{ candidate.role }} • {{ candidate.phone }}
                    </div>
                    <div class="text-secondary small mt-1" style="font-size: 0.725rem;">
                      <span>{{ candidate.availability }}</span>
                      <span class="mx-1">•</span>
                      <span class="text-primary fw-semibold">{{ candidate.distance }}</span>
                    </div>
                    <div class="text-muted small fst-italic" style="font-size: 0.7rem;">
                      {{ candidate.qualification }}
                    </div>
                  </div>

                  <button 
                    type="button" 
                    class="btn btn-sm btn-pulse-primary text-nowrap px-3 py-1 fw-bold"
                    style="font-size: 0.75rem;"
                    :disabled="isDispatchingStandby"
                    @click="dispatchStandby(candidate)"
                  >
                    <span v-if="isDispatchingStandby">Dispatching...</span>
                    <span v-else>Dispatch via Telegram</span>
                  </button>
                </div>

              </div>

              <div class="p-2 rounded-2 bg-light border text-muted small text-center" style="font-size: 0.725rem;">
                One-click dispatch sends a high-priority Telegram Bot alert and reassigns the cue card in the live production run-of-show.
              </div>
            </div>

            <!-- TAB 2: AI Telegram Notice & Shopping List Parser (Ardiente Real Problem) -->
            <div v-else>
              <div class="card p-3 mb-3 border-0 rounded-3" style="background: rgba(14, 165, 233, 0.08); border-left: 4px solid #0284c7 !important;">
                <div class="d-flex justify-content-between align-items-center mb-1">
                  <span class="badge bg-primary rounded-pill px-2 py-0" style="font-size: 0.65rem;">UNSTRUCTURED CHAT TO ACTIONABLE PULSE DATA</span>
                  <button 
                    type="button" 
                    class="btn btn-link btn-sm p-0 text-primary text-decoration-none small fw-bold"
                    style="font-size: 0.7rem;"
                    @click="loadSampleChat"
                  >
                    Load Real Ardiente Chat Sample
                  </button>
                </div>
                <p class="small text-muted mb-0" style="font-size: 0.75rem;">
                  In regular flat Telegram group chats, important notices, room give-aways, and shopping lists get buried. Paste any unorganized message below to extract facility handovers, checklists, and tasks automatically.
                </p>
              </div>

              <!-- Input Textarea -->
              <div class="mb-3">
                <label class="form-label small fw-bold text-dark mb-1">Paste Raw Telegram Message or Notice:</label>
                <textarea 
                  v-model="rawChatInput"
                  class="form-control form-control-sm"
                  rows="4"
                  placeholder="Paste unstructured announcement from Telegram group chat..."
                ></textarea>
              </div>

              <div class="d-flex justify-content-end mb-3">
                <button 
                  type="button" 
                  class="btn btn-sm btn-danger px-3 py-1 fw-bold d-flex align-items-center gap-2"
                  :disabled="isAiParsing || !rawChatInput.trim()"
                  @click="parseNoticeWithAi"
                >
                  <span v-if="isAiParsing" class="spinner-border spinner-border-sm" role="status"></span>
                  <span>{{ isAiParsing ? 'Analyzing with Pulse AI...' : 'Run Pulse AI Parser' }}</span>
                </button>
              </div>

              <!-- Structured Output Results -->
              <div v-if="parsedNoticeResult" class="p-3 border rounded-3 bg-light">
                <div class="d-flex align-items-center justify-content-between mb-2">
                  <h6 class="fw-bold text-dark mb-0" style="font-size: 0.825rem;">Extracted Structured Outputs:</h6>
                  <span class="badge bg-success rounded-pill px-2 py-0" style="font-size: 0.65rem;">Parsed via LLM Prompt Engine</span>
                </div>

                <div class="row g-2 mb-3">
                  <!-- Extracted Facility Release -->
                  <div class="col-md-6">
                    <div class="p-2 pulse-extracted-item rounded-2 border">
                      <div class="fw-bold text-danger small" style="font-size: 0.725rem;">Extracted Facility Giveaway:</div>
                      <div class="fw-bold text-dark" style="font-size: 0.8rem;">{{ parsedNoticeResult.facilityRelease.venue }}</div>
                      <div class="text-muted small" style="font-size: 0.7rem;">{{ parsedNoticeResult.facilityRelease.date }} • {{ parsedNoticeResult.facilityRelease.time }}</div>
                      <span class="badge bg-danger bg-opacity-10 text-danger border mt-1" style="font-size: 0.65rem;">
                        {{ parsedNoticeResult.facilityRelease.action }}
                      </span>
                    </div>
                  </div>

                  <!-- Extracted Gear & Cues -->
                  <div class="col-md-6">
                    <div class="p-2 pulse-extracted-item rounded-2 border">
                      <div class="fw-bold text-primary small" style="font-size: 0.725rem;">Rehearsal Gear Checklist:</div>
                      <div class="text-dark small fw-semibold" style="font-size: 0.75rem;">
                        {{ parsedNoticeResult.rehearsalCues.location }}
                      </div>
                      <ul class="mb-0 ps-3 small text-muted" style="font-size: 0.7rem;">
                        <li v-for="(gear, idx) in parsedNoticeResult.rehearsalCues.gearRequired" :key="idx">{{ gear }}</li>
                        <li v-for="(tech, idx) in parsedNoticeResult.rehearsalCues.techNeeds" :key="idx">{{ tech }}</li>
                      </ul>
                    </div>
                  </div>
                </div>

                <!-- Extracted Shopping List -->
                <div class="p-2 pulse-extracted-item rounded-2 border mb-2">
                  <div class="fw-bold text-success small mb-1" style="font-size: 0.725rem;">Logistics Shopping Checklist:</div>
                  <div class="d-flex flex-column gap-1">
                    <div 
                      v-for="(shop, idx) in parsedNoticeResult.shoppingList" 
                      :key="idx"
                      class="d-flex justify-content-between align-items-center py-1 px-2 rounded bg-light small"
                      style="font-size: 0.725rem;"
                    >
                      <span class="fw-semibold text-dark">{{ shop.item }}</span>
                      <div class="d-flex align-items-center gap-2">
                        <span class="text-muted">{{ shop.store }}</span>
                        <span class="badge bg-secondary-subtle text-dark border">{{ shop.owner }}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Clean Formatted Telegram Topic Message -->
                <div class="p-2 pulse-extracted-item rounded-2 border">
                  <div class="d-flex justify-content-between align-items-center mb-1">
                    <span class="fw-bold text-secondary small" style="font-size: 0.725rem;">Clean Formatted Telegram Broadcast:</span>
                    <button 
                      type="button" 
                      class="btn btn-link btn-sm p-0 text-decoration-none small text-primary fw-bold"
                      style="font-size: 0.7rem;"
                      @click="toastMsg = 'Copied clean formatted digest to clipboard!'; setTimeout(() => toastMsg = '', 3000)"
                    >
                      Copy to Clipboard
                    </button>
                  </div>
                  <pre class="mb-0 p-2 rounded bg-light text-dark small" style="font-size: 0.7rem; white-space: pre-wrap; font-family: inherit;">{{ parsedNoticeResult.telegramSummary }}</pre>
                </div>

              </div>

            </div>

          </div>

          <div class="modal-footer border-top px-4 py-3 bg-light d-flex justify-content-between align-items-center">
            <span class="text-muted small" style="font-size: 0.725rem;">Powered by Gemini API & SMU Availability Heatmap Engine</span>
            <button type="button" class="btn btn-pulse-primary btn-sm px-4 rounded-pill" @click="showAiCopilotModal = false">
              Close AI Assistant
            </button>
          </div>

        </div>
      </div>
    </div>

  </div>
</template>
