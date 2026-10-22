<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';
import { facilityService, getStatusBadgeClass } from './services/facilityService';
import { DEMO_PERSONAS, ALL_CLUBS } from './services/authProfiles';
import LandingLoginView from './views/LandingLoginView.vue';
import AvailabilityView from './views/AvailabilityView.vue';
import OperationsView from './views/OperationsView.vue';
import EventRiskView from './views/EventRiskView.vue';
import PersonalScheduleView from './views/PersonalScheduleView.vue';
import OslAdminView from './views/OslAdminView.vue';
import { calculateWaitlistCutoff } from './services/smuClubsDirectory';

// App Views state
const currentView = ref('facilities') // 'landing', 'admin', 'facilities', 'schedule', 'heatmap', 'operations', 'risk'
const apiMode = ref(false) // Toggle API badge tags on/off across all views (Default: OFF as requested)
const isDarkMode = ref(false)
const notificationsOpen = ref(false)

const notificationsList = ref([
  {
    id: 1,
    type: 'swap',
    title: 'Facility Available for Swap',
    desc: 'Chinese Orchestra listed Studio L7.1 (Music) for Fri 16 Oct (16:00 - 19:00).',
    time: '5m ago',
    unread: true,
    badge: 'Marketplace'
  },
  {
    id: 2,
    type: 'transit',
    title: 'Transit Buffer Reminder',
    desc: 'Recommended departure to Main Hall Stage at 18:20 (8 min walk via Concourse).',
    time: '25m ago',
    unread: true,
    badge: 'OneMap API'
  },
  {
    id: 3,
    type: 'waitlist',
    title: 'Waitlist Priority Alert',
    desc: '2 CCAs are queued for Studio L7.2. Early release frees the room for waiting clubs.',
    time: '1h ago',
    unread: true,
    badge: 'Waitlist Alert'
  }
])

const unreadNotificationCount = computed(() => notificationsList.value.filter(n => n.unread).length)

function markAllNotificationsRead() {
  notificationsList.value.forEach(n => n.unread = false)
}

function initTheme() {
  const saved = localStorage.getItem('pulse_theme')
  if (saved === 'dark' || (!saved && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    isDarkMode.value = true
    document.body.classList.add('dark-mode')
  } else {
    isDarkMode.value = false
    document.body.classList.remove('dark-mode')
  }
}

function toggleDarkMode() {
  isDarkMode.value = !isDarkMode.value
  if (isDarkMode.value) {
    document.body.classList.add('dark-mode')
    localStorage.setItem('pulse_theme', 'dark')
  } else {
    document.body.classList.remove('dark-mode')
    localStorage.setItem('pulse_theme', 'light')
  }
}

const slots = ref([])
const loading = ref(true)
const processingId = ref(null)
const toast = ref('')
const toastType = ref('info')
const searchQuery = ref('')

// User & Role State with Strict CCA Scoping
const isLoggedIn = ref(true)
const activePersona = ref(DEMO_PERSONAS.rachel) // Defaults to Rachel Tan (Eurhythmix ExCo)
const selectedClub = ref('Eurhythmix')
const profileMenuOpen = ref(false)

const isAdmin = computed(() => activePersona.value.role === 'admin')
const isDev = computed(() => activePersona.value.isDev)
const allowedClubs = computed(() => activePersona.value.allowedClubs || ['Eurhythmix'])

// Dynamic Animated Search Placeholder (Robust Auto-Typing with restart on clear)
const searchPlaceholder = ref('Search venue or location...')
let searchTimer = null
let searchIndex = 0
let searchCharIndex = 0
let searchIsDeleting = false

function tickSearchPlaceholder() {
  if (searchQuery.value && searchQuery.value.length > 0) return

  const list = activePersona.value.smartSearches && activePersona.value.smartSearches.length 
    ? activePersona.value.smartSearches 
    : ['Studio L7.2', 'Dance Studio', 'Sprung Floor', 'Connexion', 'Sound Studio']
    
  const target = list[searchIndex % list.length] || 'Studio L7.2'

  if (!searchIsDeleting) {
    searchCharIndex++
    searchPlaceholder.value = `Try searching: "${target.substring(0, searchCharIndex)}"`
    if (searchCharIndex >= target.length) {
      searchIsDeleting = true
      searchTimer = setTimeout(tickSearchPlaceholder, 1800)
      return
    }
    searchTimer = setTimeout(tickSearchPlaceholder, 50)
  } else {
    searchCharIndex--
    searchPlaceholder.value = `Try searching: "${target.substring(0, searchCharIndex)}"`
    if (searchCharIndex <= 0) {
      searchIsDeleting = false
      searchIndex = (searchIndex + 1) % list.length
      searchTimer = setTimeout(tickSearchPlaceholder, 400)
      return
    }
    searchTimer = setTimeout(tickSearchPlaceholder, 30)
  }
}

function resetSearchPlaceholder() {
  if (searchTimer) clearTimeout(searchTimer)
  searchIndex = 0
  searchCharIndex = 0
  searchIsDeleting = false
  searchPlaceholder.value = 'Search venue or location...'
  searchTimer = setTimeout(tickSearchPlaceholder, 300)
}

// Watch searchQuery: if user clears or deletes their input, restart dynamic typewriter animation immediately
watch(searchQuery, (newVal) => {
  if (!newVal || newVal.length === 0) {
    resetSearchPlaceholder()
  }
})

watch(activePersona, () => {
  resetSearchPlaceholder()
})

// Facility Wishlist State (save facilities to receive alerts when freed or swapped)
const wishlistVenueIds = ref([2, 3]) // Pre-star Studio L7.1 and Studio L7.2 for demo

function isWishlisted(id) {
  return wishlistVenueIds.value.includes(id)
}

function toggleWishlist(slot) {
  const idx = wishlistVenueIds.value.indexOf(slot.id)
  if (idx > -1) {
    wishlistVenueIds.value.splice(idx, 1)
    toast.value = `Removed ${slot.venue_name} from your facility wishlist.`
    toastType.value = 'info'
  } else {
    wishlistVenueIds.value.push(slot.id)
    toast.value = `Added ${slot.venue_name} to your Wishlist. You will receive an instant notification when this facility becomes available.`
    toastType.value = 'success'
  }
}

function handleMeetingScheduled(meeting) {
  notificationsList.value.unshift({
    id: Date.now(),
    type: 'meeting',
    title: `New Meeting: ${meeting.title}`,
    desc: `${meeting.day} (${meeting.time}) at ${meeting.venue}. Default message and agenda dispatched to 12 ExCo members on Telegram.`,
    time: 'Just now',
    unread: true,
    badge: 'Telegram Broadcast'
  })
  toast.value = `Meeting scheduled! Telegram broadcast sent to team with agenda: "${meeting.title}"`
  toastType.value = 'success'
}

// Venue Category Filters
// OSL Facility Administrator oversees university-wide facilities and does not require a personal club wishlist
const categories = computed(() => {
  const list = [
    { label: 'All Venues', value: 'All' },
  ]
  if (selectedClub.value !== 'Office of Student Life') {
    list.push({ label: 'Wishlist', value: 'Wishlist' })
  }
  list.push(
    { label: 'Dance Studios', value: 'Dance Studio' },
    { label: 'Acoustic Rooms', value: 'Acoustic Room' },
    { label: 'Sports Courts', value: 'Sports Court' },
    { label: 'Multi-Purpose', value: 'Multi-Purpose' }
  )
  return list
})
const selectedCategory = ref('All')

watch(selectedClub, (newClub) => {
  if (newClub === 'Office of Student Life' && selectedCategory.value === 'Wishlist') {
    selectedCategory.value = 'All'
  }
})

function getCategoryCount(catValue) {
  if (catValue === 'All') return slots.value.length
  if (catValue === 'Wishlist') return wishlistVenueIds.value.length
  return slots.value.filter(s => s.venue_type === catValue).length
}

const filteredSlots = computed(() => {
  return slots.value.filter((slot) => {
    let matchesCategory = true
    if (selectedCategory.value === 'Wishlist') {
      matchesCategory = wishlistVenueIds.value.includes(slot.id)
    } else if (selectedCategory.value !== 'All') {
      matchesCategory = slot.venue_type === selectedCategory.value
    }
    const query = searchQuery.value.trim().toLowerCase()
    const matchesSearch = !query || 
      slot.venue_name.toLowerCase().includes(query) ||
      slot.building_location.toLowerCase().includes(query) ||
      slot.owner_club.toLowerCase().includes(query) ||
      slot.venue_type.toLowerCase().includes(query)
    return matchesCategory && matchesSearch
  })
})

function switchPersona(personaKey) {
  const p = DEMO_PERSONAS[personaKey]
  if (!p) return
  activePersona.value = p
  selectedClub.value = p.cca
  profileMenuOpen.value = false
  searchQuery.value = ''
  
  if (p.role === 'admin') {
    currentView.value = 'admin'
  } else if (currentView.value === 'admin') {
    currentView.value = 'facilities'
  }

  toast.value = `Switched perspective to ${p.name} (${p.roleLabel})`
  toastType.value = 'info'
}

async function loadSlots() {
  const res = await facilityService.getSlots()
  slots.value = res.data || []
}

async function handleAction(slot, action, message) {
  if (processingId.value !== null) return
  processingId.value = slot.id
  try {
    const result = await action()
    if (!result.success || !result.data) throw new Error('Unable to update facility')
    await loadSlots()
    toastType.value = 'success'
    toast.value = message
  } catch (error) {
    toastType.value = 'danger'
    toast.value = `Error: ${error.message}`
  } finally {
    processingId.value = null
  }
}

async function handleRelease(slot) {
  await handleAction(
    slot,
    () => facilityService.releaseSlot(slot.id, selectedClub.value),
    `${slot.venue_name} released to campus marketplace >48h in advance! Zero demerit points logged under SSU Clause 9.1(c).`
  )
  // Check if any clubs have wishlisted this facility
  if (wishlistVenueIds.value.includes(slot.id)) {
    notificationsList.value.unshift({
      id: Date.now(),
      type: 'wishlist',
      title: `Wishlist Alert: ${slot.venue_name} Freed`,
      desc: `A facility on your watchlist (${slot.venue_name}) was just released to the marketplace by ${slot.owner_club}! Ready for peer swap.`,
      time: 'Just now',
      unread: true,
      badge: 'Wishlist Alert'
    })
  }
}

async function handleConfirm(slot) {
  await handleAction(
    slot,
    () => facilityService.confirmPeerTransfer(slot.id),
    `${slot.venue_name} transfer verified and officially confirmed by OSL Admin!`
  )
}

async function handleClaim(slot) {
  await handleAction(
    slot,
    () => facilityService.claimSlot(slot.id, selectedClub.value),
    `Claim submitted for ${slot.venue_name}! Awaiting OSL Admin approval.`
  )
}

async function handleUndo(slot) {
  await handleAction(
    slot,
    () => facilityService.undoRelease(slot.id, selectedClub.value),
    `${slot.venue_name} release undone. Booking restored to ${selectedClub.value}.`
  )
}

async function handleReject(slot) {
  await handleAction(
    slot,
    () => facilityService.rejectPeerTransfer(slot.id),
    `${slot.venue_name} claim rejected; slot remains available on marketplace.`
  )
}

function getPulseStatusLabel(slot) {
  if (slot.status === 'Proposed Peer Transfer') {
    return 'Available for Swap'
  }
  if (slot.status === 'Pending Admin Sign-off') {
    return 'Awaiting OSL Approval'
  }
  if (slot.status === 'Officially Confirmed') {
    return 'Booked (OSL Endorsed)'
  }
  if (slot.status === 'Booked') {
    return slot.owner_club === selectedClub.value ? 'Your Booking' : 'Reserved'
  }
  return slot.status
}

function getPulseStatusClass(slot) {
  switch (slot.status) {
    case 'Officially Confirmed':
      return 'pulse-status-confirmed'
    case 'Proposed Peer Transfer':
      return 'pulse-status-released'
    case 'Pending Admin Sign-off':
      return 'pulse-status-pending'
    case 'Booked':
    default:
      return slot.owner_club === selectedClub.value
        ? 'pulse-status-my-booking'
        : 'pulse-status-reserved-other'
  }
}

function handleJoinWaitlist(slot) {
  toastType.value = 'success'
  const cutoff = calculateWaitlistCutoff(slot.time_slot)
  toast.value = `Waitlist entry registered for ${slot.venue_name}! If ${slot.owner_club} releases this slot before ${cutoff.cutoffText}, you will receive a priority claim alert. Protected from unattended demerits.`
}

function getVenueAmenities(slot) {
  if (slot.venue_type === 'Dance Studio') {
    return ['Sprung Floor', 'Full Mirrors', 'Audio AUX']
  }
  if (slot.venue_type === 'Acoustic Room') {
    return ['Soundproofed', 'Acoustic Panels', 'Audio AUX']
  }
  if (slot.venue_type === 'Sports Court') {
    return ['Shock Absorbent Floor', 'Audio AUX']
  }
  return ['Air Conditioned', 'AV System']
}

function getWaitlistCount(slot) {
  if (slot.id === 3) return 2
  if (slot.id === 1) return 1
  return 0
}

// Autopilot Pitch Demonstration
const isAutoRunning = ref(false)
const autoStepText = ref('')

async function runDemoSimulation() {
  if (isAutoRunning.value) return
  isAutoRunning.value = true
  currentView.value = 'facilities'
  
  try {
    autoStepText.value = 'Resetting demo data in Supabase...'
    await facilityService.resetData()
    await loadSlots()
    switchPersona('rachel')
    
    await new Promise(r => setTimeout(r, 800))
    autoStepText.value = 'Step 1: Eurhythmix releases Studio L7.2...'
    const slot3 = slots.value.find(s => s.id === 3)
    if (slot3) await handleRelease(slot3)
    
    await new Promise(r => setTimeout(r, 1200))
    autoStepText.value = 'Step 2: Switching to Darren (Samba Masala) to claim slot...'
    switchPersona('darren')
    await new Promise(r => setTimeout(r, 600))
    const releasedSlot = slots.value.find(s => s.id === 3)
    if (releasedSlot) await handleClaim(releasedSlot)
    
    await new Promise(r => setTimeout(r, 1200))
    autoStepText.value = 'Step 3: Chloe (OSL Admin) confirms compliance and issues audit pass...'
    switchPersona('chloe')
    await new Promise(r => setTimeout(r, 600))
    const pendingSlot = slots.value.find(s => s.id === 3)
    if (pendingSlot) await handleConfirm(pendingSlot)
    
    autoStepText.value = 'Live Demo Complete! Officially Confirmed with Audit Pass ACF-2027-HASH8.'
    await new Promise(r => setTimeout(r, 2000))
  } finally {
    isAutoRunning.value = false
    autoStepText.value = ''
  }
}

// Handle Login from LandingLoginView
function handleUserLogin(authData) {
  if (authData.personaId && DEMO_PERSONAS[authData.personaId]) {
    activePersona.value = DEMO_PERSONAS[authData.personaId]
  } else {
    const lower = (authData.email || '').toLowerCase()
    if (lower.includes('darren') || lower.includes('samba')) activePersona.value = DEMO_PERSONAS.darren
    else if (lower.includes('marcus') || lower.includes('symphonia')) activePersona.value = DEMO_PERSONAS.marcus
    else if (lower.includes('chloe') || lower.includes('admin') || lower.includes('osl')) activePersona.value = DEMO_PERSONAS.chloe
    else if (lower.includes('dev')) activePersona.value = DEMO_PERSONAS.dev
    else if (lower.includes('john')) activePersona.value = DEMO_PERSONAS.john
    else activePersona.value = DEMO_PERSONAS.rachel
  }
  selectedClub.value = activePersona.value.cca
  isLoggedIn.value = true
  currentView.value = activePersona.value.role === 'admin' ? 'admin' : 'facilities'
  toast.value = `Signed in as ${activePersona.value.name} (${activePersona.value.roleLabel})`
  toastType.value = 'success'
}

function handleGuestExplore() {
  switchPersona('john')
  isLoggedIn.value = true
  currentView.value = 'facilities'
}

function handleSignOut() {
  isLoggedIn.value = false
  currentView.value = 'landing'
}

onMounted(async () => {
  try {
    initTheme()
    await loadSlots()
    searchTimer = setTimeout(tickSearchPlaceholder, 1000)
  } catch (error) {
    toastType.value = 'danger'
    toast.value = `Error loading facilities: ${error.message}`
  } finally {
    loading.value = false
  }
})

onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer)
})
</script>

<template>
  <div>
    
    <!-- View 0: Landing & Interactive Login Experience (Shown when logged out) -->
    <div v-if="!isLoggedIn || currentView === 'landing'">
      <LandingLoginView 
        @login="handleUserLogin"
        @explore="handleGuestExplore"
      />
    </div>

    <!-- Authenticated App Shell (All 5 views) -->
    <div v-else class="min-vh-100 d-flex flex-column" style="background-color: var(--pulse-bg);">
      
      <!-- Top Modern SaaS Header -->
      <header class="pulse-header px-3 px-lg-5 py-2">
        <div class="container-fluid d-flex flex-wrap justify-content-between align-items-center gap-2">
          
          <!-- Left: Logo & Community Switcher (Scoped per persona) -->
          <div class="d-flex align-items-center gap-3">
            <a href="#" class="pulse-brand-logo text-decoration-none" @click.prevent="currentView = isAdmin ? 'admin' : 'facilities'">
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

            <!-- Case C: Regular Club ExCo (Strictly Scoped to their CCA) -->
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
              :class="{ active: currentView === 'admin' }"
              @click="currentView = 'admin'"
            >
              OSL Approvals & Compliance
            </button>
            <button 
              type="button" 
              class="pulse-nav-pill" 
              :class="{ active: currentView === 'facilities' }"
              @click="currentView = 'facilities'"
            >
              Master Facility Calendar
            </button>
            <button 
              type="button" 
              class="pulse-nav-pill" 
              :class="{ active: currentView === 'heatmap' }"
              @click="currentView = 'heatmap'"
            >
              Campus Demand Heatmap
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
              type="button" 
              class="pulse-nav-pill" 
              :class="{ active: currentView === 'schedule' }"
              @click="currentView = 'schedule'"
            >
              Personal Schedule
            </button>
            <button 
              type="button" 
              class="pulse-nav-pill" 
              :class="{ active: currentView === 'heatmap' }"
              @click="currentView = 'heatmap'"
            >
              Availability Heatmap
            </button>
            <button 
              type="button" 
              class="pulse-nav-pill" 
              :class="{ active: currentView === 'operations' }"
              @click="currentView = 'operations'"
            >
              Day-of Operations
            </button>
            <button 
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
              type="button"
              class="btn btn-outline-danger btn-sm px-3 fw-bold rounded-pill"
              :disabled="isAutoRunning"
              @click="facilityService.resetData().then(() => { loadSlots(); toast = 'Database reset to initial seeds!'; toastType = 'info'; })"
            >
              Reset Demo
            </button>

            <!-- 1-Click Pitch Autopilot Simulation -->
            <button
              type="button"
              class="btn btn-pulse-primary btn-sm px-3 rounded-pill d-none d-sm-inline-flex align-items-center gap-1"
              :disabled="isAutoRunning"
              @click="runDemoSimulation"
            >
              <span v-if="isAutoRunning" class="spinner-border spinner-border-sm" role="status"></span>
              <span v-else>Autopilot Demo</span>
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

            <!-- Dark Mode Toggle Button (Requested by Teammate) -->
            <button
              type="button"
              class="btn btn-sm btn-pulse-outline rounded-pill px-2 py-1 bg-white d-flex align-items-center gap-1"
              :title="isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'"
              @click="toggleDarkMode"
            >
              <!-- Sun Icon when in Dark Mode -->
              <svg v-if="isDarkMode" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="5"></circle>
                <line x1="12" y1="1" x2="12" y2="3"></line>
                <line x1="12" y1="21" x2="12" y2="23"></line>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                <line x1="1" y1="12" x2="3" y2="12"></line>
                <line x1="21" y1="12" x2="23" y2="12"></line>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
              </svg>
              <!-- Moon Icon when in Light Mode -->
              <svg v-else width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
              </svg>
              <span class="small fw-bold d-none d-md-inline" style="font-size: 0.725rem;">
                {{ isDarkMode ? 'Light' : 'Dark' }}
              </span>
            </button>

            <!-- Centralized Notification Bell (Anchored safely on right, zero clipping) -->
            <div class="position-relative pulse-notification-wrapper">
              <button
                type="button"
                class="btn btn-sm btn-pulse-outline position-relative rounded-pill px-2 py-1 bg-white d-flex align-items-center"
                aria-label="Notifications"
                @click="notificationsOpen = !notificationsOpen; profileMenuOpen = false"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                  <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                </svg>
                <span 
                  v-if="unreadNotificationCount > 0" 
                  class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger"
                  style="font-size: 0.575rem; padding: 0.2em 0.4em;"
                >
                  {{ unreadNotificationCount }}
                </span>
              </button>

              <!-- Centralized Notification Dropdown Panel -->
              <div 
                v-if="notificationsOpen"
                class="card shadow-lg p-0 border-0 pulse-notification-panel"
                style="z-index: 1060; border-radius: 1rem; overflow: hidden;"
              >
                <div class="p-3 border-bottom d-flex justify-content-between align-items-center bg-light">
                  <div class="d-flex align-items-center gap-2">
                    <span class="fw-bold" style="font-size: 0.85rem;">Centralized Alerts</span>
                    <span class="badge bg-danger rounded-pill" style="font-size: 0.65rem;">
                      {{ unreadNotificationCount }} new
                    </span>
                  </div>
                  <button 
                    v-if="unreadNotificationCount > 0"
                    type="button" 
                    class="btn btn-link btn-sm p-0 text-decoration-none text-muted"
                    style="font-size: 0.7rem;"
                    @click="markAllNotificationsRead"
                  >
                    Mark all read
                  </button>
                </div>

                <div class="p-2" style="max-height: 320px; overflow-y: auto;">
                  <div 
                    v-for="item in notificationsList" 
                    :key="item.id"
                    class="p-2 mb-1 rounded-3 transition-all"
                    :class="item.unread ? 'bg-danger bg-opacity-10 border border-danger-subtle' : 'bg-transparent'"
                  >
                    <div class="d-flex justify-content-between align-items-start gap-1 mb-1">
                      <span class="fw-bold" style="font-size: 0.775rem;">{{ item.title }}</span>
                      <span class="badge bg-secondary bg-opacity-10 text-secondary" style="font-size: 0.6rem;">{{ item.time }}</span>
                    </div>
                    <p class="mb-1 text-muted" style="font-size: 0.725rem; line-height: 1.35;">{{ item.desc }}</p>
                    <div class="d-flex justify-content-between align-items-center mt-1">
                      <span class="badge bg-purple text-white" style="font-size: 0.6rem; background-color: var(--pulse-purple-transit);">
                        {{ item.badge }}
                      </span>
                      <button 
                        type="button" 
                        class="btn btn-link btn-sm p-0 text-danger text-decoration-none fw-semibold"
                        style="font-size: 0.675rem;"
                        @click="item.unread = false; notificationsOpen = false"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Persona Switcher Dropdown (Pitch Presentation Helper) -->
            <div class="position-relative">
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

                <!-- Option 5: Dev Mode -->
                <button 
                  type="button" 
                  class="btn text-start mb-1 py-2 px-3 rounded-3" 
                  :class="activePersona.id === 'dev' ? 'btn-light fw-bold text-purple' : 'btn-white'"
                  @click="switchPersona('dev')"
                >
                  <div class="d-flex justify-content-between align-items-center">
                    <span>Dev View</span>
                    <span class="badge bg-purple text-white" style="background-color: var(--pulse-purple-transit); font-size: 0.65rem;">All 24 CCAs</span>
                  </div>
                  <small class="text-muted" style="font-size: 0.7rem;">Full administrative test view</small>
                </button>

                <hr class="my-1">
                <button 
                  type="button" 
                  class="btn btn-sm btn-link text-danger text-start px-3 py-1 text-decoration-none"
                  @click="handleSignOut"
                >
                  Sign Out to Landing
                </button>
              </div>
            </div>

          </div>

        </div>
      </header>

      <!-- Main Content Area -->
      <main class="container-xl py-4 flex-grow-1">

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

        <!-- VIEW 0: OSL Administrative Console (Chloe Ang - OSL Staff Advisor) -->
        <div v-show="currentView === 'admin'">
          <OslAdminView 
            :slots="slots" 
            :api-mode="apiMode" 
            @endorse-transfer="handleConfirm" 
            @reject-transfer="handleReject" 
          />
        </div>

        <!-- VIEW 1: Master Facility Calendar (Default view for Playwright & live demo) -->
        <div v-show="currentView === 'facilities'">
          
          <!-- Hero Banner -->
          <section class="pulse-hero-banner mb-4">
            <div class="row align-items-center g-3">
              <div class="col-lg-8">
                <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
                  <span class="badge bg-danger rounded-pill px-3 py-1" style="font-size: 0.7rem; font-weight: 800; letter-spacing: 0.05em;">SMU FACILITIES</span>
                  <span v-if="apiMode" class="pulse-api-tag">Supabase PostgreSQL</span>
                  <span v-if="apiMode" class="pulse-api-tag">Cloudinary Upload API</span>
                </div>
                <!-- REQUIRED HEADING FOR PLAYWRIGHT TEST 100% PASS -->
                <h2 class="display-6 fw-bold mb-2 text-white">Pulse - Master Facility Calendar</h2>
                <p class="text-white-50 mb-0" style="font-size: 0.9rem; max-width: 620px;">
                  Unified campus logistics platform resolving facility scarcity, timetable clashes, and administrative compliance across student organizations and OSL.
                </p>
              </div>
              <div class="col-lg-4 text-lg-end">
                <div class="d-inline-flex flex-wrap gap-2 justify-content-lg-end">
                  <div class="bg-white bg-opacity-10 rounded-3 p-2 text-center" style="min-width: 90px;">
                    <div class="fw-bold text-white fs-5">6</div>
                    <div class="text-white-50" style="font-size: 0.65rem; text-transform: uppercase;">Venues</div>
                  </div>
                  <div class="bg-white bg-opacity-10 rounded-3 p-2 text-center" style="min-width: 90px;">
                    <div class="fw-bold text-white fs-5">1</div>
                    <div class="text-white-50" style="font-size: 0.65rem; text-transform: uppercase;">Active Swap</div>
                  </div>
                  <div class="bg-white bg-opacity-10 rounded-3 p-2 text-center" style="min-width: 90px;">
                    <div class="fw-bold text-white fs-5">100%</div>
                    <div class="text-white-50" style="font-size: 0.65rem; text-transform: uppercase;">Compliant</div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- Search & Filters with Dynamic Typing Placeholder & Smart Suggestions -->
          <section class="card border-0 shadow-sm p-3 mb-4" style="border-radius: 1rem; background-color: var(--pulse-card-bg);">
            <div class="row g-3 align-items-center justify-content-between">
              
              <!-- Venue Category Pills -->
              <div class="col-12 col-md-auto">
                <div class="d-flex flex-wrap gap-1">
                  <button
                    v-for="cat in categories"
                    :key="cat.value"
                    type="button"
                    class="pulse-filter-pill"
                    :class="{ active: selectedCategory === cat.value }"
                    @click="selectedCategory = cat.value"
                  >
                    {{ cat.label }} ({{ getCategoryCount(cat.value) }})
                  </button>
                </div>
              </div>

              <!-- Search Input with Dynamic Animated Placeholder & Blinking Cursor -->
              <div class="col-12 col-md-6 col-lg-5">
                <div class="input-group input-group-sm">
                  <span class="input-group-text border-end-0 text-muted" style="border-radius: 9999px 0 0 9999px; background-color: var(--pulse-bg);">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <circle cx="11" cy="11" r="8"></circle>
                      <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    </svg>
                  </span>
                  <input 
                    v-model="searchQuery" 
                    type="text" 
                    class="form-control border-start-0" 
                    :placeholder="searchQuery.length ? '' : searchPlaceholder"
                    style="border-radius: 0 9999px 9999px 0; background-color: var(--pulse-bg);"
                  />
                  <button 
                    v-if="searchQuery" 
                    type="button" 
                    class="btn btn-sm border-start-0 text-muted"
                    style="border-radius: 0 9999px 9999px 0; background-color: var(--pulse-bg);"
                    @click="searchQuery = ''"
                  >
                    ✕
                  </button>
                </div>
              </div>

            </div>

            <!-- Smart Suggestion Chips tailored to Active Persona -->
            <div class="d-flex flex-wrap align-items-center gap-1 mt-2 pt-2 border-top">
              <span class="text-muted small fw-bold" style="font-size: 0.675rem; text-transform: uppercase;">
                Suggested for {{ selectedClub }}:
              </span>
              <button 
                v-for="chip in activePersona.smartSearches" 
                :key="chip"
                type="button" 
                class="btn btn-sm py-0 px-2 rounded-pill border"
                :class="searchQuery === chip ? 'btn-danger text-white' : 'btn-light text-muted'"
                style="font-size: 0.675rem;"
                @click="searchQuery = searchQuery === chip ? '' : chip"
              >
                {{ chip }}
              </button>
            </div>
          </section>

          <!-- Loading Spinner -->
          <div v-if="loading" class="text-center py-5">
            <div class="spinner-border text-danger" role="status"></div>
            <p class="text-muted mt-2 fw-bold" style="font-size: 0.85rem;">Connecting to Supabase Cloud Database...</p>
          </div>

          <!-- Empty State -->
          <div v-else-if="!filteredSlots.length" class="text-center py-5 card border-0 shadow-sm" style="border-radius: 1rem; background-color: var(--pulse-card-bg);">
            <div v-if="selectedCategory === 'Wishlist'" class="py-3 px-3">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-warning mb-3">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
              </svg>
              <h6 class="fw-bold mb-2">Your Facility Wishlist is Empty</h6>
              <p class="text-muted small mb-3 mx-auto" style="max-width: 420px;">
                Bookmark rehearsal studios or acoustic rooms using the Wishlist button in All Venues to receive automated notifications the moment a slot is released or proposed for peer transfer.
              </p>
              <button type="button" class="btn btn-sm btn-pulse-primary" @click="selectedCategory = 'All'; searchQuery = ''">
                Browse All Venues
              </button>
            </div>
            <div v-else class="py-3">
              <p class="text-muted my-3">No facility slots found matching your criteria.</p>
              <button type="button" class="btn btn-sm btn-pulse-outline" @click="selectedCategory = 'All'; searchQuery = ''">
                Reset Filters
              </button>
            </div>
          </div>

          <!-- Facility Grid: REQUIRED (.row > .col-md-6.mb-3) PRESERVED 100% -->
          <div v-else class="row">
            <div v-for="slot in filteredSlots" :key="slot.id" class="col-md-6 mb-3">
              
              <div class="pulse-card h-100 d-flex flex-column">
                
                <div class="pulse-card-header d-flex justify-content-between align-items-start gap-2">
                  <div>
                    <div class="d-flex align-items-center gap-2 mb-1">
                      <h5 class="fw-bold mb-0 pulse-card-title" style="font-size: 1.05rem;">{{ slot.venue_name }}</h5>
                      <span class="pulse-tag">{{ slot.venue_type }}</span>

                      <!-- Facility Wishlist Toggle Button (Student CCAs only - OSL Admin does not have a club wishlist) -->
                      <button 
                        v-if="!isAdmin"
                        type="button" 
                        class="btn btn-sm py-0 px-2 rounded-pill border d-inline-flex align-items-center gap-1 pulse-wishlist-btn"
                        :class="isWishlisted(slot.id) ? 'active' : 'text-muted'"
                        :title="isWishlisted(slot.id) ? 'In Wishlist (Click to remove)' : 'Add to Wishlist for Release Alerts'"
                        @click.stop="toggleWishlist(slot)"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" :fill="isWishlisted(slot.id) ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2">
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                        </svg>
                        <span class="fw-semibold" style="font-size: 0.675rem;">
                          {{ isWishlisted(slot.id) ? 'Wishlisted' : 'Wishlist' }}
                        </span>
                      </button>
                    </div>
                    <div class="text-muted small d-flex align-items-center gap-1">
                      <!-- SVG Map Pin -->
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                        <circle cx="12" cy="10" r="3"></circle>
                      </svg>
                      <span>{{ slot.building_location }}</span>
                    </div>
                  </div>

                  <span :class="['pulse-status', getPulseStatusClass(slot)]">
                    <span class="pulse-status-dot"></span>
                    <span>{{ getPulseStatusLabel(slot) }}</span>
                  </span>
                </div>

                <div class="pulse-card-body flex-grow-1">
                  
                  <div class="d-flex flex-wrap gap-1 mb-3">
                    <span v-for="tag in getVenueAmenities(slot)" :key="tag" class="pulse-tag pulse-tag-amenity">
                      {{ tag }}
                    </span>
                    <span 
                      v-if="slot.building_location.includes('Connexion') || slot.building_location.includes('Level 7')" 
                      class="pulse-tag pulse-tag-transit"
                      title="ACF Standing Orders: SICO risers cannot be manually pushed across campus roads. Courier transport required from LKS store."
                    >
                      LKS Store Delivery Rule
                    </span>
                  </div>

                  <div class="p-3 rounded-3 mb-3 pulse-meta-box">
                    <div class="d-flex justify-content-between align-items-center mb-2">
                      <span class="text-muted small fw-semibold d-flex align-items-center gap-1">
                        <!-- SVG Calendar -->
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                          <line x1="16" y1="2" x2="16" y2="6"></line>
                          <line x1="8" y1="2" x2="8" y2="6"></line>
                          <line x1="3" y1="10" x2="21" y2="10"></line>
                        </svg>
                        Schedule:
                      </span>
                      <span class="fw-bold small pulse-meta-val">Friday, 16 Oct • {{ slot.time_slot }}</span>
                    </div>

                    <div class="d-flex justify-content-between align-items-center mb-1">
                      <span class="text-muted small fw-semibold">FBS Reference:</span>
                      <span class="font-monospace small text-primary fw-bold">{{ slot.fbs_ref || 'BK-20271016-000012' }}</span>
                    </div>

                    <div class="d-flex justify-content-between align-items-center mb-1">
                      <span class="text-muted small fw-semibold">Owner Club:</span>
                      <span class="badge border fw-bold pulse-owner-badge">{{ slot.owner_club }}</span>
                    </div>

                    <div v-if="slot.claiming_club" class="d-flex justify-content-between align-items-center mb-1">
                      <span class="text-muted small fw-semibold">Claiming Club:</span>
                      <span class="badge bg-warning bg-opacity-25 text-dark border border-warning fw-bold">
                        {{ slot.claiming_club }}
                      </span>
                    </div>

                    <div v-if="slot.audit_ticket_id" class="d-flex justify-content-between align-items-center mt-2 pt-2 border-top">
                      <span class="text-muted small fw-semibold">Audit Ticket:</span>
                      <span class="pulse-audit-ticket">
                        {{ slot.audit_ticket_id }}
                      </span>
                    </div>

                    <!-- Dual-Stage OSL Verification Endorsement Stamp -->
                    <div v-if="slot.status === 'Officially Confirmed'" class="d-flex align-items-center justify-content-between mt-2 pt-2 border-top text-success small" style="font-size: 0.72rem;">
                      <span class="fw-bold d-flex align-items-center gap-1">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                        <span>OSL Approved Transfer</span>
                      </span>
                      <span class="badge bg-success-subtle text-success border border-success">
                        FBS Endorsed
                      </span>
                    </div>

                    <!-- SSU Clause 9.1(c) 48-Hour Advance Notice Indicator on Owned Slots -->
                    <div v-if="!isAdmin && (slot.status === 'Booked' || slot.status === 'Officially Confirmed') && slot.owner_club === selectedClub" class="mt-2 pt-2 border-top">
                      <div class="d-flex align-items-center justify-content-between text-success small" style="font-size: 0.72rem;">
                        <span class="fw-semibold">SSU 9.1(c):</span>
                        <span class="badge bg-success-subtle text-success border border-success">
                          >48h Release Window (Zero Demerit Risk)
                        </span>
                      </div>
                    </div>

                    <!-- Waitlist Cutoff Timer Badge -->
                    <div class="d-flex justify-content-between align-items-center mt-2 pt-2 border-top" style="font-size: 0.72rem;">
                      <span class="text-muted">Waitlist Cutoff:</span>
                      <span class="badge bg-light text-secondary border">
                        {{ calculateWaitlistCutoff(slot.time_slot).cutoffText }}
                      </span>
                    </div>
                  </div>

                  <div v-if="getWaitlistCount(slot) > 0 && slot.status === 'Booked'" class="d-flex align-items-center gap-2 p-2 rounded-2 mb-2 bg-rose-50 border border-danger-subtle text-danger small">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <circle cx="12" cy="12" r="10"></circle>
                      <polyline points="12 6 12 12 16 14"></polyline>
                    </svg>
                    <span style="font-size: 0.75rem; font-weight: 600;">
                      <strong>{{ getWaitlistCount(slot) }} CCAs</strong> on waitlist (Cutoff: {{ calculateWaitlistCutoff(slot.time_slot).cutoffText }}). Releasing >48h frees room and avoids demerits.
                    </span>
                  </div>
                </div>

                <div class="pulse-card-footer d-flex flex-wrap gap-2 justify-content-end align-items-center">
                  
                  <button
                    v-if="!isAdmin && (slot.status === 'Booked' || slot.status === 'Officially Confirmed') && slot.owner_club === selectedClub"
                    class="btn btn-pulse-primary btn-sm"
                    :disabled="processingId !== null || isAutoRunning"
                    @click="handleRelease(slot)"
                  >
                    <span v-if="processingId === slot.id" class="spinner-border spinner-border-sm me-1" role="status"></span>
                    Release to Marketplace
                  </button>

                  <button
                    v-if="!isAdmin && slot.status === 'Proposed Peer Transfer' && slot.owner_club === selectedClub"
                    class="btn btn-pulse-outline btn-sm"
                    :disabled="processingId !== null || isAutoRunning"
                    @click="handleUndo(slot)"
                  >
                    <span v-if="processingId === slot.id" class="spinner-border spinner-border-sm me-1" role="status"></span>
                    Undo Release
                  </button>

                  <button
                    v-if="!isAdmin && slot.status === 'Proposed Peer Transfer' && slot.owner_club !== selectedClub"
                    class="btn btn-pulse-primary btn-sm"
                    :disabled="processingId !== null || isAutoRunning"
                    @click="handleClaim(slot)"
                  >
                    <span v-if="processingId === slot.id" class="spinner-border spinner-border-sm me-1" role="status"></span>
                    Claim Facility
                  </button>

                  <button
                    v-if="isAdmin && slot.status === 'Pending Admin Sign-off'"
                    class="btn btn-pulse-success btn-sm"
                    :disabled="processingId !== null || isAutoRunning"
                    @click="handleConfirm(slot)"
                  >
                    <span v-if="processingId === slot.id" class="spinner-border spinner-border-sm me-1" role="status"></span>
                    Confirm Transfer
                  </button>

                  <button
                    v-if="isAdmin && slot.status === 'Pending Admin Sign-off'"
                    class="btn btn-outline-danger btn-sm"
                    :disabled="processingId !== null || isAutoRunning"
                    @click="handleReject(slot)"
                  >
                    <span v-if="processingId === slot.id" class="spinner-border spinner-border-sm me-1" role="status"></span>
                    Reject Transfer
                  </button>

                  <!-- Join Waitlist Action Button (Replaces redundant "Held by" text) -->
                  <button 
                    v-if="!isAdmin && slot.status === 'Booked' && slot.owner_club !== selectedClub"
                    type="button"
                    class="btn btn-outline-secondary btn-sm rounded-pill d-inline-flex align-items-center gap-1"
                    style="font-size: 0.75rem;"
                    @click="handleJoinWaitlist(slot)"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                      <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                    </svg>
                    <span>Join Waitlist</span>
                  </button>

                  <span 
                    v-if="!isAdmin && slot.status === 'Pending Admin Sign-off'"
                    class="badge bg-light text-muted border small"
                    style="font-size: 0.725rem;"
                  >
                    Awaiting OSL Admin Verification
                  </span>
                </div>

              </div>
            </div>
          </div>

        </div>

        <!-- VIEW 2: Personal Schedule & Attendance -->
        <div v-show="currentView === 'schedule'">
          <PersonalScheduleView :api-mode="apiMode" :active-persona="activePersona" />
        </div>

        <!-- VIEW 3: Availability Heatmap -->
        <div v-show="currentView === 'heatmap'">
          <AvailabilityView :api-mode="apiMode" @meeting-scheduled="handleMeetingScheduled" />
        </div>

        <!-- VIEW 4: Day-of Operations & Multi-Track Timeline -->
        <div v-show="currentView === 'operations'">
          <OperationsView :api-mode="apiMode" />
        </div>

        <!-- VIEW 5: Event Risk Planning & What-If Simulator -->
        <div v-show="currentView === 'risk'">
          <EventRiskView :api-mode="apiMode" />
        </div>

      </main>

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
