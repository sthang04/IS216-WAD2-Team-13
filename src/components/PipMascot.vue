<script setup>

import { computed, ref, onMounted, onUnmounted } from 'vue'
import { formatCountdown } from '../services/waitlistService'

// 1. RECEIVE DATA FROM DIFFERENT FEATURES
// Both features use the SAME PipMascot.vue component.
// If no mode is specified, use notifications.

const props = defineProps({

  mode: {
    type: String,
    default: 'notifications'
  },

  result: {
    type: Object,
    default: null
  },

  unansweredCount: {
    type: Number,
    default: 0
  },

  // Seconds left on the most urgent waitlist offer (null = no offer waiting).
  offerSecondsLeft: {
    type: Number,
    default: null
  },

  // Chosen from Pip's right-click menu: stop jumping but keep talking.
  isStatic: {
    type: Boolean,
    default: false
  }

})

const emit = defineEmits(['update:isStatic', 'open-notifications', 'open-offer'])

// Show or hide Pip's danger summary.

const panelOpen = ref(false)

// Right-click menu position.
const menu = ref(null)

// 2. CALCULATE THE DANGER SCORE

// Use actual simulation results instead of just counting how many disruptions were added.

const conflicts = computed(() =>
  props.result?.conflictCounts?.total ??
  props.result?.newConflicts?.length ?? 0
)

const affected = computed(() =>
  props.result?.directImpacts?.length ?? 0
)

const downstream = computed(() =>
  props.result?.downstreamRisks?.length ?? 0
)

const bookings = computed(() =>
  props.result?.affectedBookings?.length ?? 0
)

// Scoring formula for the demo.

const dangerScore = computed(() =>
  conflicts.value * 2 +
  affected.value +
  downstream.value
)

// 3. DETERMINE PIP'S MOOD

const hasOffer = computed(() => props.offerSecondsLeft !== null)

const mood = computed(() => {

  // For notification feature
  if (props.mode === 'notifications') {
    // A waitlist slot waiting to be claimed matters more than unread messages.
    if (hasOffer.value && props.offerSecondsLeft <= 300) return 'panic'
    if (hasOffer.value) return 'stressed'
    if (props.unansweredCount > 0) return 'grumpy'
    return 'calm'
  }

  // For What-If Simulator

  if (!props.result) return 'idle'
  if (dangerScore.value === 0) return 'calm'
  if (dangerScore.value <= 3) return 'watch'
  if (dangerScore.value <= 7) return 'risk'
  return 'critical'

})

// Pip jumps while there is something to look at, unless told to keep still.
const jumping = computed(() =>
  !props.isStatic &&
  props.mode === 'notifications' &&
  (props.unansweredCount > 0 || hasOffer.value)
)

// Convert Pip's current mood into a readable status label.
const moodLabel = computed(() => {
  const labels = {
    idle: 'Ready',
    calm: 'Stable',
    watch: 'Watch',
    risk: 'At Risk',
    critical: 'Critical',
    grumpy: 'Unread',
    stressed: 'Offer Waiting',
    panic: 'Hurry!'
  }

  return labels[mood.value]
})

// 4. CHANGE PIP'S COLOUR

const colours = computed(() => {

  const palettes = {
    idle: ['#ff6b7d', '#e11d48'],
    calm: ['#ff6b7d', '#e11d48'],
    watch: ['#ffd65c', '#ff9633'],
    risk: ['#ffad55', '#ff563f'],
    critical: ['#ff5668', '#ca093d'],
    grumpy: ['#ffb259', '#f97316'],
    stressed: ['#ff5668', '#ca093d'],
    panic: ['#ff5668', '#ca093d']
  }

  return palettes[mood.value]

})

// 5. PIP'S SPEECH BUBBLE

const message = computed(() => {

  // NOTIFICATION FEATURE
  if (props.mode === 'notifications') {
    if (mood.value === 'panic') {
      return `Eek! Only ${formatCountdown(props.offerSecondsLeft)} left to claim your waitlist slot! 💦`
    }
    if (mood.value === 'stressed') {
      return `Meow… a waitlist slot is waiting for you! ${formatCountdown(props.offerSecondsLeft)} left.`
    }

    const count = props.unansweredCount
    if (count === 0) {
      return "Yay! You're all caught up! ✨"
    }
    if (count === 1) {
      return 'You have 1 new notification.'
    }

    return `You have ${count} new notifications.`
  }

  // WHAT-IF SIMULATOR

  const messages = {
    idle: 'Ready to simulate! ✨',
    calm: 'All systems stable!',
    watch: 'Something needs attention.',
    risk: 'This may affect event readiness.',
    critical: 'Critical conflicts detected! 🚨'
  }

  return messages[mood.value]

})

const suggestion = computed(() => {

  // NOTIFICATION FEATURE
  if (props.mode === 'notifications') {
    if (hasOffer.value) {
      return 'Accept the offer on the Waitlist page before the timer runs out, or it passes to the next CCA.'
    }
    return props.unansweredCount === 0
      ? 'You have no unread notifications.'
      : 'Open the bell to read your latest notifications.'
  }

  // SIMULATOR FEATURE
  if (!props.result) {
    return 'Run a simulation to check event risks.'
  }
  if (mood.value === 'calm') {
    return 'No issues detected by the current rules.'
  }
  if (mood.value === 'watch') {
    return 'Review the affected event activities.'
  }
  if (mood.value === 'risk') {
    return 'Review conflicts and explore alternatives.'
  }

  return 'Prioritise critical conflicts and test a recovery strategy.'

})

// 6. RIGHT-CLICK MENU

function openMenu(event) {
  panelOpen.value = false
  menu.value = { x: event.clientX, y: event.clientY }
}

function chooseStatic(value) {
  emit('update:isStatic', value)
  menu.value = null
}

function closeMenu() {
  menu.value = null
}

function onKey(event) {
  if (event.key === 'Escape') {
    menu.value = null
    panelOpen.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', closeMenu)
  document.addEventListener('keydown', onKey)
})

onUnmounted(() => {
  document.removeEventListener('click', closeMenu)
  document.removeEventListener('keydown', onKey)
})

</script>

<template>

  <div class="pip-container" :class="[mood, { jumping, still: isStatic }]">

    <!-- SPEECH BUBBLE -->
    <Transition name="pip-fade">
      <div v-if="!panelOpen" class="pip-speech" role="status">
        {{ message }}
      </div>
    </Transition>

    <!-- DANGER SUMMARY PANEL -->
    <Transition name="pip-fade">
      <div v-if="panelOpen" id="pip-summary" class="pip-panel">
        <div class="pip-panel-heading">
          <strong>🐱 Pip — Pulse Assistant</strong>
          <button
            type="button"
            class="pip-close"
            aria-label="Close Pip summary"
            @click="panelOpen = false"
          >
            ×
          </button>
        </div>

        <!-- Show the correct status label -->
        <div class="pip-status">
          <span>
            {{ mode === 'notifications'
              ? 'Notification Status'
              : 'Danger Level' }}
          </span>
          <strong>{{ moodLabel }}</strong>
        </div>

        <!-- NOTIFICATIONS -->
        <template v-if="mode === 'notifications'">
          <div class="pip-stats">
            <div>
              <strong>{{ unansweredCount }}</strong>
              <small>Unread</small>
            </div>
            <div>
              <strong>{{ hasOffer ? formatCountdown(offerSecondsLeft) : '—' }}</strong>
              <small>Offer Time Left</small>
            </div>
          </div>
          <div class="pip-actions">
            <button type="button" class="pip-action" @click="panelOpen = false; emit('open-notifications')">
              Open notifications
            </button>
            <button v-if="hasOffer" type="button" class="pip-action pip-action-hot" @click="panelOpen = false; emit('open-offer')">
              Claim slot
            </button>
          </div>
        </template>

        <!-- SIMULATOR -->
        <template v-else-if="result">
          <div class="pip-stats">
            <div>
              <strong>{{ conflicts }}</strong>
              <small>Conflicts</small>
            </div>
            <div>
              <strong>{{ affected }}</strong>
              <small>Affected Segments</small>
            </div>
            <div>
              <strong>{{ downstream }}</strong>
              <small>Downstream Risks</small>
            </div>
            <div>
              <strong>{{ bookings }}</strong>
              <small>Bookings to Review</small>
            </div>
          </div>
        </template>
        <p class="pip-advice">
          💡 {{ suggestion }}
        </p>
        <small class="pip-note">
          {{ mode === 'notifications'
            ? 'Right-click Pip to keep it still.'
            : 'Hypothetical simulation status only.' }}
        </small>
      </div>
    </Transition>

    <!-- CAT BUTTON -->

    <button
      type="button"
      class="pip-button"
      :aria-label="'Pip assistant. ' + moodLabel + '. ' + message"
      :aria-expanded="panelOpen"
      aria-controls="pip-summary"
      @click="panelOpen = !panelOpen"
      @contextmenu.prevent.stop="openMenu"
    >

      <!--
        Cat created directly with SVG.
        No external image file required.
        The silhouette stays the same.
        Only colours and expressions change.
      -->

      <svg
        class="pip-cat"
        viewBox="0 0 120 120"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >

        <defs>
          <linearGradient
            id="pipBody"
            x1="0%"
            y1="0%"
            x2="80%"
            y2="100%"
          >
            <stop
              offset="0%"
              :stop-color="colours[0]"
            />
            <stop
              offset="100%"
              :stop-color="colours[1]"
            />
          </linearGradient>
        </defs>

        <!-- CAT HEAD + EARS -->
        <path
          d="
            M18 47
            L18 17
            Q18 10 25 16
            L43 32
            Q60 27 77 32
            L95 16
            Q102 10 102 18
            L102 47
            L102 78
            Q102 105 76 105
            L44 105
            Q18 105 18 78
            Z
          "
          fill="url(#pipBody)"
          stroke="white"
          stroke-width="4"
          stroke-linejoin="round"
        />

        <!-- LEFT EYE (half-closed when grumpy) -->
        <ellipse
          cx="46"
          :cy="mood === 'grumpy' ? 63 : 62"
          rx="4"
          :ry="mood === 'grumpy' ? 3.5 : 5.5"
          fill="white"
        />

        <!-- RIGHT EYE -->
        <ellipse
          cx="74"
          :cy="mood === 'grumpy' ? 63 : 62"
          rx="4"
          :ry="mood === 'grumpy' ? 3.5 : 5.5"
          fill="white"
        />

        <!-- CALM / IDLE FACE -->
        <ellipse
          v-if="mood === 'idle' || mood === 'calm'"
          cx="60"
          cy="82"
          rx="4"
          ry="2.8"
          fill="white"
        />

        <!-- WATCH FACE -->
        <g
          v-else-if="mood === 'watch'"
          stroke="white"
          stroke-width="3"
          stroke-linecap="round"
          fill="none"
        >
          <path d="M39 49 L48 53" />
          <path d="M72 53 L81 49" />
          <path d="M55 81 Q60 77 65 81" />
        </g>

        <!-- DISGRUNTLED FACE (unread notifications): half-closed eyes, flat mouth -->
        <g
          v-else-if="mood === 'grumpy'"
          stroke="white"
          stroke-width="3"
          stroke-linecap="round"
          fill="none"
        >
          <path d="M40 56 L51 57.5" />
          <path d="M69 57.5 L80 56" />
          <path d="M55 82 L65 81" />
        </g>

        <!-- WORRIED FACE (also used while a waitlist offer is pending) -->
        <g
          v-else-if="mood === 'risk' || mood === 'stressed' || mood === 'panic'"
          stroke="white"
          stroke-width="3"
          stroke-linecap="round"
          fill="none"
        >
          <path d="M38 51 L48 46" />
          <path d="M72 46 L82 51" />
          <path d="M55 83 Q60 75 65 83" />
        </g>

        <!-- CRITICAL / SHOCKED FACE -->
        <g v-else>
          <path
            d="M38 49 L47 44 M73 44 L82 49"
            stroke="white"
            stroke-width="3"
            stroke-linecap="round"
          />
          <ellipse
            cx="60"
            cy="82"
            rx="5.5"
            ry="8"
            fill="white"
          />
        </g>

        <!-- SWEAT DROPS (waitlist offer pending; faster under 5 minutes) -->
        <g v-if="mood === 'stressed' || mood === 'panic'" class="pip-sweat">
          <path
            class="pip-drop"
            d="M100 40 Q106 50 100 54 Q94 50 100 40 Z"
            fill="#7cc8ff"
            stroke="white"
            stroke-width="1.5"
          />
          <path
            class="pip-drop pip-drop-late"
            d="M22 48 Q27 56 22 59 Q17 56 22 48 Z"
            fill="#7cc8ff"
            stroke="white"
            stroke-width="1.5"
          />
        </g>
      </svg>

      <!-- Small warning indicator -->
      <span
        v-if="mood === 'critical' || mood === 'panic'"
        class="pip-warning"
      >
        !
      </span>

      <!-- Notification count badge -->
      <span
        v-else-if="mode === 'notifications' && unansweredCount > 0"
        class="pip-badge"
      >
        {{ unansweredCount > 99 ? '99+' : unansweredCount }}
      </span>
    </button>

    <!-- RIGHT-CLICK MENU -->
    <div
      v-if="menu"
      class="pip-menu"
      role="menu"
      :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
      @click.stop
    >
      <button
        type="button"
        role="menuitemradio"
        :aria-checked="!isStatic"
        @click="chooseStatic(false)"
      >
        <span class="pip-check">{{ isStatic ? '' : '✓' }}</span> Let Pip jump around
      </button>
      <button
        type="button"
        role="menuitemradio"
        :aria-checked="isStatic"
        @click="chooseStatic(true)"
      >
        <span class="pip-check">{{ isStatic ? '✓' : '' }}</span> Keep Pip still
      </button>
    </div>
  </div>
</template>
<style scoped>

/*
  FIX PIP AT THE BOTTOM-RIGHT
*/
.pip-container {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 1040;
  font-family: Inter, Arial, sans-serif;
}

/*
  CAT APPEARANCE
*/

.pip-button {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 94px;
  height: 94px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  animation: pipFloat 3s ease-in-out infinite;
}

.pip-cat {
  width: 90px;
  height: 90px;
  overflow: visible;
  filter: drop-shadow(
    0 8px 12px rgba(220, 35, 90, 0.20)
  );

  transition:
    filter 0.3s ease,
    transform 0.3s ease;
}

.pip-button:hover .pip-cat {
  transform: scale(1.08);
}

.pip-button:focus-visible {
  outline: 3px solid #ec4899;
  outline-offset: 2px;
  border-radius: 24px;
}

/*
  MOOD EFFECTS
*/

.watch .pip-cat {
  filter: drop-shadow(
    0 0 13px rgba(255, 190, 0, 0.55)
  );
}
.risk .pip-cat,
.grumpy .pip-cat {
  filter: drop-shadow(
    0 0 15px rgba(255, 125, 20, 0.65)
  );
}
.critical .pip-cat,
.stressed .pip-cat,
.panic .pip-cat {
  filter: drop-shadow(
    0 0 19px rgba(255, 40, 75, 0.8)
  );
}
.critical .pip-button {
  animation: pipShake 0.5s ease-in-out infinite alternate;
}

/* Jumping when there is something new */
.jumping .pip-button {
  animation: pipJump 1.1s ease-in-out infinite;
}

/* Stressed by a pending offer: shaking replaces the jump, faster near the deadline */
.stressed .pip-button {
  animation: pipTremble 0.3s linear infinite;
}
.panic .pip-button {
  animation: pipTremble 0.14s linear infinite;
}
.panic .pip-drop {
  animation-duration: 0.8s;
}

/* Kept still from the right-click menu */
.still .pip-button,
.still .pip-cat {
  animation: none;
}

.pip-drop {
  animation: pipDrip 1.4s ease-in infinite;
}
.pip-drop-late {
  animation-delay: 0.7s;
}

/*
  SPEECH BUBBLE
*/

.pip-speech {
  position: absolute;
  right: 85px;
  bottom: 63px;
  width: max-content;
  max-width: min(240px, calc(100vw - 130px));
  background: white;
  border: 1px solid #ffd0df;
  border-radius: 17px;
  box-shadow: 0 6px 25px rgba(0,0,0,0.10);
  padding: 12px 15px;
  color: #394056;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.4;
}

.panic .pip-speech {
  border-color: #ff9fb0;
  color: #b4123a;
}

/*
  SUMMARY PANEL
 */

.pip-panel {
  position: absolute;
  bottom: 105px;
  right: 0;
  width: min(310px, calc(100vw - 32px));
  box-sizing: border-box;
  padding: 18px;
  background: #fff;
  border: 1px solid #ffd0df;
  border-radius: 20px;
  box-shadow: 0 12px 38px rgba(0,0,0,0.13);
}

.pip-panel-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
  color: #30364d;
  font-size: 14px;
}

.pip-close {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: #7e8798;
}

.pip-status {
  display: flex;
  justify-content: space-between;
  padding: 12px;
  border-radius: 12px;
  background: #fff1f5;
  color: #30364d;
  font-size: 13px;
  margin-bottom: 14px;
}

.pip-status strong {
  color: #e91d55;
}

.pip-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.pip-stats div {
  background: #f8f9fc;
  border-radius: 10px;
  padding: 12px;
  text-align: center;
}

.pip-stats strong {
  display: block;
  color: #ed2558;
  font-size: 21px;
}

.pip-stats small {
  display: block;
  color: #77839a;
  font-size: 10px;
  margin-top: 4px;
}

.pip-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.pip-action {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid #ffd0df;
  border-radius: 10px;
  background: #fff;
  color: #ed2558;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.pip-action:hover {
  background: #fff1f5;
}

.pip-action-hot {
  background: #ed2558;
  border-color: #ed2558;
  color: #fff;
}

.pip-action-hot:hover {
  background: #ca093d;
}

.pip-advice {
  background: #fff5f8;
  border-radius: 12px;
  padding: 12px;
  font-size: 12px;
  line-height: 1.5;
  margin-top: 14px;
  margin-bottom: 10px;
  color: #49536b;
}

.pip-note {
  color: #8991a3;
  font-size: 10px;
}

/*
  RIGHT-CLICK MENU
*/

.pip-menu {
  position: fixed;
  transform: translate(-100%, -100%);
  min-width: 190px;
  padding: 6px;
  background: #fff;
  border: 1px solid #ffd0df;
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.15);
}

.pip-menu button {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: none;
  color: #30364d;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.pip-menu button:hover {
  background: #fff1f5;
}

.pip-check {
  display: inline-block;
  width: 14px;
  color: #ed2558;
  font-weight: 700;
}

/*
  CRITICAL ALERT ICON + COUNT BADGE
*/

.pip-warning,
.pip-badge {
  position: absolute;
  top: 4px;
  right: 4px;
  background: #e11d48;
  color: white;
  min-width: 23px;
  height: 23px;
  border: 2px solid white;
  border-radius: 999px;
  font-size: 13px;
  font-weight: bold;
  display: flex;
  align-items: center;
  justify-content: center;
}

.pip-badge {
  padding: 0 5px;
  font-size: 11px;
}

/*
  DARK MODE (follows the Pulse theme toggle)
*/

:global([data-bs-theme="dark"]) .pip-speech,
:global([data-bs-theme="dark"]) .pip-panel,
:global([data-bs-theme="dark"]) .pip-menu {
  background: #23263a;
  border-color: #4a2a3a;
  color: #e7e9f2;
}
:global([data-bs-theme="dark"]) .pip-panel-heading,
:global([data-bs-theme="dark"]) .pip-menu button {
  color: #e7e9f2;
}
:global([data-bs-theme="dark"]) .pip-status,
:global([data-bs-theme="dark"]) .pip-advice,
:global([data-bs-theme="dark"]) .pip-stats div,
:global([data-bs-theme="dark"]) .pip-action:not(.pip-action-hot) {
  background: #2d3048;
  color: #e7e9f2;
}
:global([data-bs-theme="dark"]) .pip-menu button:hover {
  background: #33364f;
}

/*

  ANIMATIONS

*/
@keyframes pipFloat {
  0%, 100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-7px);
  }
}
@keyframes pipJump {
  0%, 100% {
    transform: translateY(0) scale(1, 1);
  }
  10% {
    transform: translateY(0) scale(1.08, 0.92);
  }
  40% {
    transform: translateY(-26px) scale(0.96, 1.05);
  }
  60% {
    transform: translateY(-26px) scale(0.96, 1.05);
  }
  85% {
    transform: translateY(0) scale(1.06, 0.94);
  }
}
@keyframes pipShake {
  from {
    transform: rotate(-4deg);
  }
  to {
    transform: rotate(4deg);
  }
}
@keyframes pipTremble {
  0%, 100% { transform: translateX(0) rotate(0); }
  25% { transform: translateX(-3px) rotate(-3deg); }
  75% { transform: translateX(3px) rotate(3deg); }
}
@keyframes pipDrip {
  0% {
    opacity: 0;
    transform: translateY(-4px);
  }
  20% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: translateY(14px);
  }
}
.pip-fade-enter-active,
.pip-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.pip-fade-enter-from,
.pip-fade-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

/*
  MOBILE
*/

@media (max-width: 600px) {
  .pip-container {
    right: 10px;
    bottom: 10px;
  }
  .pip-button {
    width: 72px;
    height: 72px;
  }
  .pip-cat {
    width: 72px;
    height: 72px;
  }
  .pip-speech {
    right: 67px;
    bottom: 48px;
  }
  .pip-panel {
    bottom: 85px;
  }
}

/* Respect users who disable animations. */

@media (prefers-reduced-motion: reduce) {
  .pip-button,
  .pip-cat,
  .pip-drop {
    animation: none !important;
  }
  .pip-cat,
  .pip-fade-enter-active,
  .pip-fade-leave-active {
    transition: none !important;
  }
}

</style>
