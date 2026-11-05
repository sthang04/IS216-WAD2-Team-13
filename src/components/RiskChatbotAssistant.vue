<script setup>
import { ref, computed, nextTick } from 'vue'
import { useRouter } from 'vue-router'

const props = defineProps({
  data: { type: Object, default: () => ({}) },
  events: { type: Array, default: () => [] },
  selectedEventId: { type: [String, Number], default: '' },
  selectedEvent: { type: Object, default: null },
  disruptionCards: { type: Array, default: () => [] },
  result: { type: Object, default: null },
  rankedRecoveryPlans: { type: Array, default: () => [] },
  bestRecoveryPlan: { type: Object, default: null },
  memberAssessments: { type: Array, default: () => [] },
  facilityRecovery: { type: Object, default: () => ({}) },
  loading: { type: Boolean, default: false }
})

const emit = defineEmits([
  'trigger-scenario',
  'apply-plan',
  'reset',
  'switch-to-matrix'
])

const router = useRouter()

// Conversational Message Log
const messages = ref([
  {
    id: 1,
    sender: 'assistant',
    text: "👋 Hi! I'm Pip, your Pulse Contingency AI Assistant.\n\nSelect a scenario below or ask me how to resolve an event risk!",
    timestamp: 'Just now',
    actions: null
  }
])

const userInput = ref('')
const isThinking = ref(false)
const chatContainer = ref(null)
const selectedScenarioKey = ref(null)

const PRESET_SCENARIOS = [
  {
    key: 'performer_illness',
    icon: '🚨',
    title: 'Performer Absence',
    prompt: 'Mei Chen / Angel reported sick for tonight\'s rehearsal. Who should cover?',
    summary: 'Find the next best match!'
  },
  {
    key: 'venue_fault',
    icon: '🏛️',
    title: 'Facility Unavailability',
    prompt: 'Studio L7.2 has an unexpected audio booth fault. What\'s our recovery plan?',
    summary: 'Search alternative available facilities.'
  },
  {
    key: 'schedule_delay',
    icon: '⏱️',
    title: 'Show Delays',
    prompt: 'Act 1 is running 30 minutes late. Calculate downstream schedule impact.',
    summary: 'Calculate shifted timings.'
  }
]

function scrollToBottom() {
  nextTick(() => {
    if (chatContainer.value) {
      chatContainer.value.scrollTop = chatContainer.value.scrollHeight
    }
  })
}

function handleSelectScenario(scenario) {
  userInput.value = scenario.prompt
  handleSendMessage(scenario.key)
}

function handleSendMessage(forcedKey = null) {
  const query = userInput.value.trim()
  if (!query && !forcedKey) return

  const scenarioKey = forcedKey || detectScenario(query)
  selectedScenarioKey.value = scenarioKey

  // Push user message
  messages.value.push({
    id: Date.now(),
    sender: 'user',
    text: query,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  })

  userInput.value = ''
  isThinking.value = true
  scrollToBottom()

  // Trigger parent simulation state update
  emit('trigger-scenario', scenarioKey)

  // Natural response delay (650ms)
  setTimeout(() => {
    isThinking.value = false
    generateAssistantResponse(scenarioKey)
    scrollToBottom()
  }, 650)
}

function detectScenario(text) {
  const lower = text.toLowerCase()
  if (lower.includes('sick') || lower.includes('performer') || lower.includes('angel') || lower.includes('absent') || lower.includes('mei chen') || lower.includes('who')) {
    return 'performer_illness'
  }
  if (lower.includes('venue') || lower.includes('studio') || lower.includes('room') || lower.includes('audio') || lower.includes('facility') || lower.includes('fault') || lower.includes('unavailability')) {
    return 'venue_fault'
  }
  return 'schedule_delay'
}

function generateAssistantResponse(scenarioKey) {
  const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  if (scenarioKey === 'performer_illness') {
    messages.value.push({
      id: Date.now() + 1,
      sender: 'assistant',
      timestamp: nowStr,
      scenario: 'performer_illness',
      title: 'Disruption Flagged',
      subtitle: 'Performer absence simulated for Angel Low across 2 scheduled activities (Soundcheck & Opening Act).',
      candidates: [
        {
          id: 'alicia',
          name: 'Alicia Ng',
          experience: 'Senior (Year 3 CCA Member)',
          isRecommended: true,
          badge: '#1 Recommended Option',
          downsides: 'Only available until 21:00 (has a late class debrief after).'
        },
        {
          id: 'marcus',
          name: 'Marcus Lim',
          experience: 'Junior (Year 1 CCA Member)',
          isRecommended: false,
          badge: 'Alternative Option',
          downsides: 'First time covering lead floor positioning; may require a quick 10-min briefing before stage entry.'
        }
      ],
      selectedCandidateId: 'alicia',
      canApply: true,
      hasApplied: false
    })
  } else if (scenarioKey === 'venue_fault') {
    messages.value.push({
      id: Date.now() + 1,
      sender: 'assistant',
      timestamp: nowStr,
      scenario: 'venue_fault',
      title: 'Facility Outage Detected',
      subtitle: 'Studio L7.2 (Dance) is currently unavailable due to an audio booth fault.',
      relocationOptions: [
        { id: 'stage_b1', label: 'Primary Option', venue: 'Li Ka Shing Stage B1', status: 'Fully available, zero booking conflicts' },
        { id: 'studio_l71', label: 'Secondary Option', venue: 'Studio L7.1 (Connexion)', status: 'Available' }
      ],
      selectedVenueId: 'stage_b1',
      timingAdjustment: 'Shift start time by +30 minutes to allow for equipment transfer without cutting rehearsal duration.',
      canApply: true,
      hasApplied: false
    })
  } else {
    messages.value.push({
      id: Date.now() + 1,
      sender: 'assistant',
      timestamp: nowStr,
      scenario: 'schedule_delay',
      title: 'Schedule Delay Detected',
      subtitle: 'Act 1 is running 30 minutes behind schedule.',
      shiftedActivities: [
        { name: 'Act 2 Audio & Lighting', original: '19:30', updated: '20:00' },
        { name: 'Opening Night Main Production', original: '20:15', updated: '20:45' },
        { name: 'ExCo Debrief & Clean-up', original: '22:00', updated: '22:30' }
      ],
      curfewCheck: 'All activities conclude by 22:30, safely before the 23:00 building lock.',
      showOpsLink: true,
      canApply: true,
      hasApplied: false
    })
  }
}

function selectVenue(msg, venueId) {
  if (msg.hasApplied) return
  msg.selectedVenueId = venueId
}

function selectCandidate(msg, candidateId) {
  if (msg.hasApplied) return
  msg.selectedCandidateId = candidateId
}

function applyContingency(msg) {
  msg.hasApplied = true
  emit('apply-plan')

  let chosenDetail = ''
  if (msg.relocationOptions) {
    const venue = msg.relocationOptions.find(v => v.id === msg.selectedVenueId)
    if (venue) chosenDetail = `\n• Relocation venue confirmed: ${venue.venue}`
  } else if (msg.candidates) {
    const cand = msg.candidates.find(c => c.id === msg.selectedCandidateId)
    if (cand) chosenDetail = `\n• Standby replacement assigned: ${cand.name}`
  }

  messages.value.push({
    id: Date.now() + 2,
    sender: 'assistant',
    text: `✅ Contingency Plan Applied!${chosenDetail}\n\nYour contingency plan is live. Click the button below to notify your affected members about the change.`,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    canNotify: true
  })
  scrollToBottom()
}

function dispatchTelegramMock(msg) {
  msg.hasTelegramDispatched = true
  messages.value.push({
    id: Date.now() + 3,
    sender: 'assistant',
    text: "📲 Members Notified!\nTelegram notifications sent to all affected team members with updated task timings.",
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    actions: null
  })
  scrollToBottom()
}

function goToDayOfOps() {
  router.push('/operations')
}

function handleReset() {
  emit('reset')
  messages.value = [
    {
      id: 1,
      sender: 'assistant',
      text: "Session reset. All hypothetical contingency previews cleared. How can I help you next?",
      timestamp: 'Just now',
      actions: null
    }
  ]
}
</script>

<template>
  <div class="pulse-chatbot-card p-3 p-lg-4 mb-4 shadow-sm border-0" style="border-radius: 1.25rem; background: #ffffff;">
    
    <!-- Chatbot Header -->
    <div class="d-flex flex-wrap align-items-center justify-content-between gap-3 pb-3 mb-3 border-bottom">
      <div class="d-flex align-items-center gap-3">
        <div class="pulse-bot-avatar-box d-flex align-items-center justify-content-center shadow-xs">
          <span style="font-size: 1.4rem;">🐱</span>
        </div>
        <div>
          <div class="d-flex align-items-center gap-2">
            <h5 class="fw-bold mb-0 text-dark" style="letter-spacing: -0.01em;">Pip • Pulse Contingency AI</h5>
            <span class="badge bg-success bg-opacity-10 text-success border border-success-subtle px-2 py-0.5 rounded-pill" style="font-size: 0.68rem; font-weight: 700;">
              Active Assistant
            </span>
          </div>
          <small class="text-muted d-block" style="font-size: 0.75rem;">
            Find your next best alternative in seconds!
          </small>
        </div>
      </div>

      <div class="d-flex align-items-center gap-2">
        <button 
          type="button" 
          class="btn btn-sm btn-outline-secondary rounded-pill px-3 py-1 fw-semibold"
          style="font-size: 0.75rem;"
          @click="handleReset"
        >
          ↻ Reset Chat
        </button>
        <button 
          type="button" 
          class="btn btn-sm btn-light border rounded-pill px-3 py-1 fw-semibold text-secondary d-none d-md-inline-flex"
          style="font-size: 0.75rem;"
          @click="emit('switch-to-matrix')"
          title="Switch to low-level raw matrix view for technical evaluation"
        >
          📊 Evaluator Matrix View
        </button>
      </div>
    </div>

    <!-- 1-Click Scenario Preset Chips -->
    <div class="mb-3">
      <span class="text-muted small fw-bold text-uppercase d-block mb-1.5" style="font-size: 0.68rem; letter-spacing: 0.05em;">
        Quick Scenario Presets (1-Click Evaluation):
      </span>
      <div class="d-flex flex-wrap gap-2">
        <button
          v-for="s in PRESET_SCENARIOS"
          :key="s.key"
          type="button"
          class="btn btn-sm pulse-scenario-chip text-start d-flex align-items-center gap-2 px-3 py-2 rounded-3 border"
          :class="selectedScenarioKey === s.key ? 'pulse-chip-active' : 'bg-light text-dark'"
          @click="handleSelectScenario(s)"
        >
          <span style="font-size: 1.05rem;">{{ s.icon }}</span>
          <div>
            <strong class="d-block text-dark" style="font-size: 0.78rem;">{{ s.title }}</strong>
            <small class="text-muted d-block" style="font-size: 0.68rem;">{{ s.summary }}</small>
          </div>
        </button>
      </div>
    </div>

    <!-- Chat Stream Scrollbox -->
    <div 
      ref="chatContainer"
      class="pulse-chat-stream p-3 rounded-4 mb-3"
      style="max-height: 540px; min-height: 280px; overflow-y: auto; background: #f8fafc; border: 1px solid #e2e8f0;"
    >
      <div v-for="m in messages" :key="m.id" class="mb-3">
        
        <!-- User Bubble -->
        <div v-if="m.sender === 'user'" class="d-flex justify-content-end">
          <div class="pulse-user-bubble px-3 py-2.5 rounded-4 shadow-2xs text-white" style="max-width: 82%; background: linear-gradient(135deg, var(--pulse-primary, #e11d48), #be123c); font-size: 0.85rem;">
            {{ m.text }}
            <div class="text-end text-white text-opacity-75 mt-1" style="font-size: 0.65rem;">{{ m.timestamp }}</div>
          </div>
        </div>

        <!-- Assistant Bubble -->
        <div v-else class="d-flex align-items-start gap-2.5">
          <div class="pulse-bot-mini-avatar flex-shrink-0 rounded-circle d-flex align-items-center justify-content-center bg-white border shadow-2xs" style="width: 32px; height: 32px;">
            <span style="font-size: 1rem;">🐱</span>
          </div>

          <div class="pulse-bot-bubble p-3 rounded-4 bg-white border shadow-xs text-dark flex-grow-1" style="max-width: 92%; font-size: 0.84rem; line-height: 1.5;">
            
            <!-- Standard Text Message -->
            <div v-if="m.text" style="white-space: pre-line;">{{ m.text }}</div>

            <!-- Structured Box Output: Alert Title Banner -->
            <div v-if="m.title" class="p-3 rounded-3 mb-3 border bg-light" style="border-left: 4px solid #e11d48 !important;">
              <div class="fw-bold text-dark d-flex align-items-center gap-2 mb-1" style="font-size: 0.9rem;">
                <span>⏱️</span>
                <span>{{ m.title }}</span>
              </div>
              <div class="text-secondary small">{{ m.subtitle }}</div>
            </div>

            <!-- SHOW DELAYS: Shifted Downstream Activities Box -->
            <div v-if="m.shiftedActivities" class="border rounded-3 p-3 mb-3 bg-white shadow-2xs">
              <div class="d-flex align-items-center gap-2 fw-bold text-dark mb-2.5 pb-2 border-bottom" style="font-size: 0.82rem;">
                <span>📋</span>
                <span>Shifted Downstream Activities</span>
              </div>

              <div class="d-flex flex-column gap-2">
                <div 
                  v-for="act in m.shiftedActivities" 
                  :key="act.name" 
                  class="d-flex flex-wrap align-items-center justify-content-between p-2 rounded-2 bg-light border-0"
                >
                  <span class="fw-semibold text-dark" style="font-size: 0.8rem;">{{ act.name }}</span>
                  <div class="d-flex align-items-center gap-2 font-monospace" style="font-size: 0.78rem;">
                    <span class="text-muted text-decoration-line-through">{{ act.original }}</span>
                    <span class="text-muted">→</span>
                    <span class="badge bg-danger text-white px-2 py-1 rounded-2">{{ act.updated }}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- SHOW DELAYS: Curfew Check Box -->
            <div v-if="m.curfewCheck" class="p-2.5 rounded-3 border bg-success-subtle border-success-subtle text-success-emphasis d-flex align-items-center gap-2 mb-2" style="font-size: 0.78rem;">
              <span>✅</span>
              <span><strong>Curfew Check:</strong> {{ m.curfewCheck }}</span>
            </div>

            <!-- FACILITY OUTAGE: Selectable Relocation Options Box -->
            <div v-if="m.relocationOptions" class="border rounded-3 p-3 mb-3 bg-white shadow-2xs">
              <div class="fw-bold text-dark mb-2 pb-2 border-bottom d-flex align-items-center justify-content-between" style="font-size: 0.82rem;">
                <div class="d-flex align-items-center gap-2">
                  <span>📍</span>
                  <span>Select Relocation Venue:</span>
                </div>
                <small class="text-muted font-normal" style="font-size: 0.7rem;">Click to select option</small>
              </div>

              <div 
                v-for="opt in m.relocationOptions" 
                :key="opt.id" 
                class="p-2.5 rounded-3 mb-2 border cursor-pointer venue-option-card transition-all"
                :class="m.selectedVenueId === opt.id ? 'border-primary bg-primary-subtle bg-opacity-25 shadow-2xs' : 'bg-light border-light-subtle'"
                style="cursor: pointer;"
                @click="selectVenue(m, opt.id)"
              >
                <div class="d-flex align-items-center justify-content-between mb-0.5">
                  <div class="d-flex align-items-center gap-2">
                    <input 
                      type="radio" 
                      :name="'venue-' + m.id" 
                      :checked="m.selectedVenueId === opt.id" 
                      class="form-check-input mt-0"
                      :disabled="m.hasApplied"
                    />
                    <strong class="text-dark" style="font-size: 0.82rem;">{{ opt.venue }}</strong>
                  </div>
                  <span class="badge" :class="m.selectedVenueId === opt.id ? 'bg-primary text-white' : 'bg-secondary-subtle text-secondary border'" style="font-size: 0.65rem;">
                    {{ opt.label }}
                  </span>
                </div>
                <div class="text-muted ps-4" style="font-size: 0.72rem;">{{ opt.status }}</div>
              </div>

              <div v-if="m.timingAdjustment" class="mt-2.5 pt-2 border-top text-muted" style="font-size: 0.75rem;">
                <strong>⏱️ Timing Adjustment:</strong> {{ m.timingAdjustment }}
              </div>
            </div>

            <!-- PERFORMER ABSENCE: Selectable Candidates Card Box -->
            <div v-if="m.candidates && m.candidates.length" class="mt-3">
              <div class="fw-bold text-dark mb-2" style="font-size: 0.82rem;">🔍 Select Standby Replacement:</div>
              <div 
                v-for="c in m.candidates" 
                :key="c.id" 
                class="p-3 rounded-3 mb-2 border cursor-pointer transition-all" 
                :class="m.selectedCandidateId === c.id ? 'border-success bg-success-subtle bg-opacity-25 shadow-2xs' : 'bg-white border-light-subtle'"
                style="cursor: pointer;"
                @click="selectCandidate(m, c.id)"
              >
                <div class="d-flex align-items-center justify-content-between mb-1">
                  <div class="d-flex align-items-center gap-2">
                    <input 
                      type="radio" 
                      :name="'cand-' + m.id" 
                      :checked="m.selectedCandidateId === c.id" 
                      class="form-check-input mt-0"
                      :disabled="m.hasApplied"
                    />
                    <strong class="text-dark" style="font-size: 0.88rem;">{{ c.name }}</strong>
                    <span class="badge" :class="c.isRecommended ? 'bg-success text-white' : 'bg-secondary text-white'" style="font-size: 0.65rem;">
                      {{ c.badge }}
                    </span>
                  </div>
                  <small class="text-muted fw-semibold" style="font-size: 0.72rem;">{{ c.experience }}</small>
                </div>
                
                <div class="mt-2 text-secondary ps-4" style="font-size: 0.76rem; line-height: 1.4;">
                  <strong class="text-danger-emphasis">⚠️ Potential Downside:</strong> {{ c.downsides }}
                </div>
              </div>
            </div>

            <!-- Action Controls inside Bubble (Fixed Top Padding & Margin for Button separation) -->
            <div v-if="m.canApply || m.canNotify || m.showOpsLink" class="d-flex flex-wrap align-items-center gap-2 mt-3 pt-3 border-top" style="margin-top: 1rem !important; padding-top: 0.85rem !important;">
              <button
                v-if="m.canApply && !m.hasApplied"
                type="button"
                class="btn btn-sm btn-pulse-primary text-white fw-bold px-3 py-2 rounded-pill shadow-xs d-flex align-items-center gap-1.5"
                style="font-size: 0.78rem;"
                @click="applyContingency(m)"
              >
                <span>⚡</span>
                <span>Apply Contingency Plan</span>
              </button>

              <button
                v-if="m.canNotify && !m.hasTelegramDispatched"
                type="button"
                class="btn btn-sm btn-danger text-white fw-bold px-3 py-2 rounded-pill shadow-xs d-flex align-items-center gap-1.5"
                style="font-size: 0.78rem;"
                @click="dispatchTelegramMock(m)"
              >
                <span>📲</span>
                <span>Notify Affected Members</span>
              </button>

              <button
                v-if="m.showOpsLink"
                type="button"
                class="btn btn-sm btn-outline-secondary fw-bold px-3 py-2 rounded-pill shadow-2xs d-flex align-items-center gap-1.5"
                style="font-size: 0.78rem;"
                @click="goToDayOfOps"
              >
                <span>📅</span>
                <span>View Updated Day-of Ops Calendar →</span>
              </button>

              <span v-if="m.hasApplied" class="badge bg-success-subtle text-success border border-success-subtle px-2.5 py-1.5 rounded-pill" style="font-size: 0.72rem;">
                ✓ Contingency Applied
              </span>
            </div>

            <div class="text-end text-muted mt-2" style="font-size: 0.65rem;">{{ m.timestamp }}</div>
          </div>
        </div>

      </div>

      <!-- Thinking Indicator -->
      <div v-if="isThinking" class="d-flex align-items-center gap-2 text-muted small ps-2 py-1">
        <span class="spinner-grow spinner-grow-sm text-danger" role="status" style="width: 10px; height: 10px;"></span>
        <span style="font-size: 0.75rem;">Pip is calculating options…</span>
      </div>
    </div>

    <!-- Chat Prompt Input Bar -->
    <form class="d-flex align-items-center gap-2" @submit.prevent="handleSendMessage()">
      <div class="input-group input-group-sm">
        <span class="input-group-text bg-white border-end-0 text-muted">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
        </span>
        <input 
          v-model="userInput"
          type="text"
          class="form-control border-start-0 py-2"
          placeholder="Ask Pip: e.g. 'What if audio booth loses power?' or 'Who can replace lead dancer?'…"
          style="font-size: 0.825rem;"
        />
      </div>

      <button 
        type="submit" 
        class="btn btn-pulse-primary text-white fw-bold px-3 py-2 rounded-3 flex-shrink-0 d-flex align-items-center gap-1 shadow-xs"
        style="font-size: 0.8rem;"
        :disabled="isThinking || !userInput.trim()"
      >
        <span>Send</span>
        <span>→</span>
      </button>
    </form>

  </div>
</template>

<style scoped>
.pulse-chatbot-card {
  box-shadow: 0 4px 20px rgba(15, 23, 42, 0.05);
}

.pulse-bot-avatar-box {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: linear-gradient(135deg, #ffe4e6, #fecdd3);
  border: 1px solid #fda4af;
}

.pulse-scenario-chip {
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  border-color: #e2e8f0 !important;
}

.pulse-scenario-chip:hover {
  transform: translateY(-1px);
  border-color: #fda4af !important;
  background: #fff1f2 !important;
}

.pulse-chip-active {
  background: #fff1f2 !important;
  border-color: #e11d48 !important;
}

.venue-option-card:hover {
  border-color: #cbd5e1 !important;
}

.pulse-chat-stream::-webkit-scrollbar {
  width: 6px;
}
.pulse-chat-stream::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 9999px;
}

@media (max-width: 576px) {
  .pulse-scenario-chip {
    width: 100%;
  }
  .pulse-user-bubble {
    max-width: 90% !important;
  }
  .pulse-bot-bubble {
    max-width: 95% !important;
  }
  .pulse-bot-avatar-box {
    width: 36px;
    height: 36px;
  }
}
</style>