
<script setup>
// Wraps the four facility pages (calendar, My Club, waitlist, OSL approvals).
// Loads who is signed in, then shows the current page in <RouterView />.
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import FacilityNavbar from '../components/FacilityNavbar.vue'
import PipMascot from '../components/PipMascot.vue'
import { NOTIFICATION_LIMIT } from '../services/notificationService'
import { DECISION_LIMIT, decisionListIsFull } from '../services/transferService'
import { session, initSession, toast, setActiveClub } from '../services/sessionState'
import {
  notificationStore,
  unreadCount,
  soonestOfferSeconds,
  notificationListIsFull,
  startNotifications,
  setPipStatic,
  reloadAll
} from '../services/notificationStore'
 
const router = useRouter()
const route = useRoute()
 
const loadError = ref('')
const loadingSession = ref(true)
const viewKey = ref(0) // changing this redraws the page after "Reset demo"
 
// Inside the team app, who you are comes from the team's sign-in,
// so the demo persona switcher is turned off here.
session.value.demoMode = false
 
async function loadSession() {
  loadingSession.value = true
  loadError.value = ''
  try {
    await initSession()
  } catch (error) {
    loadError.value = error.message
    console.log(error.message)
  } finally {
    loadingSession.value = false
  }
}
 
function handleDataReset() {
  viewKey.value += 1
  reloadAll()
}
 
// Pip's buttons: open the bell, or go to the waitlist offer
function openNotifications() {
  notificationStore.value.bellOpen = true
}
 
function openOffer() {
  router.push('/facilities/waitlist')
}
 
// Telegram links end with ?club=<club id> so the page opens on that CCA
function applyClubFromLink() {
  if (route.query.club) {
    setActiveClub(Number(route.query.club))
    router.replace({ path: route.path })
  }
}
 
onMounted(async () => {
  await loadSession()
  applyClubFromLink()
  startNotifications()
})
</script>
 
<template>
  <div class="pulse-facility" >
  <FacilityNavbar embedded @data-reset="handleDataReset" />
 
  <div class="py-3">
 
    <!-- Shared toast -->
    <Transition name="toast">
    <div
      v-if="toast.message"
      class="alert shadow-sm pulse-toast"
      :class="`alert-${toast.type}`"
      role="status"
    >
      {{ toast.message }}
 
      <button
        type="button"
        class="btn-close float-end"
        aria-label="Dismiss"
        @click="toast.message = ''"
      ></button>
    </div>
    </Transition>
 
    <!-- Connection error -->
    <div v-if="loadError" class="alert alert-danger">
      <strong>Could not load Pulse session.</strong>
      <p class="mb-2">{{ loadError }}</p>
 
      <button
        class="btn btn-sm btn-outline-danger"
        @click="loadSession"
      >
        Retry
      </button>
    </div>
 
    <!-- Loading -->
    <div
      v-else-if="loadingSession || !session.ready"
      class="text-center py-5"
    >
      <div class="spinner-border text-danger"></div>
      <p class="text-muted mt-2">Loading Pulse...</p>
    </div>
 
    <!-- Current route -->
    <RouterView v-else v-slot="{ Component, route }">
      <Transition name="page" mode="out-in">
        <component
          :is="Component"
          :key="`${route.path}-${viewKey}-${session.memberId}-${session.activeClubId}`"
        />
      </Transition>
    </RouterView>
 
  </div>
 
  <!-- Pip watches notifications and waitlist offers on every page -->
  <PipMascot
    v-if="session.ready && session.memberId"
    mode="notifications"
    :unanswered-count="unreadCount"
    :offer-seconds-left="soonestOfferSeconds"
    :list-is-full="notificationListIsFull"
    :notification-limit="NOTIFICATION_LIMIT"
    :decisions-full="session.isOslAdmin && decisionListIsFull"
    :decision-limit="DECISION_LIMIT"
    :is-static="notificationStore.pipStatic"
    @update:is-static="setPipStatic"
    @open-notifications="openNotifications"
    @open-offer="openOffer"
  />
  </div>
</template>
 