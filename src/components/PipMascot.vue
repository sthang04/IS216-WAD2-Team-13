<script setup>
import { computed, ref } from 'vue'

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
  }
})

// Show or hide Pip's danger summary.
const panelOpen = ref(false)

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

const mood = computed(() => {

    // For notification feature
    if (props.mode === 'notifications') {
    if (props.unansweredCount === 0) return 'calm'
    if (props.unansweredCount <= 2) return 'watch'
    return 'risk'
  }

  // For What-If Simulator
  if (!props.result) return 'idle'

  if (dangerScore.value === 0) return 'calm'
  if (dangerScore.value <= 3) return 'watch'
  if (dangerScore.value <= 7) return 'risk'

  return 'critical'
})

// 4. CHANGE PIP'S COLOUR

const colours = computed(() => {
  const palettes = {
    idle: ['#ff7298', '#ed2558'],
    calm: ['#ff7298', '#ed2558'],
    watch: ['#ffd65c', '#ff9633'],
    risk: ['#ffad55', '#ff563f'],
    critical: ['#ff5668', '#ca093d']
  }

  return palettes[mood.value]
})

// 5. PIP'S SPEECH BUBBLE


const message = computed(() => {

  // NOTIFICATION FEATURE
  if (props.mode === 'notifications') {
    const count = props.unansweredCount

    if (count === 0) {
      return "Yay! You're all caught up! ✨"
    }

    if (count === 1) {
      return "Meow! 1 notification needs a reply!"
    }

    return `Meow! ${count} notifications are awaiting replies!`
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
    return props.unansweredCount === 0
      ? 'You have no outstanding replies.'
      : 'Check your notifications and respond to pending requests.'
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

</script>

<template>
  <div class="pip-container" :class="mood">

    <!-- SPEECH BUBBLE -->
    <Transition name="pip-fade">
      <div v-if="!panelOpen" class="pip-speech">
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
        <div
        v-if="mode === 'notifications'"
        class="pip-stats"
        >
        <div>
            <strong>{{ unansweredCount }}</strong>
            <small>Awaiting Replies</small>
        </div>
        </div>

        <!-- SIMULATOR -->
        <template v-if="result">
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
            ? 'Notification reminder assistant.'
            : 'Hypothetical simulation status only.' }}
        </small>
      </div>
    </Transition>
    
    <!-- CAT BUTTON -->
    <button
      type="button"
      class="pip-button"
      :aria-label="'Pip assistant. ' + moodLabel"
      :aria-expanded="panelOpen"
      aria-controls="pip-summary"
      @click="panelOpen = !panelOpen"
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

        <!-- LEFT EYE -->
        <ellipse
          cx="46"
          cy="62"
          rx="4"
          ry="5.5"
          fill="white"
        />

        <!-- RIGHT EYE -->
        <ellipse
          cx="74"
          cy="62"
          rx="4"
          ry="5.5"
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

        <!-- WORRIED FACE -->
        <g
          v-else-if="mood === 'risk'"
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
      </svg>

      <!-- Small warning indicator -->
      <span
        v-if="mood === 'critical'"
        class="pip-warning"
      >
        !
      </span>

    </button>
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
  z-index: 9999;
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

.risk .pip-cat {
  filter: drop-shadow(
    0 0 15px rgba(255, 125, 20, 0.65)
  );
}

.critical .pip-cat {
  filter: drop-shadow(
    0 0 19px rgba(255, 40, 75, 0.8)
  );
}

.critical .pip-button {
  animation: pipShake 0.5s ease-in-out infinite alternate;
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
   CRITICAL ALERT ICON
*/

.pip-warning {
  position: absolute;
  top: 4px;
  right: 4px;

  background: #e11d48;
  color: white;

  width: 23px;
  height: 23px;

  border: 2px solid white;
  border-radius: 50%;

  font-size: 13px;
  font-weight: bold;

  display: flex;
  align-items: center;
  justify-content: center;
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

@keyframes pipShake {
  from {
    transform: rotate(-4deg);
  }

  to {
    transform: rotate(4deg);
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
  .pip-button {
    animation: none !important;
  }

  .pip-cat,
  .pip-fade-enter-active,
  .pip-fade-leave-active {
    transition: none !important;
  }
}

</style>

