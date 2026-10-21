<script setup>
import { ref } from 'vue';

const props = defineProps({
  apiMode: { type: Boolean, default: false }
});

const activeScenario = ref('member')
const unavailableMember = ref('Angel Low')
const simulationRun = ref(false)
const dispatchModalOpen = ref(false)
const dispatchSent = ref(false)
const dispatchAccepted = ref(false)
const toastMsg = ref('')
const activeComparison = ref('proposed')

const candidates = ref([
  {
    name: 'Alicia Ng',
    specialty: 'Stage Logistics & Dance',
    score: 94,
    availability: 'Fully Available (18:00–22:00)',
    workload: '1 active task',
    experience: '3 comparable opening night showcases',
    reason: 'Exact logistics match with zero overlapping cues.'
  },
  {
    name: 'Darren Koh',
    specialty: 'Performance Operations',
    score: 88,
    availability: 'Available from 18:00',
    workload: '2 active tasks',
    experience: '2 opening nights',
    reason: 'Strong Act 2 experience; low-priority task can be shifted.'
  },
  {
    name: 'Joel Goh',
    specialty: 'Backstage Runner',
    score: 82,
    availability: 'Available 17:30–22:30',
    workload: '1 active task',
    experience: '4 campus showcases',
    reason: 'Available throughout affected window with relevant experience.'
  }
])

function runSimulation() {
  simulationRun.value = true
  toastMsg.value = `Simulation active: Testing contingency for ${unavailableMember.value} unavailability. Confirmed schedule remains read-only.`
  setTimeout(() => { toastMsg.value = '' }, 4000)
}

function openTelegramDispatch(candidate) {
  dispatchModalOpen.value = true
  dispatchSent.value = false
  dispatchAccepted.value = false
}

function sendTelegramDispatch() {
  dispatchSent.value = true
  toastMsg.value = 'Outbound interactive Telegram Bot message sent to Alicia Ng (@aliciang)!'
  setTimeout(() => { toastMsg.value = '' }, 4000)
}

function simulateMemberAcceptance() {
  dispatchAccepted.value = true
  toastMsg.value = 'Telegram Webhook Callback Received: Alicia Ng tapped [ Accept Gig ]! Database updated.'
  setTimeout(() => {
    dispatchModalOpen.value = false
    toastMsg.value = 'Contingency confirmed: Alicia Ng officially assigned to replace Angel Low in Act 2!'
  }, 2500)
}

function applyToEventPlan() {
  toastMsg.value = 'Applied Changes to Event Plan! Live Supabase database updated and Telegram confirmation broadcasted.'
  setTimeout(() => { toastMsg.value = '' }, 4500)
}
</script>

<template>
  <div class="py-2">
    
    <!-- Top Bar -->
    <div class="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-4">
      <div>
        <div class="d-flex align-items-center gap-2 mb-1">
          <span class="badge bg-danger rounded-pill px-2 py-1" style="font-size: 0.65rem; font-weight: 800;">FEATURE 5</span>
          <span v-if="apiMode" class="pulse-api-tag">Supabase DB Query + JS Matching</span>
          <span v-if="apiMode" class="pulse-api-tag">Telegram Bot API (Bidirectional Webhook)</span>
        </div>
        <h3 class="fw-bold mb-1">Event Risk Planning & What-If Simulator</h3>
        <p class="text-muted small mb-0">
          Pre-event contingency workspace simulating disruptions without touching live production records.
        </p>
      </div>

      <div class="d-flex flex-wrap gap-2">
        <button 
          type="button" 
          class="btn btn-sm btn-pulse-outline d-inline-flex align-items-center gap-1"
          @click="runSimulation"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
          </svg>
          <span>Run What-If Simulation</span>
        </button>

        <button 
          type="button" 
          class="btn btn-sm btn-pulse-primary d-inline-flex align-items-center gap-1"
          @click="applyToEventPlan"
        >
          <span>✓</span>
          <span>Apply Changes to Event Plan</span>
        </button>
      </div>
    </div>

    <!-- Toast Notice -->
    <div v-if="toastMsg" class="alert alert-success border-0 shadow-sm mb-4 d-flex align-items-center gap-2" role="alert">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
        <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
      </svg>
      <span>{{ toastMsg }}</span>
    </div>

    <!-- Disruption Simulator Setup Card -->
    <div class="pulse-card p-4 shadow-sm mb-4">
      <div class="d-flex justify-content-between align-items-center mb-3">
        <div>
          <span class="text-uppercase fw-bold text-danger small" style="font-size: 0.65rem;">Scenario Sandbox</span>
          <h5 class="fw-bold mb-0">Choose Disruption Scenario</h5>
        </div>
        <span class="badge bg-danger bg-opacity-10 text-danger border border-danger-subtle small">
          Sandboxed Memory • Read-Only
        </span>
      </div>

      <div class="row g-3">
        <div class="col-md-4">
          <button 
            type="button" 
            class="btn w-100 p-3 text-start rounded-3 border"
            :class="activeScenario === 'member' ? 'bg-danger bg-opacity-10 border-danger text-danger fw-bold' : 'bg-light text-dark'"
            @click="activeScenario = 'member'; runSimulation()"
          >
            <div style="font-size: 0.85rem;">Performer Illness / Drop</div>
            <small class="text-muted" style="font-size: 0.7rem;">Test replacement matching</small>
          </button>
        </div>

        <div class="col-md-4">
          <button 
            type="button" 
            class="btn w-100 p-3 text-start rounded-3 border"
            :class="activeScenario === 'facility' ? 'bg-danger bg-opacity-10 border-danger text-danger fw-bold' : 'bg-light text-dark'"
            @click="activeScenario = 'facility'; runSimulation()"
          >
            <div style="font-size: 0.85rem;">Facility Unavailability</div>
            <small class="text-muted" style="font-size: 0.7rem;">Stage audio or room defect</small>
          </button>
        </div>

        <div class="col-md-4">
          <button 
            type="button" 
            class="btn w-100 p-3 text-start rounded-3 border"
            :class="activeScenario === 'delay' ? 'bg-danger bg-opacity-10 border-danger text-danger fw-bold' : 'bg-light text-dark'"
            @click="activeScenario = 'delay'; runSimulation()"
          >
            <div style="font-size: 0.85rem;">Schedule Delay (+30 mins)</div>
            <small class="text-muted" style="font-size: 0.7rem;">Soundcheck overruns</small>
          </button>
        </div>
      </div>

      <!-- Simulation Parameter Selector -->
      <div v-if="activeScenario === 'member'" class="mt-3 p-3 rounded-3 bg-light border d-flex flex-wrap align-items-center justify-content-between gap-3">
        <div class="d-flex align-items-center gap-2">
          <span class="small fw-bold text-muted">Simulate Unavailable Member:</span>
          <select v-model="unavailableMember" class="form-select form-select-sm fw-bold" style="width: 180px;" @change="runSimulation">
            <option>Angel Low</option>
            <option>Rachel Chua</option>
            <option>Darren Koh</option>
          </select>
        </div>
        <div class="text-muted small">
          Affects: <strong>Act 2 Tech Rehearsal</strong> (18:30–19:30 @ Main Hall Stage)
        </div>
      </div>
    </div>

    <!-- Simulation Results & Impact Cards -->
    <div class="row g-3 mb-4">
      <div class="col-6 col-md-3">
        <div class="pulse-card p-3 shadow-sm text-center">
          <div class="text-muted small text-uppercase fw-bold" style="font-size: 0.65rem;">Affected Segments</div>
          <div class="fw-bold fs-5 mt-1 text-danger">2 Segments</div>
        </div>
      </div>
      <div class="col-6 col-md-3">
        <div class="pulse-card p-3 shadow-sm text-center">
          <div class="text-muted small text-uppercase fw-bold" style="font-size: 0.65rem;">Assignments Requiring Review</div>
          <div class="fw-bold fs-5 mt-1 text-warning">2 Members</div>
        </div>
      </div>
      <div class="col-6 col-md-3">
        <div class="pulse-card p-3 shadow-sm text-center">
          <div class="text-muted small text-uppercase fw-bold" style="font-size: 0.65rem;">Potential Conflicts</div>
          <div class="fw-bold fs-5 mt-1 text-danger">2 Conflicts</div>
        </div>
      </div>
      <div class="col-6 col-md-3">
        <div class="pulse-card p-3 shadow-sm text-center">
          <div class="text-muted small text-uppercase fw-bold" style="font-size: 0.65rem;">Recovery Feasibility</div>
          <div class="fw-bold fs-5 mt-1 text-success">94% Solvable</div>
        </div>
      </div>
    </div>

    <!-- Ranked Member Recommendations with "Rider Book Guy" Telegram Dispatch -->
    <div class="pulse-card p-4 shadow-sm mb-4">
      <div class="d-flex justify-content-between align-items-center mb-3">
        <div>
          <span class="text-uppercase fw-bold text-primary small" style="font-size: 0.65rem;">
            Automated Telegram Dispatch
          </span>
          <h5 class="fw-bold mb-0">Ranked Replacement Candidates</h5>
        </div>
        <span class="badge bg-purple-100 text-purple border" style="background-color: #f3e8ff; color: #6b21a8;">
          Multi-Factor Suitability Scoring
        </span>
      </div>

      <div class="row g-3">
        <div v-for="cand in candidates" :key="cand.name" class="col-lg-4">
          <div class="p-3 rounded-3 border h-100 d-flex flex-column justify-content-between pulse-candidate-card">
            <div>
              <div class="d-flex justify-content-between align-items-center mb-1">
                <strong class="fs-6">{{ cand.name }}</strong>
                <span class="badge bg-success bg-opacity-10 text-success border border-success fw-bold fs-6">
                  {{ cand.score }}% Match
                </span>
              </div>
              <div class="text-muted small fw-semibold mb-2">
                {{ cand.specialty }} • {{ cand.workload }}
              </div>
              <div class="p-2 rounded-2 bg-light small mb-2 pulse-candidate-meta" style="font-size: 0.725rem;">
                <strong>Availability:</strong> {{ cand.availability }}<br>
                <strong>Experience:</strong> {{ cand.experience }}
              </div>
              <p class="text-muted small mb-3" style="font-size: 0.75rem;">
                {{ cand.reason }}
              </p>
            </div>

            <!-- 1-Tap Telegram Reachout Button -->
            <button 
              type="button" 
              class="btn btn-pulse-primary btn-sm w-100 fw-bold d-flex align-items-center justify-content-center gap-2 py-2"
              @click="openTelegramDispatch(cand)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
              <span>Dispatch via Telegram Bot</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Interactive Telegram Dispatch Simulation Modal -->
    <div v-if="dispatchModalOpen" class="position-fixed inset-0 bg-dark bg-opacity-50 d-flex justify-content-center align-items-center p-3" style="z-index: 1060; top: 0; left: 0; right: 0; bottom: 0;">
      <div class="pulse-card p-4 shadow-lg" style="max-width: 460px; width: 100%;">
        
        <div class="d-flex justify-content-between align-items-center mb-3">
          <h5 class="fw-bold mb-0">Automated Telegram Dispatch</h5>
          <button type="button" class="btn-close" @click="dispatchModalOpen = false"></button>
        </div>

        <p class="text-muted small mb-3">
          Sends an interactive dispatch to Alicia Ng's Telegram with inline buttons. When she responds, Pulse automatically updates the database.
        </p>

        <!-- Simulated Telegram Chat Message Preview -->
        <div class="p-3 rounded-3 mb-3 border text-white" style="background: linear-gradient(135deg, #1e293b, #0f172a);">
          <div class="d-flex align-items-center gap-2 mb-2 pb-2 border-bottom border-secondary">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="11" width="18" height="10" rx="2"></rect>
              <circle cx="12" cy="5" r="2"></circle>
              <path d="M12 7v4"></path>
              <line x1="8" y1="16" x2="8" y2="16"></line>
              <line x1="16" y1="16" x2="16" y2="16"></line>
            </svg>
            <strong class="small text-white">SMU Pulse Dispatcher Bot</strong>
            <span class="badge bg-primary ms-auto" style="font-size: 0.6rem;">TELEGRAM</span>
          </div>
          <div class="small mb-2">
            <strong>URGENT GIG CALL: SMU Arts Festival</strong><br>
            Act 2 Hip-Hop Tech Rehearsal (18:30–19:30)<br>
            Venue: Main Hall Stage, Li Ka Shing B1<br>
            <em>Your schedule is free and matches this role.</em>
          </div>

          <!-- Interactive Inline Buttons in Telegram -->
          <div class="d-flex gap-2 mt-3">
            <button 
              type="button" 
              class="btn btn-success btn-sm flex-grow-1 fw-bold"
              :disabled="dispatchAccepted"
              @click="simulateMemberAcceptance"
            >
              <span v-if="dispatchAccepted">✓ Accepted!</span>
              <span v-else>[ Accept Gig ]</span>
            </button>
            <button 
              type="button" 
              class="btn btn-outline-light btn-sm flex-grow-1"
              :disabled="dispatchAccepted"
              @click="dispatchModalOpen = false"
            >
              [ Decline ]
            </button>
          </div>
        </div>

        <div v-if="!dispatchSent" class="text-center">
          <button type="button" class="btn btn-pulse-primary w-100 py-2 fw-bold" @click="sendTelegramDispatch">
            Trigger Outbound Telegram Message
          </button>
        </div>
        <div v-else class="text-center text-success small fw-bold">
          Message delivered! Tap <strong>[ Accept Gig ]</strong> above to simulate Alicia's callback.
        </div>

      </div>
    </div>

    <!-- Side-by-Side Comparison: Original vs Proposed Recovery -->
    <div class="pulse-card p-4 shadow-sm">
      <div class="d-flex justify-content-between align-items-center mb-3">
        <h5 class="fw-bold mb-0">Plan Comparison</h5>
        <div class="btn-group btn-group-sm">
          <button 
            type="button" 
            class="btn" 
            :class="activeComparison === 'original' ? 'btn-secondary text-white' : 'btn-outline-secondary'"
            @click="activeComparison = 'original'"
          >
            Original Plan
          </button>
          <button 
            type="button" 
            class="btn" 
            :class="activeComparison === 'proposed' ? 'btn-success text-white' : 'btn-outline-success'"
            @click="activeComparison = 'proposed'"
          >
            Proposed Recovery Plan
          </button>
        </div>
      </div>

      <div class="p-3 rounded-3" :class="activeComparison === 'proposed' ? 'bg-success bg-opacity-10 border border-success-subtle' : 'bg-light border'">
        <div class="d-flex justify-content-between align-items-center">
          <div>
            <strong class="d-block">{{ activeComparison === 'proposed' ? 'Proposed Plan: Alicia Ng Replaces Angel Low' : 'Original Confirmed Plan (Angel Low)' }}</strong>
            <small class="text-muted">Act 2: Eurhythmix Tech Rehearsal • 18:30 – 19:30 • Main Hall Stage</small>
          </div>
          <span class="badge" :class="activeComparison === 'proposed' ? 'bg-success' : 'bg-secondary'">
            {{ activeComparison === 'proposed' ? 'Zero Conflicts Remaining' : 'Active Conflict Flagged' }}
          </span>
        </div>
      </div>
    </div>

  </div>
</template>
