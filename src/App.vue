<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { VIEW_PATHS } from './router';
import { fetchCalendar, resetDemoData, singaporeToday, formatDate, formatTime, CALENDAR_END } from './services/facilityService';
import { approveTransfer, rejectTransfer } from './services/transferService';
import { DEMO_PERSONAS, ALL_CLUBS, GUEST_PERSONA } from './services/authProfiles';
import {
  enterGuest, restoreSession, signOut,
  canOpenView, canResetDemo as canResetDemoFor, homeView,
} from './services/authService';
import { session as facilitySession, initSession, setActiveClub } from './services/sessionState';
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
import OslAdminView from './views/OslAdminView.vue';
 
// App Views state
const currentView = ref('landing') // 'landing', 'admin', 'facilities', 'schedule', 'heatmap', 'operations', 'risk'
// OSL's header has two tabs inside the facility module: the calendar and OSL Review
const isOslReviewRoute = computed(() => route.path.startsWith('/facilities/admin'))
 
// Keep currentView and the URL in step (src/router/index.js): clicking a tab
// changes the URL, and opening or refreshing a URL opens that page.
const router = useRouter()
const route = useRoute()
watch(currentView, (view) => {
  if (route.meta.view !== view && VIEW_PATHS[view]) router.push(VIEW_PATHS[view])
})
watch(() => route.meta.view, (view) => {
  if (view && isLoggedIn.value && view !== currentView.value) currentView.value = view
})
// /signup opens the sign-up screen
watch(() => route.meta.signup, (signup) => { if (signup && !isLoggedIn.value) showSignUp.value = true })
const apiMode = ref(false) // Toggle API badge tags on/off across all views (Default: OFF as requested)
const slots = ref([])
const loading = ref(true)
const processingId = ref(null)
const toast = ref('')
const toastType = ref('info')
 
// User & Role State with Strict CCA Scoping
const authReady = ref(false) // false until the saved session has been checked on load
const isLoggedIn = ref(false)
const sessionPersona = ref(null) // who signed in
const activePersona = ref(GUEST_PERSONA) // who the app is acting as (only Dev can switch this)
const selectedClub = ref(null)
const profileMenuOpen = ref(false)
const profileMenu = ref(null)
 
// Close the profile menu when pressing outside it, or with Escape (same as the bell)
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
 
// The facility pages act for the club picked in this header (their own navbar is gone)
watch([selectedClub, () => facilitySession.value.memberships], ([club]) => {
  const membership = facilitySession.value.memberships.find((m) => m.club_name === club)
  if (membership && membership.club_id !== facilitySession.value.activeClubId) {
    setActiveClub(membership.club_id)
    startNotifications()
  }
})
 
// Route protection: send users back to their home page if they open a page their role can't see
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
 
// Dev-only: view the app as another persona (permissions still come from the Dev sign-in)
function switchPersona(personaKey) {
  const p = DEMO_PERSONAS[personaKey]
  if (!p || !canSwitchPersona.value) return
  activePersona.value = p
  selectedClub.value = p.cca
  profileMenuOpen.value = false
  
  if (p.role === 'admin' || !canOpenView(p, currentView.value)) {
    currentView.value = homeView(p)
  }
 
  toast.value = `Switched perspective to ${p.name} (${p.roleLabel})`
  toastType.value = 'info'
}
 
// The OSL console (OslAdminView) shows bookings from the facility calendar database.
// Each row of v_master_facility_calendar is turned into the "slot" shape that
// OslAdminView already understands, so that page did not need to change.
function toSlot(booking) {
  let status = booking.status
  if (status === 'Officially Confirmed Booking') {
    status = 'Officially Confirmed'   // the name OslAdminView uses
  }
  return {
    id: booking.booking_id,
    transfer_id: booking.transfer_id,
    venue_name: booking.facility_name,
    venue_type: booking.facility_type,
    building_location: booking.location || '',
    owner_club: booking.owner_club_name,
    claiming_club: booking.claiming_club_name,
    status: status,
    event_date: formatDate(booking.booking_date),
    time_slot: formatTime(booking.start_time) + ' - ' + formatTime(booking.end_time),
    fbs_ref: booking.fbs_reference
  }
}
 
// Load bookings from today to the end of the calendar
async function loadSlots() {
  const bookings = await fetchCalendar({ from: singaporeToday(), to: CALENDAR_END })
  const result = []
  bookings.forEach((booking) => {
    result.push(toSlot(booking))
  })
  slots.value = result
}
 
// Run an OSL action, reload, and show the result
async function handleAction(slot, action, message) {
  if (processingId.value !== null) {
    return
  }
  processingId.value = slot.id
  try {
    await action()
    await loadSlots()
    toastType.value = 'success'
    toast.value = message
  } catch (error) {
    console.log(error.message)
    toastType.value = 'danger'
    toast.value = 'Error: ' + error.message
  }
  processingId.value = null
}
 
// OSL approves a claimed transfer (database checks they are an OSL admin)
async function handleConfirm(slot) {
  await handleAction(
    slot,
    () => approveTransfer(slot.transfer_id),
    slot.venue_name + ' transfer verified and officially confirmed by OSL Admin!'
  )
}
 
// OSL rejects a claimed transfer; the slot goes back on offer
async function handleReject(slot) {
  await handleAction(
    slot,
    () => rejectTransfer(slot.transfer_id, 'Rejected from the OSL console'),
    slot.venue_name + ' claim rejected; slot remains available on marketplace.'
  )
}
 
// "Reset Demo" button
async function handleResetDemo() {
  try {
    await resetDemoData()
    reloadAll()
    await loadSlots()
    toast.value = 'Database reset to initial seeds!'
    toastType.value = 'info'
  } catch (error) {
    console.log(error.message)
    toastType.value = 'danger'
    toast.value = 'Error: ' + error.message
  }
}
 
// Autopilot demo was Dev-only and has been removed with the Dev persona.
const isAutoRunning = ref(false)
const autoStepText = ref('')
 
// Who you are comes from the team's sign-in, so the facility module's
// demo persona switcher stays off
facilitySession.value.demoMode = false
 
// The bell and Pip (on every page) read the facility session's notifications,
// so load that session whenever someone signs in or out
async function loadNotificationSession() {
  try {
    await initSession()
  } catch (error) {
    console.log(error.message)
  }
  startNotifications()
}
 
const pipVisible = computed(() => isLoggedIn.value && facilitySession.value.ready && !!facilitySession.value.memberId)
 
// Pip's buttons: open the bell, or go to the waitlist offer
function openNotifications() {
  notificationStore.value.bellOpen = true
}
 
function openOffer() {
  currentView.value = 'facilities'
  router.push('/facilities/waitlist')
}
 
// stayOnLanding: a restored sign-in opened at "/" keeps showing the landing page
function applySession(persona, { stayOnLanding = false } = {}) {
  sessionPersona.value = persona
  activePersona.value = persona
  selectedClub.value = persona.cca
  isLoggedIn.value = true
  loadNotificationSession()
  if (stayOnLanding) {
    currentView.value = 'landing'
    return
  }
  // Stay on the page in the URL (refresh, or a link someone opened) when this role can see it
  const wanted = route.query.redirect ? router.resolve(String(route.query.redirect)) : route
  const view = wanted.meta.view
  if (view && view !== 'landing' && canOpenView(persona, view)) {
    currentView.value = view
    if (wanted.fullPath !== route.fullPath) router.replace(wanted.fullPath)
  } else {
    currentView.value = homeView(persona)
  }
}
 
// Handle Login from LandingLoginView (the password was already checked by authService)
function handleUserLogin(persona) {
  applySession(persona)
  toast.value = `Signed in as ${persona.name} (${persona.roleLabel})`
  toastType.value = 'success'
}
 
function handleGuestExplore() {
  applySession(enterGuest())
  toast.value = 'Browsing as a guest: you can view venues, but only signed-in ExCos can release or claim.'
  toastType.value = 'info'
}
 
// New ExCo finished sign-up (already signed in by authService)
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
  }
  applySession(persona)
  toast.value = `Welcome to Pulse, ${persona.name}! You're signed in as ${persona.roleLabel}.`
  toastType.value = 'success'
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
  // Clean enterprise light theme enforcement
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
    await loadSlots()
  } catch (error) {
    toastType.value = 'danger'
    toast.value = `Error loading facilities: ${error.message}`
  } finally {
    loading.value = false
  }
})
 
</script>
 
<template>
  <div>
    
    <!-- Checking for a saved session on page load -->
    <div v-if="!authReady" class="min-vh-100 d-flex align-items-center justify-content-center">
      <div class="spinner-border text-danger" role="status"></div>
    </div>
 
    <!-- ExCo sign-up (email must be on OSL's ExCo list) -->
    <SignUpView
      v-else-if="showSignUp && !isLoggedIn"
      @done="handleSignUpDone"
      @cancel="showSignUp = false"
    />
 
    <!-- View 0: Landing & Interactive Login Experience (Shown when logged out) -->
    <div v-else-if="!isLoggedIn || currentView === 'landing'">
      <LandingLoginView 
        @login="handleUserLogin"
        @explore="handleGuestExplore"
        @signup="showSignUp = true"
      />
    </div>
 
    <!-- Authenticated App Shell (All 5 views) -->
    <div v-else class="min-vh-100 d-flex flex-column" style="background-color: var(--pulse-bg);">
      
      <!-- Top Modern SaaS Header -->
      <header class="pulse-header px-3 px-lg-5 py-2">
        <div class="container-fluid d-flex flex-wrap justify-content-between align-items-center gap-2">
          
          <!-- Left: Logo & Community Switcher (Scoped per persona) -->
          <div class="d-flex align-items-center gap-3">
            <a href="#" class="pulse-brand-logo text-decoration-none" @click.prevent="router.push('/facilities')">
              <div class="pulse-logo-badge">
                <span>P</span>
                <span class="pulse-logo-dot"></span>
              </div>
              <span>Pulse</span>
            </a>
 
            <!-- Case A: Admin Mode -->
            <div v-if="isAdmin" class="badge bg-danger px-3 py-2" style="border-radius: 0.65rem; font-size: 0.75rem;">
              OSL Facility Administration
            </div>
 
            <!-- Case B: Dev Mode (All 24 CCAs Unlocked) -->
            <div v-else-if="isDev" class="d-flex align-items-center gap-2">
              <div class="input-group input-group-sm">
                <span class="input-group-text bg-white border-end-0 text-muted" style="border-radius: 0.65rem 0 0 0.65rem;">
                  <span style="font-size: 0.725rem; font-weight: 700; text-transform: uppercase; color: var(--pulse-purple-transit);">Dev Scope:</span>
                </span>
                <select 
                  id="clubSwitcher" 
                  v-model="selectedClub" 
                  class="form-select form-select-sm border-start-0 fw-bold" 
                  style="border-radius: 0 0.65rem 0.65rem 0; max-width: 190px;"
                  @change="toast = ''"
                >
                  <option v-for="club in ALL_CLUBS" :key="club" :value="club">{{ club }}</option>
                </select>
              </div>
              <span class="badge bg-purple text-white px-2 py-1 d-none d-xl-inline" style="background-color: var(--pulse-purple-transit); font-size: 0.65rem;">
                All 24 CCAs Unlocked
              </span>
            </div>
 
            <!-- Case C: Guest (View Only, no club to act for) -->
            <div v-else-if="isGuest" class="badge bg-light text-muted border px-3 py-2" style="border-radius: 0.65rem; font-size: 0.75rem;">
              Guest • View Only
            </div>
 
            <!-- Case D: Regular Club ExCo (Strictly Scoped to their CCA) -->
            <div v-else class="d-flex align-items-center">
              <div class="input-group input-group-sm">
                <span class="input-group-text bg-white border-end-0 text-muted" style="border-radius: 0.65rem 0 0 0.65rem;">
                  <span style="font-size: 0.725rem; font-weight: 700; text-transform: uppercase; color: var(--pulse-primary);">Club:</span>
                </span>
                <select 
                  id="clubSwitcher" 
                  v-model="selectedClub" 
                  class="form-select form-select-sm border-start-0 fw-bold" 
                  style="border-radius: 0 0.65rem 0.65rem 0; max-width: 180px;"
                  @change="toast = ''"
                >
                  <option v-for="club in allowedClubs" :key="club" :value="club">{{ club }}</option>
                </select>
              </div>
              <span class="badge bg-light text-muted border ms-2 px-2 py-1 d-none d-xl-inline" style="font-size: 0.65rem;">
                Scoped: {{ selectedClub }}
              </span>
            </div>
          </div>
 
          <!-- Center: Navigation Tabs (Role-tailored) -->
          <!-- OSL Admin View: Administrative Oversight & Governance -->
          <nav v-if="isAdmin" class="d-none d-lg-flex align-items-center gap-1">
            <button
              type="button"
              class="pulse-nav-pill"
              :class="{ active: currentView === 'facilities' && !isOslReviewRoute }"
              @click="router.push('/facilities')"
            >
              Master Facility Calendar
            </button>
            <button
              type="button"
              class="pulse-nav-pill"
              :class="{ active: isOslReviewRoute }"
              @click="router.push('/facilities/admin')"
            >
              OSL Review
            </button>
          </nav>
 
          <!-- Student ExCo View: Complete 5-Feature Operational Suite -->
          <nav v-else class="d-none d-lg-flex align-items-center gap-1">
            <button 
              type="button" 
              class="pulse-nav-pill" 
              :class="{ active: currentView === 'facilities' }"
              @click="currentView = 'facilities'"
            >
              Master Facility Calendar
            </button>
            <button 
              v-if="canOpenView(activePersona, 'schedule')"
              type="button" 
              class="pulse-nav-pill" 
              :class="{ active: currentView === 'schedule' }"
              @click="currentView = 'schedule'"
            >
              Personal Schedule
            </button>
            <button 
              v-if="canOpenView(activePersona, 'heatmap')"
              type="button" 
              class="pulse-nav-pill" 
              :class="{ active: currentView === 'heatmap' }"
              @click="currentView = 'heatmap'"
            >
              Availability Heatmap
            </button>
            <button 
              v-if="canOpenView(activePersona, 'operations')"
              type="button" 
              class="pulse-nav-pill" 
              :class="{ active: currentView === 'operations' }"
              @click="currentView = 'operations'"
            >
              Day-of Operations
            </button>
            <button 
              v-if="canOpenView(activePersona, 'risk')"
              type="button" 
              class="pulse-nav-pill" 
              :class="{ active: currentView === 'risk' }"
              @click="currentView = 'risk'"
            >
              Event Risk Planning
            </button>
          </nav>
 
          <!-- Right: Presentation Utility Bar (API Mode, Reset, Role & Sign Out) -->
          <div class="d-flex align-items-center gap-2 ms-auto flex-wrap justify-content-end">
            
            <!-- Reset Demo Button -->
            <button
              v-if="canResetDemo"
              type="button"
              class="btn btn-outline-danger btn-sm px-3 fw-bold rounded-pill"
              :disabled="isAutoRunning"
              @click="handleResetDemo"
            >
              Reset Demo
            </button>
 
            <!-- Toggle API Badges (Defaults to OFF; Toggleable for Pitch / Architecture review) -->
            <button
              type="button"
              class="btn btn-sm rounded-pill fw-bold d-flex align-items-center gap-1 pulse-api-toggle-btn"
              :class="apiMode ? 'pulse-api-active' : 'pulse-api-inactive'"
              title="Toggle API architecture tags across all views"
              @click="apiMode = !apiMode"
            >
              <span class="pulse-toggle-indicator" :class="{ active: apiMode }"></span>
              <span>APIs: {{ apiMode ? 'Visible' : 'Hidden' }}</span>
            </button>
 
            <!-- One bell for the whole site (Pip's "Open notifications" opens it too) -->
            <NotificationBell />
 
            <!-- Persona Switcher Dropdown (Pitch Presentation Helper) -->
            <div ref="profileMenu" class="position-relative">
              <button
                type="button"
                class="btn btn-pulse-outline btn-sm d-flex align-items-center gap-2 rounded-pill px-3 bg-white"
                :aria-expanded="profileMenuOpen"
                @click="profileMenuOpen = !profileMenuOpen"
              >
                <!-- Clean SVG User Icon (No Emoji) -->
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                  <circle cx="12" cy="7" r="4"></circle>
                </svg>
                <span class="fw-bold" style="font-size: 0.775rem;">
                  {{ activePersona.name }}
                </span>
                <span style="font-size: 0.65rem;">▼</span>
              </button>
 
              <div 
                v-if="profileMenuOpen" 
                class="card shadow-lg position-absolute end-0 mt-2 p-2 border-0" 
                style="min-width: 260px; z-index: 1050; border-radius: 0.85rem;"
              >
                <!-- Signed-in identity (everyone except Dev sees just this) -->
                <div v-if="!canSwitchPersona" class="p-2 border-bottom mb-2">
                  <div class="fw-bold" style="font-size: 0.825rem;">{{ activePersona.name }}</div>
                  <small class="text-muted d-block" style="font-size: 0.7rem;">{{ activePersona.roleLabel }}</small>
                  <small v-if="activePersona.email" class="text-muted d-block" style="font-size: 0.7rem;">{{ activePersona.email }}</small>
                </div>
 
                <!-- Dev only: switch persona for live demo -->
                <template v-if="canSwitchPersona">
                <div class="p-2 border-bottom mb-2 text-muted" style="font-size: 0.7rem; font-weight: 700; text-transform: uppercase;">
                  Switch Persona (Live Demo)
                </div>
 
                <!-- Option 1: Rachel Tan -->
                <button 
                  type="button" 
                  class="btn text-start mb-1 py-2 px-3 rounded-3" 
                  :class="activePersona.id === 'rachel' ? 'btn-light fw-bold text-danger' : 'btn-white'"
                  @click="switchPersona('rachel')"
                >
                  <div class="d-flex justify-content-between align-items-center">
                    <span>Rachel Tan</span>
                    <span class="badge bg-danger bg-opacity-10 text-danger" style="font-size: 0.65rem;">Eurhythmix</span>
                  </div>
                  <small class="text-muted" style="font-size: 0.7rem;">Release studio & manage crew ops</small>
                </button>
 
                <!-- Option 2: Darren Koh -->
                <button 
                  type="button" 
                  class="btn text-start mb-1 py-2 px-3 rounded-3" 
                  :class="activePersona.id === 'darren' ? 'btn-light fw-bold text-danger' : 'btn-white'"
                  @click="switchPersona('darren')"
                >
                  <div class="d-flex justify-content-between align-items-center">
                    <span>Darren Koh</span>
                    <span class="badge bg-warning bg-opacity-25 text-dark" style="font-size: 0.65rem;">Samba Masala</span>
                  </div>
                  <small class="text-muted" style="font-size: 0.7rem;">Claim studio & browse marketplace</small>
                </button>
 
                <!-- Option 3: Marcus Lim -->
                <button 
                  type="button" 
                  class="btn text-start mb-1 py-2 px-3 rounded-3" 
                  :class="activePersona.id === 'marcus' ? 'btn-light fw-bold text-danger' : 'btn-white'"
                  @click="switchPersona('marcus')"
                >
                  <div class="d-flex justify-content-between align-items-center">
                    <span>Marcus Lim</span>
                    <span class="badge bg-info bg-opacity-10 text-dark" style="font-size: 0.65rem;">Symphonia</span>
                  </div>
                  <small class="text-muted" style="font-size: 0.7rem;">Orchestra hall coordinator</small>
                </button>
 
                <!-- Option 4: Chloe Ang -->
                <button 
                  type="button" 
                  class="btn text-start mb-1 py-2 px-3 rounded-3" 
                  :class="activePersona.id === 'chloe' ? 'btn-light fw-bold text-danger' : 'btn-white'"
                  @click="switchPersona('chloe')"
                >
                  <div class="d-flex justify-content-between align-items-center">
                    <span>Chloe Ang</span>
                    <span class="badge bg-dark text-white" style="font-size: 0.65rem;">OSL Admin</span>
                  </div>
                  <small class="text-muted" style="font-size: 0.7rem;">Verify compliance & issue audit ticket</small>
                </button>
 
                <hr class="my-1">
                </template>
                <button 
                  type="button" 
                  class="btn btn-sm btn-link text-danger text-start px-3 py-1 text-decoration-none"
                  @click="handleSignOut"
                >
                  {{ isGuest ? 'Exit Guest Mode' : 'Sign Out to Landing' }}
                </button>
              </div>
            </div>
 
          </div>
 
        </div>
      </header>
 
      <!-- Main Content Area -->
      <main class="container-xl py-4 flex-grow-1">
        <div :class="{ 'pulse-pip-gutter': pipVisible }">
 
        <!-- Autopilot Banner -->
        <div v-if="isAutoRunning" class="alert alert-dark border-0 shadow-lg text-white mb-4 d-flex align-items-center justify-content-between p-3" style="border-radius: 1rem; background: linear-gradient(135deg, #1e1020, #2a1435);">
          <div class="d-flex align-items-center gap-3">
            <div class="spinner-grow spinner-grow-sm text-danger" role="status"></div>
            <div>
              <div class="fw-bold" style="font-size: 0.85rem;">Live Presentation Autopilot Active</div>
              <small class="text-white-50" style="font-size: 0.75rem;">{{ autoStepText }}</small>
            </div>
          </div>
          <span class="badge bg-danger rounded-pill px-3 py-2">Pitch Mode</span>
        </div>
 
        <!-- Global Toast Alert -->
        <div 
          v-if="toast" 
          class="alert alert-dismissible fade show shadow-sm mb-4" 
          :class="`alert-${toastType}`" 
          role="alert"
          style="border-radius: 0.85rem;"
        >
          <div class="d-flex align-items-center gap-2">
            <strong>Notice:</strong> {{ toast }}
          </div>
          <button type="button" class="btn-close" @click="toast = ''"></button>
        </div>
 
        <!-- Guest banner: every page is view-only -->
        <div v-if="isGuest" class="alert alert-light border d-flex flex-wrap justify-content-between align-items-center gap-2 py-2 mb-3" style="border-radius: 0.85rem; font-size: 0.8rem;">
          <span><strong>Guest view (read-only).</strong> You can browse every page, but only signed-in CCA ExCos can make changes.</span>
          <button type="button" class="btn btn-sm btn-pulse-primary rounded-pill px-3" @click="handleSignOut">Sign in</button>
        </div>
 
        <!-- VIEW 0: OSL Administrative Console (Chloe Ang - OSL Staff Advisor) -->
        <div v-show="currentView === 'admin'">
          <OslAdminView 
            :slots="slots" 
            :api-mode="apiMode" 
            @endorse-transfer="handleConfirm" 
            @reject-transfer="handleReject" 
          />
        </div>
 
        <!-- VIEW 1: Master Facility Calendar (routes /facilities, /facilities/my-club,
             /facilities/waitlist, /facilities/admin). The earlier inline facility_slots
             marketplace is replaced by this module. -->
        <div v-show="currentView === 'facilities'">
          <RouterView />
        </div>
 
        <!-- VIEW 2: Personal Schedule & Attendance -->
        <div v-show="currentView === 'schedule'">
          <PersonalScheduleView :api-mode="apiMode" :active-persona="activePersona" :read-only="isGuest" />
        </div>
 
        <!-- VIEW 3: Availability Heatmap -->
        <div v-show="currentView === 'heatmap'">
          <AvailabilityView :api-mode="apiMode" :read-only="isGuest" @meeting-scheduled="handleMeetingScheduled" />
        </div>
 
        <!-- VIEW 4: Day-of Operations & Multi-Track Timeline -->
        <div v-show="currentView === 'operations'">
          <OperationsView :api-mode="apiMode" :read-only="isGuest" />
        </div>
 
        <!-- VIEW 5: Event Risk Planning & What-If Simulator -->
        <div v-show="currentView === 'risk'">
          <EventRiskView :api-mode="apiMode" :read-only="isGuest" />
        </div>
 
        </div>
      </main>
 
      <!-- Pip watches notifications and waitlist offers on every page -->
      <PipMascot
        v-if="pipVisible"
        mode="notifications"
        :unanswered-count="unreadCount"
        :offer-seconds-left="soonestOfferSeconds"
        :is-static="notificationStore.pipStatic"
        @update:is-static="setPipStatic"
        :is-quiet="notificationStore.pipQuiet"
        @update:is-quiet="setPipQuiet"
        @open-notifications="openNotifications"
        @open-offer="openOffer"
      />
 
      <!-- Footer -->
      <footer class="py-3 border-top text-muted small bg-white mt-auto">
        <div class="container d-flex flex-wrap justify-content-between align-items-center gap-2">
          <div class="d-flex align-items-center gap-2 flex-wrap">
            <span class="fw-semibold text-dark">Singapore Management University</span>
            <span class="text-muted">•</span>
            <span>Office of Student Life (OSL)</span>
            <span class="text-muted">•</span>
            <span>SMU Students' Association (SMUSA)</span>
          </div>
          <div class="d-flex align-items-center gap-3 text-muted" style="font-size: 0.775rem;">
            <span>Pulse Co-Curricular & Arts Facilities Management</span>
            <span class="text-muted">•</span>
            <span>Connected to SMU OASIS</span>
          </div>
        </div>
      </footer>
 
    </div>
 
  </div>
</template>
 