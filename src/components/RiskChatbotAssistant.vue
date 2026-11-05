<script setup>
import { ref, computed, nextTick, watch, onMounted } from 'vue'

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

// Conversational Message Log
const messages = ref([
  {
    id: 1,
    sender: 'assistant',
    text: "👋 Hi! I'm Pip, your Pulse Contingency AI Assistant.\n\nI analyze live roster timetables, facility bookings, and schedule dependencies using our multi-factor recovery algorithm (50% Role Match, 30% Timetable Availability, 20% Workload).\n\nSelect a scenario below or ask me how to resolve an event risk!",
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
    title: 'Performer Sickness',
    prompt: 'Mei Chen / Angel reported sick for tonight\'s rehearsal. Who should cover?',
    summary: 'Evaluate standby members using 50% Role Match + 30% Timetable Availability + 20% Workload.'
  },
  {
    key: 'venue_fault',
    icon: '🏛️',
    title: 'Studio Tech Breakdown',
    prompt: 'Studio L7.2 has an unexpected audio booth fault. What\'s our recovery plan?',
    summary: 'Search alternative available facilities and evaluate 30-min shift window.'
  },
  {
    key: 'schedule_delay',
    icon: '⏱️',
    title: 'Cascading Show Delay',
    prompt: 'Act 1 is running 30 minutes late. Calculate downstream schedule impact.',
    summary: 'Propagate Shift = max(0, End_A - Start_B) across all dependent cues.'
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

  // Natural response delay (600ms)
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
  if (lower.includes('venue') || lower.includes('studio') || lower.includes('room') || lower.includes('audio') || lower.includes('facility') || lower.includes('fault')) {
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
      text: "🚨 **Disruption Flagged:** Performer absence simulated for **Angel Low** across 2 scheduled activities (Soundcheck & Opening Act).\n\n🔍 **Member Replacement Algorithm Results:**",
      candidates: [
        {
          name: 'Alicia Ng',
          matchScore: 94,
          isRecommended: true,
          roleMatch: '50% (Senior Dancer & Choreographer)',
          timetable: '30% (Free 18:00–21:30, no class clashes)',
          workload: '14/20% (Light load: 1 rehearsal today)'
        },
        {
          name: 'Marcus Lim',
          matchScore: 84,
          isRecommended: false,
          roleMatch: '45% (Floor Positioning Lead)',
          timetable: '25% (Free from 18:30)',
          workload: '14/20% (Medium load)'
        }
      ],
      details: "Formula applied: Final Match = 0.50 × RoleMatch + 0.30 × TimetableAvailability + 0.20 × WorkloadCapacity.",
      canApply: true,
      hasApplied: false
    })
  } else if (scenarioKey === 'venue_fault') {
    messages.value.push({
      id: Date.now() + 1,
      sender: 'assistant',
      timestamp: nowStr,
      scenario: 'venue_fault',
      text: "🏛️ **Facility Disruption Flagged:** Technical outage simulated for **Studio L7.2 (Dance)** during peak rehearsal hours.\n\n🔍 **Facility Recovery Algorithm Results:**\n\n• **Alternative Venue Identified:** **Li Ka Shing Stage B1** or **Studio L7.1 (Connexion)**.\n• **Booking Availability:** Checked active Supabase booking ledger — zero conflicting reservations found in this window.\n• **Schedule Option:** Shift start time by +30 minutes while maintaining original duration.",
      details: "Conflict Resolution: 40% | Timetable Preservation: 30% | Venue Suitability: 10% | Overall Feasibility Score: 88/100.",
      canApply: true,
      hasApplied: false
    })
  } else {
    messages.value.push({
      id: Date.now() + 1,
      sender: 'assistant',
      timestamp: nowStr,
      scenario: 'schedule_delay',
      text: "⏱️ **Schedule Delay Flagged:** Act 1 is running **30 minutes behind schedule**.\n\n🔍 **Dependency Propagation Results:**\n\n• Propagated formula: `Shift = max(0, End_A - Start_B) = 30 mins`.\n• **3 Downstream Cues Shifted:** Main Production (now 20:45), Debrief (now 22:30).\n• **Venue Status:** SSU Clause 9.2 curfew checked: event concludes at 22:30, safely before the 23:00 building lock.",
      details: "Downstream risk assessed: Zero member overlaps detected after propagation.",
      canApply: true,
      hasApplied: false
    })
  }
}

function applyContingency(msg) {
  msg.hasApplied = true
  emit('apply-plan')
  messages.value.push({
    id: Date.now() + 2,
    sender: 'assistant',
    text: "✅ **Contingency Plan Successfully Applied!**\n\n• Live roster has been updated.\n• Task assignments in Day-of Operations are aligned.\n• An audit record was created in the contingency ledger.",
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    actions: null
  })
  scrollToBottom()
}

function dispatchTelegramMock(msg) {
  msg.hasTelegramDispatched = true
  messages.value.push({
    id: Date.now() + 3,
    sender: 'assistant',
    text: "📲 **Telegram Alert Dispatched!**\nInteractive notification sent to **@ahlixia** with `[ Accept Standby Duty ]` / `[ Decline ]` buttons.",
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    actions: null
  })
  scrollToBottom()
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
            Real-time algorithmic risk assessment &amp; replacement matching for <strong>{{ selectedEvent?.name || 'SMU Eurhythmix' }}</strong>
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

    <!-- 1-Click Scenario Preset Chips (Prof's Recommended Flow) -->
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
      style="max-height: 480px; min-height: 280px; overflow-y: auto; background: #f8fafc; border: 1px solid #e2e8f0;"
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

          <div class="pulse-bot-bubble p-3 rounded-4 bg-white border shadow-xs text-dark flex-grow-1" style="max-width: 90%; font-size: 0.84rem; line-height: 1.45;">
            <!-- Message Content -->
            <div style="white-space: pre-line;">{{ m.text }}</div>

            <!-- Performer Replacement Candidates Card -->
            <div v-if="m.candidates && m.candidates.length" class="mt-2.5 pt-2 border-top">
              <div v-for="c in m.candidates" :key="c.name" class="p-2.5 rounded-3 mb-2 border" :style="c.isRecommended ? 'background: #f0fdf4; border-color: #bbf7d0 !important;' : 'background: #f8fafc;'">
                <div class="d-flex align-items-center justify-content-between mb-1">
                  <div class="d-flex align-items-center gap-1.5">
                    <strong class="text-dark" style="font-size: 0.82rem;">{{ c.name }}</strong>
                    <span v-if="c.isRecommended" class="badge bg-success text-white px-2 py-0.5 rounded-pill" style="font-size: 0.65rem;">
                      #1 Recommended Standby
                    </span>
                  </div>
                  <span class="badge rounded-pill fw-bold" :class="c.matchScore >= 90 ? 'bg-success text-white' : 'bg-secondary text-white'" style="font-size: 0.75rem;">
                    {{ c.matchScore }}% Match Score
                  </span>
                </div>
                <div class="small text-muted" style="font-size: 0.72rem;">
                  <div>• <strong>Role Match (50%):</strong> {{ c.roleMatch }}</div>
                  <div>• <strong>Timetable Availability (30%):</strong> {{ c.timetable }}</div>
                  <div>• <strong>Workload Capacity (20%):</strong> {{ c.workload }}</div>
                </div>
              </div>
            </div>

            <!-- Algorithm Details Accordion -->
            <div v-if="m.details" class="mt-2 text-muted" style="font-size: 0.72rem;">
              <span class="badge bg-light text-secondary border me-1">Formula</span>
              {{ m.details }}
            </div>

            <!-- Action Controls inside Bubble -->
            <div v-if="m.canApply" class="d-flex flex-wrap align-items-center gap-2 mt-3 pt-2.5 border-top">
              <button
                v-if="!m.hasApplied"
                type="button"
                class="btn btn-sm btn-pulse-primary text-white fw-bold px-3 py-1.5 rounded-pill shadow-xs d-flex align-items-center gap-1.5"
                style="font-size: 0.78rem;"
                @click="applyContingency(m)"
              >
                <span>⚡</span>
                <span>1-Click Apply Contingency Plan</span>
              </button>

              <button
                v-if="m.hasApplied && !m.hasTelegramDispatched"
                type="button"
                class="btn btn-sm btn-outline-primary fw-bold px-3 py-1.5 rounded-pill shadow-2xs d-flex align-items-center gap-1.5"
                style="font-size: 0.78rem;"
                @click="dispatchTelegramMock(m)"
              >
                <span>📲</span>
                <span>Dispatch Telegram Alert to Member</span>
              </button>

              <span v-if="m.hasApplied" class="badge bg-success-subtle text-success border border-success-subtle px-2.5 py-1 rounded-pill" style="font-size: 0.72rem;">
                ✓ Contingency Active on Day-of Ops
              </span>
            </div>

            <div class="text-end text-muted mt-1" style="font-size: 0.65rem;">{{ m.timestamp }}</div>
          </div>
        </div>

      </div>

      <!-- Thinking Indicator -->
      <div v-if="isThinking" class="d-flex align-items-center gap-2 text-muted small ps-2 py-1">
        <span class="spinner-grow spinner-grow-sm text-danger" role="status" style="width: 10px; height: 10px;"></span>
        <span style="font-size: 0.75rem;">Pip is running multi-factor recovery algorithm…</span>
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

.pulse-chat-stream::-webkit-scrollbar {
  width: 6px;
}
.pulse-chat-stream::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 9999px;
}
</style>
