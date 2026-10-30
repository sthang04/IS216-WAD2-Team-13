
<script setup>
// Wraps the four facility pages (calendar, My Club, waitlist, OSL approvals).
// App.vue loads who is signed in (initSession) and shows the bell and Pip on
// every page; this waits for that session, then shows the current page in <RouterView />.
import { ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { session, initSession, toast, setActiveClub } from '../services/sessionState'
import { startNotifications } from '../services/notificationStore'

const router = useRouter()
const route = useRoute()

const loadError = ref('')
const loadingSession = ref(false)

// "Retry" after a failed load
async function loadSession() {
  loadingSession.value = true
  loadError.value = ''
  try {
    await initSession()
    startNotifications()
  } catch (error) {
    loadError.value = error.message
    console.log(error.message)
  } finally {
    loadingSession.value = false
  }
}

// Telegram links end with ?club=<club id> so the page opens on that CCA
watch(() => session.value.ready, (ready) => {
  if (ready && route.query.club) {
    setActiveClub(Number(route.query.club))
    startNotifications()
    router.replace({ path: route.path })
  }
}, { immediate: true })
</script>

<template>
  <div class="pulse-facility-module">

  <div class="pb-3">

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
        <!-- The pages have several root elements, which <Transition> can't animate
             (the next page then never appears), so give it one element to swap -->
        <div :key="`${route.path}-${session.memberId}-${session.activeClubId}`">
          <component :is="Component" />
        </div>
      </Transition>
    </RouterView>

  </div>

  </div>
</template>
