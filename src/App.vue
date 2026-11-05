<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { VIEW_PATHS } from './router';
import { resetDemoData } from './services/facilityService';
import { DEMO_PERSONAS, ALL_CLUBS, GUEST_PERSONA } from './services/authProfiles';
import {
  restoreSession, signOut,
  canOpenView, canResetDemo as canResetDemoFor, homeView,
} from './services/authService';
import { session as facilitySession, initSession, setActiveClub, resolveClubId } from './services/sessionState';
import {
  notificationStore, unreadCount, soonestOfferSeconds,
  startNotifications, reloadAll, setPipStatic, setPipQuiet
} from './services/notificationStore';
import NotificationBell from './components/NotificationBell.vue';
import PipMascot from './components/PipMascot.vue';
import LandingLoginView from './views/LandingLoginView.vue';
import SignUpView from './views/SignUpView.vue';
import AvailabilityView from './views/AvailabilityView.vue';
import OperationsView from './views/OperationsView.vue';
import EventRiskView from './views/EventRiskView.vue';

import PersonalScheduleView from './views/PersonalScheduleView.vue';
 
// App Views state
const currentView = ref('landing') // 'landing', 'facilities', 'schedule', 'heatmap', 'operations', 'risk'
// OSL's header has two tabs inside the facility module: the calendar and OSL Review
const isOslReviewRoute = computed(() => route.path.startsWith('/facilities/admin'))

// Mobile Hamburger Navigation Drawer State
const mobileMenuOpen = ref(false)

const router = useRouter()
const route = useRoute()

// Close mobile drawer automatically when switching views
watch(currentView, () => {
  mobileMenuOpen.value = false
})

watch(currentView, async (view) => {
  if (route.meta.view !== view && VIEW_PATHS[view]) {
    const failure = await router.push(VIEW_PATHS[view])
    if (failure && route.meta.view) currentView.value = route.meta.view
  }
})
watch(() => route.meta.view, (view) => {
  if (view && isLoggedIn.value && view !== currentView.value) currentView.value = view
})
// /signup opens the sign-up screen
watch(() => route.meta.signup, (signup) => { if (signup) showSignUp.value = true })
watch(() => route.path, (newPath) => {
  if (newPath === '/signup') {
    showSignUp.value = true
  } else if (showSignUp.value) {
    showSignUp.value = false
  }
})
const apiMode = ref(false) // Toggle API badge tags on/off across all views
const loading = ref(true)
const toast = ref('')
const toastType = ref('info')
 
// User & Role State with Strict CCA Scoping
const authReady = ref(false)
const isLoggedIn = ref(false)
const sessionPersona = ref(null)
const activePersona = ref(GUEST_PERSONA)
const selectedClub = ref(null)
const profileMenuOpen = ref(false)
 
const personaInitials = computed(() => {
  const words = (activePersona.value.name || '').trim().split(/\s+/).filter(Boolean)
  return words.slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?'
})
const profileMenu = ref(null)
 
function closeProfileOnOutside(event) {
  if (profileMenuOpen.value && profileMenu.value && !profileMenu.value.contains(event.target)) {
    profileMenuOpen.value = false
  }
}
 
function closeProfileOnEscape(event) {
  if (event.key === 'Escape') profileMenuOpen.value = false
}
const showSignUp = ref(false)
 
const isAdmin = computed(() => activePersona.value.role === 'admin')
const isDev = computed(() => activePersona.value.isDev)
const isGuest = computed(() => activePersona.value.role === 'guest')
const allowedClubs = computed(() => activePersona.value.allowedClubs || [])
const canSwitchPersona = computed(() => !!sessionPersona.value?.isDev)
const canResetDemo = computed(() => canResetDemoFor(sessionPersona.value))
 
watch([selectedClub, () => facilitySession.value.memberships], ([club]) => {
  if (!club) return
  if (activePersona.value && activePersona.value.cca !== club) {
    activePersona.value = { ...activePersona.value, cca: club }
  }
  const normalized = club.replace(/^SMU\s+/i, '').trim().toLowerCase()
  const membership = facilitySession.value.memberships.find((m) => {
    const mName = (m.club_name || '').replace(/^SMU\s+/i, '').trim().toLowerCase()
    const mShort = (m.short_name || '').trim().toLowerCase()
    return mName === normalized || mShort === normalized || m.club_name === club
  })
  const targetId = membership ? membership.club_id : resolveClubId(club)
  if (targetId !== facilitySession.value.activeClubId) {
    setActiveClub(targetId)
    startNotifications()
  }
})
 
watch(currentView, (view) => {
  if (!isLoggedIn.value || view === 'landing') return
  if (!canOpenView(activePersona.value, view)) {
    currentView.value = homeView(activePersona.value)
    toast.value = `${activePersona.value.roleLabel} accounts can't open that page.`
    toastType.value = 'warning'
  }
})
 
function handleMeetingScheduled(meeting) {
  toast.value = `Meeting scheduled! Telegram broadcast sent to team with agenda: "${meeting.title}"`
  toastType.value = 'success'
}
 
function switchPersona(personaKey) {
  const p = DEMO_PERSONAS[personaKey]
  if (!p || !canSwitchPersona.value) return
  activePersona.value = p
  selectedClub.value = p.cca
  profileMenuOpen.value = false
  if (p.cca) {
    setActiveClub(resolveClubId(p.cca))
  }
  
  if (p.role === 'admin' || !canOpenView(p, currentView.value)) {
    currentView.value = homeView(p)
  }
 
  toast.value = `Switched perspective to ${p.name} (${p.roleLabel})`
  toastType.value = 'info'
}
 
async function handleResetDemo() {
  try {
    await resetDemoData()
    reloadAll()
    toast.value = 'Database reset to initial seeds!'
    toastType.value = 'info'
  } catch (error) {
    console.log(error.message)
    toastType.value = 'danger'
    toast.value = 'Error: ' + error.message
  }
}
 
const isAutoRunning = ref(false)
const autoStepText = ref('')
 
facilitySession.value.demoMode = false
 
async function loadNotificationSession() {
  try {
    await initSession()
  } catch (error) {
    console.log(error.message)
  }
  startNotifications()
}
 
const pipVisible = computed(() => isLoggedIn.value && facilitySession.value.ready && !!facilitySession.value.memberId)
 
function openNotifications() {
  notificationStore.value.bellOpen = true
}
 
function openOffer() {
  currentView.value = 'facilities'
  router.push('/facilities/waitlist')
}
 
function applySession(persona, { stayOnLanding = false } = {}) {
  sessionPersona.value = persona
  activePersona.value = persona
  selectedClub.value = persona.cca
  if (persona.cca) {
    setActiveClub(resolveClubId(persona.cca))
  }
  isLoggedIn.value = true
  loadNotificationSession()
  if (stayOnLanding) {
    currentView.value = 'landing'
    return
  }
  const wanted = route.query.redirect ? router.resolve(String(route.query.redirect)) : route
  const view = wanted.meta.view
  if (view && view !== 'landing' && canOpenView(persona, view)) {
    currentView.value = view
    if (wanted.fullPath !== route.fullPath) router.replace(wanted.fullPath)
  } else {
    currentView.value = homeView(persona)
  }
}
 
let toastTimer = null

function handleUserLogin(persona) {
  applySession(persona)
  toast.value = `Signed in as ${persona.name} (${persona.roleLabel})`
  toastType.value = 'success'

  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toast.value = ''
  }, 10000)
}
 
function startSignUp() {
  showSignUp.value = true
  if (route.path !== '/signup') {
    router.push('/signup')
  }
}

function handleSignUpCancel() {
  showSignUp.value = false
  if (route.path === '/signup') {
    router.push('/')
  }
}

function handleSignUpDone(persona) {
  showSignUp.value = false
  if (persona) {
    try {
      const now = new Date()
      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      const resolvedCca = persona.cca || persona.club || 'SMU ExCo'
      localStorage.setItem('pulse_remembered_account', JSON.stringify({
        email: persona.email,
        name: persona.name,
        roleLabel: persona.roleLabel,
        cca: resolvedCca,
        club: resolvedCca,
        lastLoginAt: `Today, ${timeStr}`,
        isDemo: false
      }))
    } catch {}
    applySession(persona)
    currentView.value = homeView(persona)
    router.push(VIEW_PATHS[homeView(persona)] || '/facilities')
    toast.value = `Welcome to Pulse, ${persona.name}! You're signed in as ${persona.roleLabel}.`
    toastType.value = 'success'
  }
}
 
async function handleSignOut() {
  profileMenuOpen.value = false
  try {
    await signOut()
  } finally {
    isLoggedIn.value = false
    sessionPersona.value = null
    activePersona.value = GUEST_PERSONA
    selectedClub.value = null
    currentView.value = 'landing'
    toast.value = ''
    loadNotificationSession()
  }
}
 
onMounted(() => {
  document.addEventListener('pointerdown', closeProfileOnOutside)
  document.addEventListener('keydown', closeProfileOnEscape)
})
 
onUnmounted(() => {
  document.removeEventListener('pointerdown', closeProfileOnOutside)
  document.removeEventListener('keydown', closeProfileOnEscape)
})
 
onMounted(async () => {
  document.body.classList.remove('dark-mode')
  try {
    localStorage.removeItem('pulse_theme')
  } catch {}
 
  try {
    await router.isReady()
    if (route.meta.signup) showSignUp.value = true
    try {
      const persona = await restoreSession()
      if (persona) applySession(persona, { stayOnLanding: route.name === 'landing' && !route.query.redirect })
    } catch (error) {
      console.warn('Could not restore session:', error.message)
    } finally {
      authReady.value = true
    }
  } catch (error) {
    toastType.value = 'danger'
    toast.value = `Pulse could not start: ${error.message}`
  } finally {
    loading.value = false
  }
})
</script>
 
<template>
  <div>
    
    <div v-if="!authReady" class="min-vh-100 d-flex align-items-center justify-content-center">
      <div class="spinner-border text-danger" role="status"></div>
    </div>
 
    <SignUpView
      v-else-if="showSignUp"
      @done="handleSignUpDone"
      @cancel="handleSignUpCancel"
    />
 
    <div v-else-if="!isLoggedIn || currentView === 'landing'">
      <LandingLoginView 
        @login="handleUserLogin"
        @signup="startSignUp"
      />
    </div>
 
    <div v-else class="min-vh-100 d-flex flex-column" style="background-color: var(--pulse-bg);">
      
      <!-- Top SaaS Header -->
      <header class="pulse-header px-3 px-lg-4 py-2">
        <div class="container-fluid d-flex flex-nowrap align-items-center justify-content-between gap-1 gap-sm-2 gap-lg-3">
          
          <!-- Left group may shrink (min-width: 0) so the bell, avatar and ☰ menu always fit on 320px phones -->
          <div class="d-flex align-items-center gap-2 gap-sm-3 flex-shrink-1" style="min-width: 0;">
            <a href="#" class="pulse-brand-logo text-decoration-none flex-shrink-0" @click.prevent="router.push('/facilities')">
              <div class="pulse-logo-badge">
                <span>P</span>
                <span class="pulse-logo-dot"></span>
              </div>
              <span class="d-none d-sm-inline">Pulse</span>
            </a>
 
            <div v-if="isAdmin" class="badge bg-danger px-2 px-sm-3 py-2 text-truncate" style="border-radius: 0.65rem; font-size: 0.75rem; max-width: 150px;">
              <span class="d-none d-sm-inline">OSL Facility </span>Admin<span class="d-none d-sm-inline">istration</span>
            </div>
 
            <div v-else-if="isDev" class="d-flex align-items-center gap-1.5 flex-shrink-0">
              <div class="input-group input-group-sm">
                <span class="input-group-text bg-white border-end-0 text-muted d-none d-md-flex px-2" style="border-radius: 0.65rem 0 0 0.65rem;">
                  <span style="font-size: 0.7rem; font-weight: 700; text-transform: uppercase; color: var(--pulse-purple-transit);">Dev Scope:</span>
                </span>
                <select 
                  id="clubSwitcher"
                  aria-label="Club scope"
                  v-model="selectedClub" 
                  class="form-select form-select-sm fw-bold club-switcher-select" 
                  style="border-radius: 0.65rem;"
                  :style="isDev ? 'border-top-left-radius: 0; border-bottom-left-radius: 0;' : ''"
                  @change="toast = ''"
                >
                  <option v-for="club in ALL_CLUBS" :key="club" :value="club">{{ club }}</option>
                </select>
              </div>
            </div>

            <div v-else class="d-flex align-items-center flex-shrink-1" style="min-width: 0;">
              <div v-if="allowedClubs.length <= 1" class="d-flex align-items-center px-2 py-1 bg-white border shadow-2xs rounded-pill" style="gap: 0.45rem; padding-inline: 0.7rem !important; min-width: 0;" :title="selectedClub">
                <span class="pulse-cca-dot flex-shrink-0" aria-hidden="true"></span>
                <!-- Long club names truncate with an ellipsis on narrow phones; the full name is in the tooltip -->
                <span class="fw-bold text-dark text-nowrap text-truncate" style="font-size: 0.78rem;">{{ selectedClub }}</span>
              </div>
              <div v-else class="input-group input-group-sm">
                <select 
                  id="clubSwitcher"
                  aria-label="Club scope"
                  v-model="selectedClub" 
                  class="form-select form-select-sm fw-bold club-switcher-select" 
                  style="border-radius: 0.65rem;"
                  @change="toast = ''"
                >
                  <option v-for="club in allowedClubs" :key="club" :value="club">{{ club }}</option>
                </select>
              </div>
            </div>
          </div>
 
          <!-- Desktop Tabs -->
          <nav v-if="isAdmin" class="d-none d-lg-flex align-items-center gap-1 pulse-header-nav flex-shrink-1">
            <button
              type="button"
              class="pulse-nav-pill"
              :class="{ active: currentView === 'facilities' && !isOslReviewRoute }"
              @click="router.push('/facilities')"
            ><span class="d-none d-xxl-inline">Master </span>Facility Calendar</button>
            <button
              type="button"
              class="pulse-nav-pill"
              :class="{ active: isOslReviewRoute }"
              @click="router.push('/facilities/admin')"
            >
              OSL Review
            </button>
          </nav>
 
          <nav v-else class="d-none d-lg-flex align-items-center gap-1 pulse-header-nav flex-shrink-1">
            <button 
              type="button" 
              class="pulse-nav-pill" 
              :class="{ active: currentView === 'facilities' }"
              @click="currentView = 'facilities'"
            ><span class="d-none d-xxl-inline">Master </span>Facility Calendar</button>
            <button 
              v-if="canOpenView(activePersona, 'schedule')"
              type="button" 
              class="pulse-nav-pill" 
              :class="{ active: currentView === 'schedule' }"
              @click="currentView = 'schedule'"
            ><span class="d-none d-xxl-inline">Personal </span>Schedule</button>
            <button 
              v-if="canOpenView(activePersona, 'heatmap')"
              type="button" 
              class="pulse-nav-pill" 
              :class="{ active: currentView === 'heatmap' }"
              @click="currentView = 'heatmap'"
            ><span class="d-none d-xxl-inline">Availability </span>Heatmap</button>
            <button 
              v-if="canOpenView(activePersona, 'operations')"
              type="button" 
              class="pulse-nav-pill" 
              :class="{ active: currentView === 'operations' }"
              @click="currentView = 'operations'"
            ><span class="d-none d-xxl-inline">Day-of </span>Operations</button>
            <button 
              v-if="canOpenView(activePersona, 'risk')"
              type="button" 
              class="pulse-nav-pill" 
              :class="{ active: currentView === 'risk' }"
              @click="currentView = 'risk'"
            ><span class="d-none d-xxl-inline">Event </span>Risk Planning</button>
          </nav>
 
          <!-- Right Controls + Mobile Hamburger Toggle -->
          <div class="d-flex align-items-center gap-2 ms-auto flex-shrink-0">
            
            <button
              v-if="canResetDemo"
              type="button"
              class="btn btn-outline-danger btn-sm px-3 fw-bold rounded-pill d-none d-lg-inline-block"
              :disabled="isAutoRunning"
              @click="handleResetDemo"
            >
              Reset Demo
            </button>
 
            <NotificationBell />
 
            <div ref="profileMenu" class="position-relative">
              <button
                type="button"
                class="pulse-avatar-btn"
                :aria-expanded="profileMenuOpen"
                :aria-label="`Account menu for ${activePersona.name}`"
                :title="activePersona.name"
                @click="profileMenuOpen = !profileMenuOpen"
              >
                {{ personaInitials }}
              </button>
 
              <div 
                v-if="profileMenuOpen" 
                class="card shadow-lg position-absolute end-0 mt-2 p-2 border-0 pulse-account-menu"
                style="min-width: 260px; z-index: 1050; border-radius: 0.85rem;"
              >
                <div class="p-2 border-bottom mb-2">
                  <div class="fw-bold" style="font-size: 0.825rem;">{{ activePersona.name }}</div>
                  <small class="text-muted d-block" style="font-size: 0.7rem;">{{ activePersona.roleLabel }}</small>
                </div>
 
                <template v-if="canSwitchPersona">
                  <div class="p-2 border-bottom mb-2 text-muted" style="font-size: 0.7rem; font-weight: 700; text-transform: uppercase;">
                    Switch Persona (Live Demo)
                  </div>
                  <button type="button" class="btn text-start mb-1 py-2 px-3 rounded-3 btn-white" @click="switchPersona('rachel')">Rachel Tan</button>
                  <button type="button" class="btn text-start mb-1 py-2 px-3 rounded-3 btn-white" @click="switchPersona('darren')">Darren Koh</button>
                  <hr class="my-1">
                </template>

                <button 
                  type="button" 
                  class="btn btn-sm btn-link text-danger text-start px-3 py-1 text-decoration-none"
                  @click="handleSignOut"
                >
                  Sign out
                </button>
              </div>
            </div>

            <!-- Hamburger Button (< 992px) -->
            <button 
              type="button"
              class="btn btn-light border rounded-3 p-2 d-lg-none d-flex align-items-center justify-content-center"
              style="width: 38px; height: 38px;"
              aria-label="Toggle Navigation Menu"
              aria-controls="pulse-mobile-drawer"
              :aria-expanded="mobileMenuOpen ? 'true' : 'false'"
              @click="mobileMenuOpen = !mobileMenuOpen"
            >
              <span style="font-size: 1.25rem; line-height: 1;">{{ mobileMenuOpen ? '✕' : '☰' }}</span>
            </button>
 
          </div>
 
        </div>
      </header>

      <!-- Mobile Navigation Drawer Overlay -->
      <div 
        v-if="mobileMenuOpen" 
        class="pulse-mobile-drawer-backdrop" 
        @click="mobileMenuOpen = false"
      ></div>

      <!-- inert + aria-hidden keep the closed drawer out of keyboard focus and screen readers -->
      <aside
        id="pulse-mobile-drawer"
        class="pulse-mobile-drawer"
        :class="{ open: mobileMenuOpen }"
        aria-label="Navigation menu"
        :aria-hidden="mobileMenuOpen ? 'false' : 'true'"
        :inert="!mobileMenuOpen"
      >
        <div class="d-flex align-items-center justify-content-between p-3 border-bottom bg-light">
          <div class="fw-bold text-dark d-flex align-items-center gap-2" style="font-size: 0.95rem;">
            <span style="color: var(--pulse-primary, #e11d48);">●</span> Navigation Menu
          </div>
          <button type="button" class="btn-close" aria-label="Close navigation menu" @click="mobileMenuOpen = false"></button>
        </div>

        <div class="p-3 d-flex flex-column gap-2">
          <template v-if="isAdmin">
            <button
              type="button"
              class="pulse-drawer-link"
              :class="{ active: currentView === 'facilities' && !isOslReviewRoute }"
              @click="router.push('/facilities'); mobileMenuOpen = false;"
            >
              <span></span> Master Facility Calendar
            </button>
            <button
              type="button"
              class="pulse-drawer-link"
              :class="{ active: isOslReviewRoute }"
              @click="router.push('/facilities/admin'); mobileMenuOpen = false;"
            >
              <span></span> OSL Review
            </button>
          </template>

          <template v-else>
            <button 
              type="button" 
              class="pulse-drawer-link" 
              :class="{ active: currentView === 'facilities' }"
              @click="currentView = 'facilities'; mobileMenuOpen = false;"
            >
              <span></span> Master Facility Calendar
            </button>
            <button 
              v-if="canOpenView(activePersona, 'schedule')"
              type="button" 
              class="pulse-drawer-link" 
              :class="{ active: currentView === 'schedule' }"
              @click="currentView = 'schedule'; mobileMenuOpen = false;"
            >
              <span></span> Personal Schedule
            </button>
            <button 
              v-if="canOpenView(activePersona, 'heatmap')"
              type="button" 
              class="pulse-drawer-link" 
              :class="{ active: currentView === 'heatmap' }"
              @click="currentView = 'heatmap'; mobileMenuOpen = false;"
            >
              <span></span> Availability Heatmap
            </button>
            <button 
              v-if="canOpenView(activePersona, 'operations')"
              type="button" 
              class="pulse-drawer-link" 
              :class="{ active: currentView === 'operations' }"
              @click="currentView = 'operations'; mobileMenuOpen = false;"
            >
              <span></span> Day-of Operations
            </button>
            <button 
              v-if="canOpenView(activePersona, 'risk')"
              type="button" 
              class="pulse-drawer-link" 
              :class="{ active: currentView === 'risk' }"
              @click="currentView = 'risk'; mobileMenuOpen = false;"
            >
              <span></span> Event Risk Planning
            </button>
          </template>
        </div>
      </aside>

      <!-- Main View Container -->
      <main class="container-xl py-4 flex-grow-1">
        <div :class="{ 'pulse-pip-gutter': pipVisible }">
 
        <div v-if="toast" class="alert fade show shadow-sm mb-3 py-2 px-3 d-flex align-items-center justify-content-between gap-2" :class="`alert-${toastType}`" role="alert" style="border-radius: 0.85rem;">
          <div class="d-flex align-items-center gap-2 min-w-0" style="font-size: 0.825rem;">
            <strong class="text-nowrap flex-shrink-0">Notice:</strong>
            <span class="flex-grow-1" style="word-break: break-word;">{{ toast }}</span>
          </div>
          <button type="button" class="btn-close flex-shrink-0" aria-label="Close notice" style="position: static; padding: 0.35rem; font-size: 0.725rem;" @click="toast = ''"></button>
        </div>

 
        <div v-show="currentView === 'facilities'">
          <RouterView />
        </div>
 
        <div v-show="currentView === 'schedule'">
          <PersonalScheduleView :active="currentView === 'schedule'" :api-mode="apiMode" :active-persona="activePersona" :read-only="isGuest" />
        </div>
 
        <div v-show="currentView === 'heatmap'">
          <AvailabilityView :api-mode="apiMode" :read-only="isGuest" @meeting-scheduled="handleMeetingScheduled" />
        </div>
 
        <div v-show="currentView === 'operations'">
          <OperationsView :api-mode="apiMode" :active-persona="activePersona" :read-only="isGuest" />
        </div>
 
        <div v-show="currentView === 'risk'">
          <EventRiskView :active="route.meta.view === 'risk'" :api-mode="apiMode" :read-only="isGuest" />
        </div>
 
        </div>
      </main>
 
      <PipMascot
        v-if="pipVisible"
        class="d-none d-lg-block"
        mode="notifications"
        :unanswered-count="unreadCount"
        :offer-seconds-left="soonestOfferSeconds"
        :is-static="notificationStore.pipStatic"
        @update:is-static="setPipStatic"
        :is-quiet="notificationStore.pipQuiet || currentView === 'schedule'"
        @update:is-quiet="setPipQuiet"
        @open-notifications="openNotifications"
        @open-offer="openOffer"
      />
 
      <footer class="py-3 border-top text-muted small bg-white mt-auto">
        <div class="container d-flex flex-wrap justify-content-between align-items-center gap-2">
          <div class="d-flex align-items-center gap-2 flex-wrap">
            <span class="fw-semibold text-dark">Singapore Management University</span>
            <span class="text-muted">•</span>
            <span>Office of Student Life (OSL)</span>
          </div>
          <div class="d-flex align-items-center gap-3 text-muted" style="font-size: 0.775rem;">
            <span>Pulse Co-Curricular & Arts Facilities Management</span>
          </div>
        </div>
      </footer>
 
    </div>
 
  </div>
</template>

<style>
/* Mobile Drawer Overlay Backdrop */
.pulse-mobile-drawer-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.4);
  backdrop-filter: blur(2px);
  z-index: 1040;
}

/* Mobile Slide-out Navigation Drawer */
.pulse-mobile-drawer {
  position: fixed;
  top: 0;
  right: -300px;
  width: 280px;
  height: 100vh;
  background: #ffffff;
  box-shadow: -4px 0 20px rgba(0, 0, 0, 0.15);
  z-index: 1050;
  /* Closed: hidden after the slide-out finishes, so its links can't be tabbed to or read out off-screen */
  visibility: hidden;
  transition: right 0.25s cubic-bezier(0.16, 1, 0.3, 1), visibility 0s linear 0.25s;
  display: flex;
  flex-direction: column;
}

.pulse-mobile-drawer.open {
  right: 0;
  visibility: visible;
  transition: right 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

/* Mobile Navigation Drawer Links */
.pulse-drawer-link {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  padding: 0.75rem 1rem;
  border-radius: 0.65rem;
  border: 1px solid transparent;
  background: transparent;
  color: #334155;
  font-weight: 600;
  font-size: 0.875rem;
  text-align: left;
  transition: all 0.15s ease;
}

.pulse-drawer-link:hover {
  background: #f8fafc;
  color: #0f172a;
}

.pulse-drawer-link.active {
  background: #fff1f2;
  color: #e11d48;
  border-color: #fda4af;
}
</style>