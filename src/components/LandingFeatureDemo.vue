<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'

// Looping product preview for the landing page: each feature tab plays a short
// scripted sequence, then hands over to the next tab.

const STEP_MS = 1800
const HOLD_MS = 2800

// Single-path stroke icons (24x24), used in toasts
const ICONS = {
  release: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  swap: 'M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3',
  check: 'M20 6 9 17l-5-5',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  target: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  bolt: 'M13 2 3 14h9l-1 8 10-12h-9l1-8z',
  alert: 'M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
  bulb: 'M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z',
}

// --- Scene 1: Facility Exchange (cards mirror BookingSlotCard + TransferReviewCard) ---
// Badge classes and labels match BookingStatusBadge; stripes match .pulse-slot.is-*
const SLOT_VIEWS = {
  booked: { badge: 'pulse-badge-booked', label: 'Booked', holder: 'Eurhythmix', stripe: 'transparent' },
  proposed: { badge: 'pulse-badge-proposed', label: 'Available to Claim', note: '3 CCAs currently in the queue', holder: 'Eurhythmix', stripe: '#16a34a' },
  pending: { badge: 'pulse-badge-pending', label: 'Pending Admin Sign-off', holder: 'Eurhythmix', claiming: 'Samba Masala', stripe: '#0ea5e9' },
  confirmed: { badge: 'pulse-badge-confirmed', label: 'Officially Confirmed', holder: 'Samba Masala', from: 'Eurhythmix', stripe: '#16a34a' },
}

const SLOT_ACTIONS = {
  release: { label: 'Release', cls: 'btn-pulse-primary' },
  claim: { label: 'Claim', cls: 'btn-pulse-claim' },
}

// --- Scene 2: Availability heatmap (members free out of 12) ---
const HEAT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
const HEAT_HOURS = ['4pm', '5pm', '6pm', '7pm', '8pm', '9pm']
const HEAT_FINAL = [
  [4, 8, 4, 0, 4, 0],
  [0, 4, 8, 8, 4, 0],
  [8, 4, 0, 4, 8, 4],
  [4, 8, 12, 8, 4, 0],
  [8, 12, 12, 12, 8, 4],
]
const BEST_WINDOW = { day: 4, start: 1, span: 3 } // Fri 5–8pm

function heatLevel(count) {
  if (count >= 12) return 4
  if (count >= 8) return 3
  if (count >= 4) return 2
  return count > 0 ? 1 : 0
}

// --- Scene 3: What-If disruption simulator ---
const SEGMENTS = [
  { time: '6:00pm', activity: 'Tech rehearsal', detail: 'Studio 7.1 · Lighting: Angel Low' },
  { time: '7:00pm', activity: 'Act 1', detail: 'Li Ka Shing Hall · Lead: Angel Low' },
  { time: '8:00pm', activity: 'Act 2', detail: 'Li Ka Shing Hall · Lead: Mei Chen' },
]

const FEATURES = [
  {
    key: 'exchange',
    title: 'Facility Exchange',
    sub: 'Release, claim & OSL sign-off',
    tone: 'danger',
    steps: [
      { slot: 'booked', action: 'release' },
      { slot: 'proposed', action: 'claim', toast: { icon: 'release', text: 'Eurhythmix released Studio 7.1 · Sat 7–9pm' } },
      { slot: 'pending', review: 'open', toast: { icon: 'swap', text: 'Samba Masala claimed it · OSL has 48h to sign off' } },
      { slot: 'confirmed', review: 'approved', toast: { icon: 'check', text: 'OSL approved · liability transferred (Clause 9.1c)', tone: 'ok' } },
    ],
  },
  {
    key: 'heatmap',
    title: 'Availability Heatmap',
    sub: 'See when everyone is free',
    tone: 'success',
    steps: [
      { heat: 0.25, toast: { icon: 'users', text: 'Members mark when they are free' } },
      { heat: 0.6, toast: { icon: 'users', text: '9 of 12 members have responded' } },
      { heat: 1, best: true, toast: { icon: 'target', text: 'Best slot found · Fri 5–8pm, all 12 free', tone: 'ok' } },
    ],
  },
  {
    key: 'whatif',
    title: 'What-If Simulator',
    sub: 'Spot conflicts, get a recovery plan',
    tone: 'violet',
    steps: [
      { rows: ['ok', 'ok', 'ok'] },
      { rows: ['ok', 'ok', 'ok'], disruption: true, toast: { icon: 'bolt', text: 'What if Angel Low is unavailable 6–8pm?' } },
      { rows: ['conflict', 'conflict', 'ok'], disruption: true, toast: { icon: 'alert', text: 'Conflict detected · 2 activities affected', tone: 'alert' } },
      { rows: ['suggest', 'suggest', 'ok'], disruption: true, toast: { icon: 'bulb', text: 'Suggested: Mei Chen · exact role match, free 6–8pm' } },
      { rows: ['recovered', 'recovered', 'ok'], disruption: true, toast: { icon: 'check', text: 'Recovery plan ranked #1 · ready for ExCo approval', tone: 'ok' } },
    ],
  },
]

const ROW_BADGES = {
  conflict: 'Conflict',
  suggest: 'Swap in Mei Chen?',
  recovered: 'Recovered',
}

const activeIndex = ref(0)
const stepIndex = ref(0)
const isPaused = ref(false)
const reduceMotion = ref(false)
let timer = null

const feature = computed(() => FEATURES[activeIndex.value])
const step = computed(() => feature.value.steps[stepIndex.value])
const isLastStep = computed(() => stepIndex.value === feature.value.steps.length - 1)

const slotView = computed(() => SLOT_VIEWS[step.value.slot])
const slotAction = computed(() => SLOT_ACTIONS[step.value.action])

const heatCells = computed(() => {
  const ratio = step.value.heat ?? 0
  return HEAT_FINAL.map(row => row.map(count => Math.round((count * ratio) / 4) * 4))
})

function schedule() {
  clearTimeout(timer)
  if (isPaused.value || reduceMotion.value) return
  timer = setTimeout(advance, isLastStep.value ? HOLD_MS : STEP_MS)
}

function advance() {
  if (isLastStep.value) {
    activeIndex.value = (activeIndex.value + 1) % FEATURES.length
    stepIndex.value = 0
  } else {
    stepIndex.value++
  }
  schedule()
}

function selectFeature(i) {
  activeIndex.value = i
  // Reduced motion: jump straight to the end state instead of playing the sequence
  stepIndex.value = reduceMotion.value ? FEATURES[i].steps.length - 1 : 0
  schedule()
}

function setPaused(value) {
  isPaused.value = value
  schedule()
}

onMounted(() => {
  reduceMotion.value = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  if (reduceMotion.value) stepIndex.value = feature.value.steps.length - 1
  schedule()
})

onUnmounted(() => clearTimeout(timer))
</script>

<template>
  <div
    class="pulse-card liquid-glass-card p-3 border shadow-sm demo-box"
    @mouseenter="setPaused(true)"
    @mouseleave="setPaused(false)"
  >
    <!-- Header -->
    <div class="d-flex align-items-center justify-content-between mb-3 pb-2 border-bottom flex-wrap gap-2">
      <div class="d-flex align-items-center gap-2">
        <span class="demo-live-dot"></span>
        <span class="text-uppercase fw-bold text-dark" style="font-size: 0.72rem; letter-spacing: 0.05em;">
          See Pulse in action
        </span>
      </div>
      <span class="text-muted d-none d-md-inline" style="font-size: 0.68rem;">
        {{ isPaused ? 'Paused' : 'Hover to pause' }}
      </span>
    </div>

    <!-- Feature tabs (drive the preview below) -->
    <div class="demo-tabs mb-3" role="tablist">
      <button
        v-for="(f, i) in FEATURES"
        :key="f.key"
        type="button"
        role="tab"
        class="demo-tab"
        :class="[`tone-${f.tone}`, { active: i === activeIndex }]"
        :aria-selected="i === activeIndex"
        @click="selectFeature(i)"
      >
        <span class="d-block demo-tab-title">{{ f.title }}</span>
        <span class="d-none d-sm-block demo-tab-sub">{{ f.sub }}</span>
        <span
          v-if="i === activeIndex && !reduceMotion"
          :key="`${activeIndex}-${stepIndex}`"
          class="demo-tab-progress"
          :class="{ paused: isPaused }"
          :style="{ animationDuration: `${isLastStep ? HOLD_MS : STEP_MS}ms` }"
        ></span>
      </button>
    </div>

    <!-- Stage -->
    <div class="demo-stage">
      <Transition name="stage" mode="out-in">
        <!-- Scene 1: Facility Exchange (buttons are decorative; the demo plays itself) -->
        <div v-if="feature.key === 'exchange'" key="exchange" class="demo-exchange" aria-hidden="true">
          <div class="demo-slot-card" :class="`is-${step.slot}`" :style="{ '--stripe': slotView.stripe }">
            <div class="demo-slot-when">
              <div class="fw-semibold">Sat, 7 Nov</div>
              <div class="text-muted">7:00pm – 9:00pm</div>
              <div class="fw-semibold mt-1">Studio 7.1</div>
            </div>
            <div class="min-w-0">
              <Transition name="label" mode="out-in">
                <span :key="slotView.label" class="pulse-badge demo-badge" :class="slotView.badge">{{ slotView.label }}</span>
              </Transition>
              <div class="demo-slot-who">
                <div><span class="text-muted">Holder:</span> <strong>{{ slotView.holder }}</strong></div>
                <div v-if="slotView.claiming"><span class="text-muted">Claiming:</span> <strong>{{ slotView.claiming }}</strong></div>
                <div v-else-if="slotView.from"><span class="text-muted">From:</span> {{ slotView.from }}</div>
                <div v-else-if="slotView.note" class="text-muted">{{ slotView.note }}</div>
              </div>
            </div>
            <div class="demo-slot-action">
              <Transition name="label" mode="out-in">
                <span
                  v-if="slotAction"
                  :key="step.action"
                  class="btn btn-sm demo-press"
                  :class="slotAction.cls"
                  :style="{ animationDuration: `${STEP_MS}ms` }"
                >{{ slotAction.label }}</span>
                <span v-else-if="step.slot === 'pending'" key="locked" class="pulse-locked">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
                  Awaiting OSL
                </span>
              </Transition>
            </div>
          </div>

          <Transition name="stage" mode="out-in">
            <div v-if="step.review" key="review" class="demo-review-card">
              <div class="d-flex justify-content-between align-items-start gap-2 mb-2">
                <div>
                  <div class="demo-eyebrow">Transfer review · OSL</div>
                  <strong class="text-dark" style="font-size: 0.8rem;">Studio 7.1 · Sat 7–9pm</strong>
                </div>
                <Transition name="label" mode="out-in">
                  <span
                    :key="step.review"
                    class="pulse-badge demo-badge"
                    :class="step.review === 'approved' ? 'pulse-badge-confirmed' : 'pulse-badge-pending'"
                  >{{ step.review === 'approved' ? 'Approved' : '48h deadline' }}</span>
                </Transition>
              </div>
              <dl class="demo-review-grid">
                <dt>Releasing CCA</dt><dd>Eurhythmix</dd>
                <dt>Claiming CCA</dt><dd>Samba Masala</dd>
              </dl>
              <Transition name="label" mode="out-in">
                <div v-if="step.review === 'open'" key="open" class="d-flex gap-2">
                  <span class="btn btn-sm btn-pulse-primary demo-press" :style="{ animationDuration: `${STEP_MS}ms` }">Approve</span>
                  <span class="btn btn-sm btn-outline-secondary">Reject</span>
                </div>
                <div v-else key="done" class="demo-review-done">Signed off · audit voucher issued to both CCAs</div>
              </Transition>
            </div>
            <div v-else key="other" class="demo-slot-card is-dim">
              <div class="demo-slot-when">
                <div class="fw-semibold">Fri, 6 Nov</div>
                <div class="text-muted">6:00pm – 8:00pm</div>
                <div class="fw-semibold mt-1">Gym Studio</div>
              </div>
              <div class="min-w-0">
                <span class="pulse-badge demo-badge pulse-badge-booked">Booked</span>
                <div class="demo-slot-who">
                  <div><span class="text-muted">Holder:</span> <strong>Breakers</strong></div>
                </div>
              </div>
              <div class="demo-slot-action"></div>
            </div>
          </Transition>
        </div>

        <!-- Scene 2: Availability heatmap -->
        <div v-else-if="feature.key === 'heatmap'" key="heatmap" class="demo-heat">
          <div v-for="(h, hi) in HEAT_HOURS" :key="h" class="demo-axis" :style="{ gridColumn: hi + 2 }">{{ h }}</div>
          <div v-for="(d, di) in HEAT_DAYS" :key="d" class="demo-venue" :style="{ gridRow: di + 2 }">{{ d }}</div>

          <template v-for="(row, di) in heatCells" :key="di">
            <div
              v-for="(count, hi) in row"
              :key="`${di}-${hi}`"
              class="demo-heat-cell"
              :class="`heat-${heatLevel(count)}`"
              :style="{ gridRow: di + 2, gridColumn: hi + 2 }"
            >
              <span v-if="count >= 8">{{ count }}</span>
            </div>
          </template>

          <Transition name="label">
            <div
              v-if="step.best"
              class="demo-heat-best"
              :style="{ gridRow: BEST_WINDOW.day + 2, gridColumn: `${BEST_WINDOW.start + 2} / span ${BEST_WINDOW.span}` }"
            >All 12 free</div>
          </Transition>
        </div>

        <!-- Scene 3: What-If simulator -->
        <div v-else key="whatif" class="demo-whatif">
          <div class="demo-whatif-head">
            <span class="fw-bold text-dark">Eurhythmix Showcase · Sat</span>
            <Transition name="label" mode="out-in">
              <span v-if="step.disruption" key="on" class="demo-disruption-chip">Member unavailable: Angel Low</span>
              <span v-else key="off" class="text-muted">No disruptions</span>
            </Transition>
          </div>
          <div
            v-for="(seg, si) in SEGMENTS"
            :key="seg.activity"
            class="demo-seg"
            :class="`seg-${step.rows[si]}`"
          >
            <span class="demo-seg-time">{{ seg.time }}</span>
            <div class="min-w-0 flex-grow-1">
              <strong class="d-block text-dark" style="font-size: 0.76rem;">{{ seg.activity }}</strong>
              <small class="text-muted d-block text-truncate" style="font-size: 0.68rem;">{{ seg.detail }}</small>
            </div>
            <Transition name="label" mode="out-in">
              <span v-if="ROW_BADGES[step.rows[si]]" :key="step.rows[si]" class="demo-seg-badge">
                {{ ROW_BADGES[step.rows[si]] }}
              </span>
            </Transition>
          </div>
        </div>
      </Transition>

      <!-- Event toast -->
      <div class="demo-toast-slot">
        <Transition name="toast" mode="out-in">
          <div
            v-if="step.toast"
            :key="`${activeIndex}-${stepIndex}`"
            class="demo-toast"
            :class="step.toast.tone && `tone-${step.toast.tone}`"
          >
            <span class="demo-toast-icon">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                <path :d="ICONS[step.toast.icon]" />
              </svg>
            </span>
            <span>{{ step.toast.text }}</span>
          </div>
        </Transition>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ==========================================================================
   Container & Tabs
   ========================================================================== */
.demo-box {
  background: rgba(255, 255, 255, 0.9) !important;
  border-radius: 1.25rem !important;
}

.demo-live-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #22c55e;
  display: inline-block;
  animation: demo-live 2s infinite;
}

@keyframes demo-live {
  0% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.7); }
  70% { box-shadow: 0 0 0 6px rgba(34, 197, 94, 0); }
  100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
}

.demo-tabs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.demo-tab {
  --tone: #64748b;
  position: relative;
  overflow: hidden;
  border: 1px solid #e2e8f0;
  background: #fff;
  border-radius: 10px;
  padding: 8px 10px;
  color: #475569;
  text-align: left;
  transition: border-color 0.2s, color 0.2s, background 0.2s;
}

.demo-tab-title {
  font-size: 0.74rem;
  font-weight: 700;
  line-height: 1.25;
}

.demo-tab-sub {
  font-size: 0.64rem;
  font-weight: 500;
  color: #94a3b8;
  margin-top: 2px;
  line-height: 1.25;
}

.demo-tab.tone-danger { --tone: #e11d48; }
.demo-tab.tone-success { --tone: #16a34a; }
.demo-tab.tone-violet { --tone: #7c3aed; }

.demo-tab:hover { border-color: color-mix(in srgb, var(--tone) 40%, #e2e8f0); }

.demo-tab.active {
  border-color: var(--tone);
  color: var(--tone);
  background: color-mix(in srgb, var(--tone) 6%, #fff);
}

.demo-tab-progress {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 2px;
  width: 100%;
  background: var(--tone);
  transform-origin: left;
  animation: demo-progress linear forwards;
}

.demo-tab-progress.paused { animation-play-state: paused; }

@keyframes demo-progress {
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
}

/* ==========================================================================
   Stage & Shared Grid Pieces
   ========================================================================== */
.demo-stage {
  display: flex;
  flex-direction: column;
  min-height: 290px; /* tallest scene (exchange) + toast, so tabs don't change the box height */
}

.demo-axis {
  grid-row: 1;
  font-size: 0.64rem;
  font-weight: 600;
  color: #94a3b8;
  align-self: start;
}

.demo-venue {
  grid-column: 1;
  font-size: 0.68rem;
  font-weight: 600;
  color: #475569;
  align-self: center;
}

.min-w-0 { min-width: 0; }

/* ==========================================================================
   Scene 1: Facility Exchange (look follows .pulse-slot / TransferReviewCard)
   ========================================================================== */
.demo-exchange {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.demo-slot-card {
  --stripe: transparent;
  position: relative;
  display: grid;
  grid-template-columns: 100px 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 10px 12px 10px 16px;
  border: 1px solid #e7e5ec;
  border-radius: 12px;
  background: #fff;
  font-size: 0.72rem;
  overflow: hidden;
  transition: background 0.4s ease;
}

.demo-slot-card::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  background: var(--stripe);
  transition: background 0.4s ease;
}

.demo-slot-card.is-proposed { background: color-mix(in srgb, #dcfce7 45%, #fff); }
.demo-slot-card.is-dim { opacity: 0.55; }

.demo-badge { font-size: 0.64rem; white-space: nowrap; }

.demo-slot-who {
  margin-top: 4px;
  line-height: 1.45;
}

.demo-slot-action {
  display: flex;
  justify-content: flex-end;
}

.demo-slot-action .btn,
.demo-review-card .btn {
  font-size: 0.7rem;
  padding: 0.2rem 0.75rem;
  pointer-events: none;
}

/* Fake click: the button dips and rings shortly before the step changes */
.demo-press {
  animation: demo-press linear both;
}

@keyframes demo-press {
  0%, 55% { transform: scale(1); box-shadow: none; }
  62% { transform: scale(0.92); box-shadow: 0 0 0 4px rgba(225, 29, 72, 0.25); }
  72%, 100% { transform: scale(1); box-shadow: 0 0 0 8px rgba(225, 29, 72, 0); }
}

.demo-review-card {
  border: 1px solid #e7e5ec;
  border-radius: 12px;
  background: #fff;
  padding: 10px 12px;
  box-shadow: 0 8px 20px -10px rgba(15, 23, 42, 0.2);
}

.demo-eyebrow {
  font-size: 0.6rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #e11d48;
}

.demo-review-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 12px;
  margin: 0 0 8px;
  font-size: 0.7rem;
}

.demo-review-grid dt { font-weight: 500; color: #6b6475; }
.demo-review-grid dd { margin: 0; font-weight: 600; color: #1f1a24; }

.demo-review-done {
  font-size: 0.7rem;
  font-weight: 600;
  color: #166534;
  padding: 0.2rem 0;
}

@media (max-width: 575.98px) {
  .demo-slot-card { grid-template-columns: auto 1fr; }
  .demo-slot-action { grid-column: 1 / -1; justify-content: flex-start; }
  .demo-slot-action:empty { display: none; }
}

/* ==========================================================================
   Scene 2: Availability Heatmap
   Shades follow the Availability view: 0 / 4 / 8 / 12 of 12 free
   ========================================================================== */
.demo-heat {
  display: grid;
  grid-template-columns: 40px repeat(6, 1fr);
  grid-template-rows: 18px;
  grid-auto-rows: 38px;
  gap: 4px;
}

.demo-heat-cell {
  border-radius: 6px;
  border: 1px solid #e2e8f0;
  background: #fff;
  font-size: 0.62rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.6s ease, border-color 0.6s ease, color 0.6s ease;
}

.demo-heat-cell.heat-2 { background: #dcfce7; border-color: #dcfce7; color: #166534; }
.demo-heat-cell.heat-3 { background: #86efac; border-color: #86efac; color: #14532d; }
.demo-heat-cell.heat-4 { background: #15803d; border-color: #15803d; color: #fff; }

.demo-heat-best {
  z-index: 1;
  border-radius: 8px;
  border: 2px solid #0f172a;
  box-shadow: 0 6px 16px -6px rgba(15, 23, 42, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.64rem;
  font-weight: 700;
  color: #fff;
  background: #15803d;
}

/* ==========================================================================
   Scene 3: What-If Simulator
   ========================================================================== */
.demo-whatif {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.demo-whatif-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 0.7rem;
  min-height: 22px;
}

.demo-disruption-chip {
  font-size: 0.64rem;
  font-weight: 700;
  color: #6d28d9;
  background: #ede9fe;
  border: 1px dashed #a78bfa;
  border-radius: 999px;
  padding: 2px 8px;
  white-space: nowrap;
}

.demo-seg {
  --seg: #cbd5e1;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border: 1px solid #e2e8f0;
  border-left: 3px solid var(--seg);
  border-radius: 10px;
  background: #fff;
  transition: background 0.4s ease, border-color 0.4s ease;
}

.demo-seg-time {
  width: 46px;
  flex-shrink: 0;
  font-size: 0.66rem;
  font-weight: 700;
  color: #64748b;
}

.demo-seg-badge {
  flex-shrink: 0;
  font-size: 0.6rem;
  font-weight: 700;
  border-radius: 999px;
  padding: 2px 8px;
  color: var(--seg);
  background: color-mix(in srgb, var(--seg) 12%, #fff);
}

.demo-seg.seg-conflict {
  --seg: #dc2626;
  background: #fef2f2;
  border-color: #fecaca;
  animation: demo-shake 0.4s ease;
}

.demo-seg.seg-suggest {
  --seg: #7c3aed;
  background: #f5f3ff;
  border-color: #ddd6fe;
}

.demo-seg.seg-recovered {
  --seg: #16a34a;
  background: #f0fdf4;
  border-color: #bbf7d0;
}

.demo-seg.seg-conflict,
.demo-seg.seg-suggest,
.demo-seg.seg-recovered { border-left-color: var(--seg); }

@keyframes demo-shake {
  25% { transform: translateX(-3px); }
  75% { transform: translateX(3px); }
}

/* ==========================================================================
   Event Toast
   ========================================================================== */
/* In normal flow under the scene; min-height reserves the space so nothing jumps */
.demo-toast-slot {
  margin-top: auto;
  padding-top: 10px;
  min-height: 46px;
}

.demo-toast {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 10px;
  font-size: 0.72rem;
  font-weight: 600;
  color: #fff;
  background: #0f172a;
  box-shadow: 0 10px 24px -8px rgba(15, 23, 42, 0.45);
}

.demo-toast.tone-ok { background: #15803d; }
.demo-toast.tone-alert { background: #dc2626; }

.demo-toast-icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.18);
}

/* ==========================================================================
   Transitions
   ========================================================================== */
.stage-enter-active, .stage-leave-active { transition: opacity 0.25s ease, transform 0.25s ease; }
.stage-enter-from { opacity: 0; transform: translateY(6px); }
.stage-leave-to { opacity: 0; transform: translateY(-6px); }

.label-enter-active, .label-leave-active { transition: opacity 0.2s ease, transform 0.2s ease; }
.label-enter-from { opacity: 0; transform: translateY(4px); }
.label-leave-to { opacity: 0; transform: translateY(-4px); }

.toast-enter-active { transition: opacity 0.3s ease, transform 0.35s cubic-bezier(0.16, 1, 0.3, 1); }
.toast-leave-active { transition: opacity 0.15s ease; }
.toast-enter-from { opacity: 0; transform: translateY(10px) scale(0.97); }
.toast-leave-to { opacity: 0; }

@media (prefers-reduced-motion: reduce) {
  .demo-live-dot,
  .demo-press,
  .demo-seg { animation: none !important; }
}
</style>
