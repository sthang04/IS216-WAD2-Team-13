<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { DEMO_PERSONAS, DEMO_PASSWORD } from '../services/authProfiles';
import { signIn, isSmuEmail as checkSmuEmail, findPersonaByEmail } from '../services/authService';
import PasswordVisibilityToggle from '../components/PasswordVisibilityToggle.vue';

const emit = defineEmits(['login', 'explore', 'signup']);

const email = ref('')
const password = ref('')
const isPasswordFocused = ref(false)
const showPassword = ref(false)
const errorMsg = ref('')
const isSubmitting = ref(false)
const showDemoLogins = ref(false)

// Session Cache: Remembered repeated accounts
const rememberedAccount = ref(null)
const isSwitchingAccount = ref(false)

// Sims 4-Style 3-Round Rotating Loading Screen with 12 Fun Fact Templates
const isAuthenticating = ref(false)
const authProgress = ref(0)
const currentRound = ref(1) // Round 1, 2, or 3
const activeRoundFacts = ref([])
const loadingStageText = ref('Verifying SMU ExCo Credentials & Whitelist...')

// 12 Customizable Fun Fact Templates (Team can easily edit or add facts here)
const FUN_FACT_TEMPLATES = [
  // 1. Prof Kyong & Her Orange Cat
  "🐱 Prof Kyong & Her Orange Cat: Legend says Prof Kyong's orange cat inspects every line of WAD2 frontend code from her desk!",
  
  // 2. Orange Cat Superpowers
  "✨ Orange Cat Superpowers: Prof Kyong's orange cat is officially rated as the sweetest, most supreme debugging assistant.",
  
  // 3. Orange Cat & Live Demo Luck
  "🐾 Orange Cat Charm: Rumour has it that mentioning an orange cat during a live demo grants +10 charisma on the rubric!",
  
  // 4. Jerica's Mascot Approval
  "🐱 Jerica's Mascot Cat: Approved! Jerica's mascot has officially stamped your session as genuine and ready for the demo.",
  
  // 5. SMU Connexion to LKS Walk
  "🏃 Campus Speedrun: A brisk walk from SMU Connexion to Li Ka Shing B1 is exactly 650m (~8 mins) — 85% sheltered via concourse!",
  
  // 6. ACF Handover Record
  "🎭 ACF Handover Excellence: Eurhythmix and Samba Masala boast a 100% compliant handover rate under OSL Clause 9.1(c).",
  
  // 7. BOSS Credit Hack
  "💡 BOSS Credit Preservation: Peer-to-peer studio handovers allow approved CCAs to trade slots without forfeiting bidding credits.",
  
  // 8. Acoustic Sound Isolation
  "🎧 Soundproof Secrets: SOA Basement Acoustic Rooms are built with 48dB noise isolation — ideal for loud percussion rehearsals.",
  
  // 9. Late-Night Fuel
  "☕ Connexion Project Fuel: Over 4,200 cups of iced latte are consumed at SMU Connexion during project crunch week.",
  
  // 10. Telegram Bot Speed
  "🤖 Telegram @SMUPulseBot: Webhook notifications alert 40+ stage performers within 1.5 seconds of a venue slot release.",
  
  // 11. Liquid Glass & Zero Dark Mode
  "👑 Supreme Emixers Lore: Group 13 designed Pulse with zero dark mode and 100% pure liquid glass aesthetics!",
  
  // 12. 12-Minute Demo Pro-Tip
  "🎯 12-Min Presentation Pro-Tip: 1-click persona switching saves precious minutes during the live finals presentation!"
];

async function handleQuickLogin(personaKey) {
  const p = DEMO_PERSONAS[personaKey];
  if (!p) return;
  email.value = p.email;
  password.value = DEMO_PASSWORD;
  await completeLogin(p.email, DEMO_PASSWORD);
}

// Cursor tracking for Pulse Beacon & Liquid Aura
const mouseX = ref(0)
const mouseY = ref(0)

function handleMouseMove(e) {
  const rect = e.currentTarget.getBoundingClientRect()
  mouseX.value = ((e.clientX - rect.left) / rect.width - 0.5) * 24
  mouseY.value = ((e.clientY - rect.top) / rect.height - 0.5) * 24
}

// Mascot Cat dynamic tracking (peeks on left or right side based on cursor proximity)
const catSide = ref('right')
const isButtonHovered = ref(false)

function handleButtonMouseMove(e) {
  const rect = e.currentTarget.getBoundingClientRect()
  const mouseXRel = e.clientX - rect.left
  catSide.value = mouseXRel < rect.width / 2 ? 'left' : 'right'
  isButtonHovered.value = true
}

function handleButtonLeave() {
  isButtonHovered.value = false
}

// SMU Domain Validation & ExCo list preview (same rules the sign-in uses)
const isSmuEmail = computed(() => checkSmuEmail(email.value))
const matchedPersona = computed(() => findPersonaByEmail(email.value))

// Dynamic Typewriter Animated Placeholder for Login Email
const sampleQueries = Object.values(DEMO_PERSONAS).map((p) => p.email)

const currentPlaceholder = ref(sampleQueries[0])
let placeholderTimer = null
let queryIndex = 0
let charIndex = 0
let isDeleting = false

function tickPlaceholder() {
  if (email.value.length > 0 || isSwitchingAccount.value) return

  const target = sampleQueries[queryIndex]
  if (!isDeleting) {
    charIndex++
    currentPlaceholder.value = target.substring(0, charIndex)
    if (charIndex >= target.length) {
      isDeleting = true
      placeholderTimer = setTimeout(tickPlaceholder, 1800)
      return
    }
    placeholderTimer = setTimeout(tickPlaceholder, 45)
  } else {
    charIndex--
    currentPlaceholder.value = target.substring(0, charIndex)
    if (charIndex <= 0) {
      isDeleting = false
      queryIndex = (queryIndex + 1) % sampleQueries.length
      placeholderTimer = setTimeout(tickPlaceholder, 400)
      return
    }
    placeholderTimer = setTimeout(tickPlaceholder, 25)
  }
}

onMounted(() => {
  // Read remembered account from session cache (do not set email.value directly to prevent Safari keychain highlight lock)
  try {
    const cached = localStorage.getItem('pulse_remembered_account')
    if (cached) {
      rememberedAccount.value = JSON.parse(cached)
    }
  } catch (err) {
    console.error('Session cache load error', err)
  }

  placeholderTimer = setTimeout(tickPlaceholder, 1000)
})

onUnmounted(() => {
  if (placeholderTimer) clearTimeout(placeholderTimer)
})

// Account switcher methods
function switchAccount() {
  isSwitchingAccount.value = true
  email.value = ''
  password.value = ''
}

function forgetRememberedAccount() {
  try {
    localStorage.removeItem('pulse_remembered_account')
  } catch {}
  rememberedAccount.value = null
  isSwitchingAccount.value = false
  email.value = ''
  password.value = ''
}

async function resumeRememberedLogin() {
  if (!rememberedAccount.value) return
  email.value = rememberedAccount.value.email
  password.value = DEMO_PASSWORD
  await completeLogin(rememberedAccount.value.email, DEMO_PASSWORD)
}

// All sign-in paths go through the auth service with Sims 4-style 3-round fun facts loading screen (~3.5s)
async function completeLogin(loginEmail, loginPassword) {
  errorMsg.value = ''
  isSubmitting.value = true
  
  // Pick 3 random distinct facts from the 12 templates for this login session
  const shuffled = [...FUN_FACT_TEMPLATES].sort(() => 0.5 - Math.random())
  activeRoundFacts.value = shuffled.slice(0, 3)
  currentRound.value = 1
  loadingStageText.value = 'Verifying SMU ExCo Credentials & Whitelist...'

  let progressInterval = null
  let roundTimer1 = null
  let roundTimer2 = null

  try {
    const authPromise = signIn(loginEmail, loginPassword)
    
    // Trigger fun loading screen (Sims 4 style: 3 rounds over ~3.5s)
    isAuthenticating.value = true
    authProgress.value = 10

    // Smooth progress bar update over 3.5s
    progressInterval = setInterval(() => {
      if (authProgress.value < 94) {
        authProgress.value += 1
      }
    }, 38)

    // Round 2 rotation at ~1.15s
    roundTimer1 = setTimeout(() => {
      currentRound.value = 2
      loadingStageText.value = 'Syncing Studio Schedules & OneMap Transit SLA...'
    }, 1150)

    // Round 3 rotation at ~2.30s
    roundTimer2 = setTimeout(() => {
      currentRound.value = 3
      loadingStageText.value = 'Preparing Real-Time CCA Operations Dashboard...'
    }, 2300)

    // Wait for auth promise + snappy ~3.5s reading time (3 rounds of facts)
    const [persona] = await Promise.all([
      authPromise,
      new Promise(resolve => setTimeout(resolve, 3500))
    ])

    clearInterval(progressInterval)
    authProgress.value = 100
    loadingStageText.value = 'Authentication Complete ✓'

    // Store in Session Cache for repeated visits
    if (persona) {
      const now = new Date()
      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      const cached = {
        email: persona.email,
        name: persona.name,
        roleLabel: persona.roleLabel,
        club: persona.club,
        lastLoginAt: `Today, ${timeStr}`
      }
      try {
        localStorage.setItem('pulse_remembered_account', JSON.stringify(cached))
        rememberedAccount.value = cached
      } catch {}
    }
    
    setTimeout(() => {
      isAuthenticating.value = false
      emit('login', persona)
    }, 350)

  } catch (err) {
    if (progressInterval) clearInterval(progressInterval)
    if (roundTimer1) clearTimeout(roundTimer1)
    if (roundTimer2) clearTimeout(roundTimer2)
    isAuthenticating.value = false
    authProgress.value = 0
    errorMsg.value = err.message
  } finally {
    isSubmitting.value = false
  }
}

async function handleManualLogin() {
  if (!email.value.trim()) {
    errorMsg.value = 'Please enter your SMU institutional email.'
    return
  }
  if (!isSmuEmail.value) {
    errorMsg.value = 'Access restricted: Please enter an authorized @*.smu.edu.sg account.'
    return
  }
  if (!password.value) {
    errorMsg.value = 'Please enter your password.'
    return
  }
  await completeLogin(email.value, password.value)
}
</script>

<template>
  <div 
    class="min-vh-100 d-flex flex-column justify-content-center align-items-center position-relative py-5 px-3 pulse-login-canvas overflow-hidden"
    @mousemove="handleMouseMove"
  >
    <!-- Liquid Ambient Aura Orbs (Modern Glass Lighting) -->
    <div class="liquid-orb liquid-orb-primary" :style="{ transform: `translate(${mouseX * 0.4}px, ${mouseY * 0.4}px)` }"></div>
    <div class="liquid-orb liquid-orb-cyan" :style="{ transform: `translate(${-mouseX * 0.3}px, ${-mouseY * 0.3}px)` }"></div>
    <div class="liquid-orb liquid-orb-purple" :style="{ transform: `translate(${mouseX * 0.25}px, ${mouseY * 0.5}px)` }"></div>
    <div class="liquid-mesh-grid"></div>

    <!-- Cohesive Enterprise Container: Desktop & Laptop Dimension Optimized -->
    <div class="container-fluid position-relative" style="max-width: 1320px; z-index: 1;">
      <div class="row align-items-center g-4 g-xl-5">
        
        <!-- Left Column: Unified Value Proposition & Interactive Live Operations Telemetry -->
        <div class="col-12 col-lg-6 col-xl-6">
          <div class="pe-lg-4">
            
            <!-- Dignified Institutional Badge with Full University Name & Acronym (Mentioned Once) -->
            <div class="d-inline-flex align-items-center rounded-4 liquid-glass-tag mb-3 shadow-sm border" style="background: rgba(255, 255, 255, 0.92); backdrop-filter: blur(12px); padding: 8px 18px 8px 10px; gap: 14px;">
              <span class="badge rounded-pill bg-danger bg-opacity-10 text-danger border border-danger-subtle fw-bold flex-shrink-0" style="font-size: 0.7rem; letter-spacing: 0.05em; line-height: 1.2; padding: 6px 12px;">
                CAMPUS PORTAL
              </span>
              <div class="text-start pe-2" style="line-height: 1.3;">
                <span class="d-block fw-bold text-dark" style="font-size: 0.83rem; letter-spacing: -0.01em;">
                  Singapore Management University (SMU)
                </span>
                <span class="text-muted d-block" style="font-size: 0.71rem; font-weight: 500; margin-top: 2px;">
                  Co-Curricular Facilities & Operations
                </span>
              </div>
            </div>

            <h1 class="display-6 fw-bold tracking-tight mb-3" style="color: var(--pulse-ink); line-height: 1.15;">
              Pulse:
              <br>Centralised Facilities & Operations
            </h1>

            <p class="text-muted mb-4" style="font-size: 0.95rem; line-height: 1.6;">
              A centralised co-curricular management platform for <strong>SMU</strong> student clubs, performance groups, and Office of Student Life (OSL) administrators. Simplifies arts studio handovers, automates waitlists for in-demand venues, and streamlines rehearsal logistics across the city campus.
            </p>

            <!-- Creative Glanceable Campus Operations Showcase (Instant 2-Second Preview) -->
            <div class="pulse-card liquid-glass-card p-3 p-xl-3.5 border shadow-sm mb-4 glance-showcase-box">
              
              <!-- Showcase Header -->
              <div class="d-flex align-items-center justify-content-between mb-3 pb-2 border-bottom flex-wrap gap-2">
                <div class="d-flex align-items-center gap-2">
                  <span class="glance-pulse-indicator"></span>
                  <span class="text-uppercase fw-bold text-dark" style="font-size: 0.72rem; letter-spacing: 0.05em;">
                    Live Campus Operations at a Glance
                  </span>
                </div>
                <span class="badge bg-danger bg-opacity-10 text-danger border border-danger-subtle px-2 py-0.5 rounded-pill fw-bold" style="font-size: 0.65rem;">
                  Real-Time Sync
                </span>
              </div>

              <!-- 3 Sleek Glance Cards (Clean, instant comprehension at a glance) -->
              <div class="d-flex flex-column gap-2.5">
                
                <!-- Glance Item 1: Smart Venue Booking & Waitlist -->
                <div class="glance-item-card p-2.5 rounded-3 border bg-white shadow-2xs">
                  <div class="d-flex align-items-center justify-content-between mb-1">
                    <div class="d-flex align-items-center gap-2">
                      <div class="glance-icon-circle bg-primary bg-opacity-10 text-primary">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                          <line x1="16" y1="2" x2="16" y2="6"></line>
                          <line x1="8" y1="2" x2="8" y2="6"></line>
                          <line x1="3" y1="10" x2="21" y2="10"></line>
                        </svg>
                      </div>
                      <strong class="text-dark small" style="font-size: 0.8rem;">Smart Booking & Instant Waitlist</strong>
                    </div>
                    <span class="badge bg-success bg-opacity-10 text-success border border-success-subtle px-2 py-0.5 rounded-pill" style="font-size: 0.64rem; font-weight: 700;">
                      ● 6 Venues Live
                    </span>
                  </div>
                  <p class="text-muted small mb-0 ps-4 ms-2" style="font-size: 0.72rem; line-height: 1.4;">
                    Instant queue alerts & auto-promotion when popular campus studios (e.g. Connexion B1 & MPSH) are released.
                  </p>
                </div>

                <!-- Glance Item 2: P2P Studio Handover Engine -->
                <div class="glance-item-card p-2.5 rounded-3 border bg-white shadow-2xs">
                  <div class="d-flex align-items-center justify-content-between mb-1">
                    <div class="d-flex align-items-center gap-2">
                      <div class="glance-icon-circle bg-danger bg-opacity-10 text-danger">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                          <polyline points="17 1 21 5 17 9"></polyline>
                          <path d="M3 11V9a4 4 0 0 1 4-4h14"></path>
                          <polyline points="7 23 3 19 7 15"></polyline>
                          <path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
                        </svg>
                      </div>
                      <strong class="text-dark small" style="font-size: 0.8rem;">Peer-to-Peer Studio Handover</strong>
                    </div>
                    <span class="badge bg-primary bg-opacity-10 text-primary border border-primary-subtle px-2 py-0.5 rounded-pill" style="font-size: 0.64rem; font-weight: 700;">
                      OSL Clause 9.1(c)
                    </span>
                  </div>
                  <p class="text-muted small mb-0 ps-4 ms-2" style="font-size: 0.72rem; line-height: 1.4;">
                    Direct slot exchanges between CCAs (e.g. Eurhythmix ⇄ Samba Masala) with verified legal liability reassignment.
                  </p>
                </div>

                <!-- Glance Item 3: Rehearsal Run-of-Show & Transit Buffer -->
                <div class="glance-item-card p-2.5 rounded-3 border bg-white shadow-2xs">
                  <div class="d-flex align-items-center justify-content-between mb-1">
                    <div class="d-flex align-items-center gap-2">
                      <div class="glance-icon-circle bg-success bg-opacity-10 text-success">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                          <circle cx="12" cy="12" r="10"></circle>
                          <polyline points="12 6 12 12 16 14"></polyline>
                        </svg>
                      </div>
                      <strong class="text-dark small" style="font-size: 0.8rem;">Run-of-Show & OneMap Walking SLA</strong>
                    </div>
                    <span class="badge bg-secondary bg-opacity-10 text-secondary border px-2 py-0.5 rounded-pill" style="font-size: 0.64rem; font-weight: 700;">
                      +15m Sheltered Buffer
                    </span>
                  </div>
                  <p class="text-muted small mb-0 ps-4 ms-2" style="font-size: 0.72rem; line-height: 1.4;">
                    Verified 650m walking routes (Connexion to Li Ka Shing Hall) auto-injected into cue sheets with Telegram bot alerts.
                  </p>
                </div>

              </div>

            </div>

            <!-- Security Assurance Note -->
            <div class="d-flex align-items-center gap-2 text-muted small" style="font-size: 0.775rem;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </svg>
              <span>Sign-in restricted to SMU ExCos & OSL staff (@*.smu.edu.sg)</span>
            </div>

          </div>
        </div>

        <!-- Right Column: Liquid Glass Sign-In Portal -->
        <div class="col-12 col-lg-6 col-xl-6 d-flex justify-content-center justify-content-lg-end">
          <div class="pulse-card liquid-glass-card p-4 p-xl-4 shadow-lg border w-100 position-relative" style="max-width: 560px;">
            
            <!-- Sleek Enterprise Header (Clean Dimensions, No Overlapping Pulsing Dots) -->
            <div class="d-flex align-items-center justify-content-between mb-3 pb-3 border-bottom flex-wrap gap-2">
              <div class="d-flex align-items-center gap-3">
                <div 
                  class="d-inline-flex flex-column align-items-center justify-content-center rounded-circle shadow-sm position-relative flex-shrink-0"
                  :style="{
                    background: isPasswordFocused ? 'linear-gradient(135deg, #0f172a, #1e293b)' : 'linear-gradient(135deg, #fff1f2, #ffe4e6)',
                    transform: `perspective(600px) rotateY(${mouseX}deg) rotateX(${-mouseY}deg)`,
                    transition: 'transform 0.1s ease-out, background 0.3s ease',
                    width: '52px',
                    height: '52px',
                    border: isPasswordFocused ? '2px solid #64748b' : '2px solid #fda4af'
                  }"
                >
                  <!-- Shield Mode on Password Focus (No emojis, crisp SVG) -->
                  <div v-if="isPasswordFocused" class="text-center text-white">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                    </svg>
                  </div>

                  <!-- Radar Wave Pulse Mode -->
                  <div v-else class="pulse-beacon-radar" style="transform: scale(0.8);">
                    <div class="pulse-beacon-core"></div>
                    <div class="pulse-beacon-wave"></div>
                    <div class="pulse-beacon-wave"></div>
                    <div class="pulse-beacon-wave"></div>
                  </div>
                </div>

                <div>
                  <h4 class="fw-bold mb-0 tracking-tight" style="color: var(--pulse-ink);">Sign In to Pulse</h4>
                  <p class="text-muted small mb-0" style="font-size: 0.8rem;">SMU Facilities & Operations Portal</p>
                </div>
              </div>

              <!-- Clean, Spacious Role Tag (Generous Breathing Room) -->
              <div class="d-inline-flex align-items-center gap-2 rounded-pill bg-white border shadow-2xs text-secondary" style="font-size: 0.75rem; font-weight: 600; padding: 6px 14px;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" class="text-secondary flex-shrink-0" style="margin-left: 1px;">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                </svg>
                <span style="margin-right: 1px;">ExCo & OSL Staff</span>
              </div>
            </div>

            <!-- Error Banner -->
            <div v-if="errorMsg" class="alert alert-danger py-2 px-3 small rounded-3 mb-3 d-flex align-items-center gap-2" role="alert">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="flex-shrink-0">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
              <span>{{ errorMsg }}</span>
            </div>

            <!-- Session Cache: Remembered Account Fast-Resume Card -->
            <div v-if="rememberedAccount && !isSwitchingAccount" class="p-3 rounded-3 bg-white border shadow-sm mb-3 remembered-session-card">
              <div class="d-flex align-items-center justify-content-between mb-2">
                <span class="badge bg-danger bg-opacity-10 text-danger border border-danger-subtle px-2 py-0.5" style="font-size: 0.65rem; font-weight: 700;">
                  ⚡ SESSION CACHED
                </span>
                <span class="text-muted" style="font-size: 0.68rem;">Last active: {{ rememberedAccount.lastLoginAt || 'Recent session' }}</span>
              </div>

              <div class="d-flex align-items-center gap-2.5 mb-2.5">
                <div class="remembered-avatar text-white fw-bold d-flex align-items-center justify-content-center shadow-xs">
                  {{ rememberedAccount.name ? rememberedAccount.name.charAt(0) : 'U' }}
                </div>
                <div class="me-auto text-truncate">
                  <strong class="d-block text-dark text-truncate" style="font-size: 0.85rem;">{{ rememberedAccount.name }}</strong>
                  <small class="text-muted d-block text-truncate" style="font-size: 0.72rem;">{{ rememberedAccount.email }}</small>
                </div>
                <span class="badge bg-secondary-subtle text-dark border flex-shrink-0" style="font-size: 0.65rem;">
                  {{ rememberedAccount.club || 'SMU ExCo' }}
                </span>
              </div>

              <div class="d-flex gap-2">
                <button 
                  type="button" 
                  class="btn btn-sm btn-pulse-primary flex-grow-1 py-1.5 fw-bold text-white shadow-sm d-flex align-items-center justify-content-center gap-1.5"
                  :disabled="isSubmitting"
                  @click="resumeRememberedLogin"
                >
                  <span>Fast Sign-In as {{ rememberedAccount.name.split(' ')[0] }}</span>
                  <span>→</span>
                </button>
                <button 
                  type="button" 
                  class="btn btn-sm btn-outline-secondary py-1.5 px-2.5" 
                  title="Switch to another SMU account" 
                  @click="switchAccount"
                >
                  Switch
                </button>
              </div>
              
              <div class="text-end mt-1.5">
                <button type="button" class="btn btn-link p-0 text-muted" style="font-size: 0.68rem;" @click="forgetRememberedAccount">
                  Clear saved login
                </button>
              </div>
            </div>

            <!-- Account Switcher Banner (When switching away from cached account) -->
            <div v-if="rememberedAccount && isSwitchingAccount" class="d-flex align-items-center justify-content-between mb-2 px-1">
              <span class="small text-muted" style="font-size: 0.72rem;">Signing in with different account</span>
              <button type="button" class="btn btn-link p-0 text-decoration-none small text-danger fw-semibold" style="font-size: 0.72rem;" @click="isSwitchingAccount = false">
                ← Resume {{ rememberedAccount.name.split(' ')[0] }}
              </button>
            </div>

            <!-- Manual Sign-In Form (Shown if no cache, or user chose to switch account) -->
            <form v-if="!rememberedAccount || isSwitchingAccount" @submit.prevent="handleManualLogin">
              
              <!-- SMU Email with Dynamic Typewriter Placeholder -->
              <div class="mb-3">
                <div class="d-flex justify-content-between align-items-center mb-1">
                  <label class="form-label small fw-bold text-muted mb-0" style="font-size: 0.75rem;">SMU Email Address</label>
                  <span class="text-muted" style="font-size: 0.68rem;">@*.smu.edu.sg</span>
                </div>
                
                <div class="input-group">
                  <span class="input-group-text bg-white text-muted border-end-0 pe-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                      <polyline points="22,6 12,13 2,6"></polyline>
                    </svg>
                  </span>
                  <input 
                    v-model="email"
                    type="email" 
                    name="smu_user_login_email"
                    autocomplete="off"
                    autocorrect="off"
                    autocapitalize="off"
                    spellcheck="false"
                    class="form-control border-start-0 border-end-0 px-2" 
                    :placeholder="email.length ? '' : currentPlaceholder"
                    required
                    style="font-size: 0.825rem;"
                  />
                  <!-- 1-Tap Instant Clear Button to reset highlighted or autofilled suggestion -->
                  <span class="input-group-text bg-white border-start-0 ps-1 pe-2">
                    <button
                      v-if="email.length > 0"
                      type="button"
                      class="btn btn-link p-0 text-muted border-0 input-clear-btn"
                      title="Clear email field"
                      aria-label="Clear email"
                      @click="email = ''"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                      </svg>
                    </button>
                    <span v-else style="width: 13px; display: inline-block;"></span>
                  </span>
                </div>

                <!-- Domain Validation Tag -->
                <div v-if="email.trim()" class="mt-1">
                  <span v-if="isSmuEmail && matchedPersona" class="badge bg-success bg-opacity-10 text-success border border-success-subtle" style="font-size: 0.68rem;">
                    Verified: <strong>{{ matchedPersona.roleLabel }}</strong>
                  </span>
                  <span v-else-if="isSmuEmail" class="badge bg-success bg-opacity-10 text-success border border-success-subtle" style="font-size: 0.68rem;">
                    SMU account
                  </span>
                  <span v-else class="badge bg-danger bg-opacity-10 text-danger border border-danger-subtle" style="font-size: 0.68rem;">
                    Restricted to @*.smu.edu.sg
                  </span>
                </div>
              </div>

              <!-- Password Input with Visibility Toggle -->
              <div class="mb-3">
                <div class="d-flex justify-content-between align-items-center mb-1">
                  <label class="form-label small fw-bold text-muted mb-0" style="font-size: 0.75rem;">Password</label>
                </div>
                <div class="input-group">
                  <span class="input-group-text bg-white text-muted border-end-0">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                    </svg>
                  </span>
                  <input 
                    v-model="password"
                    :type="showPassword ? 'text' : 'password'" 
                    name="smu_user_password"
                    autocomplete="current-password"
                    class="form-control border-start-0 pe-5" 
                    placeholder="••••••••••••"
                    @focus="isPasswordFocused = true"
                    @blur="isPasswordFocused = false"
                    required
                    style="font-size: 0.825rem;"
                  />
                  <PasswordVisibilityToggle :visible="showPassword" @toggle="showPassword = !showPassword" />
                </div>
              </div>

              <!-- Sign In CTA with Side-Peeking Mascot Cat & Hover Animation -->
              <div 
                class="sign-in-btn-wrapper position-relative"
                @mousemove="handleButtonMouseMove"
                @mouseleave="handleButtonLeave"
              >
                <!-- Peeking Mascot Cat Animation (Smaller, pops out on left or right depending on cursor proximity) -->
                <div 
                  class="peeking-mascot-cat"
                  :class="[catSide, { 'is-active': isButtonHovered }]"
                >
                  <div class="cat-bubble">
                    <span>meow! 🐾</span>
                  </div>
                  <svg width="28" height="26" viewBox="0 0 60 50" fill="none" class="peeking-cat-svg">
                    <polygon points="12,24 6,4 24,14" fill="#fda4af" stroke="#e11d48" stroke-width="2.5" class="ear-l" />
                    <polygon points="48,24 54,4 36,14" fill="#fda4af" stroke="#e11d48" stroke-width="2.5" class="ear-r" />
                    <ellipse cx="30" cy="32" rx="22" ry="18" fill="#ffffff" stroke="#e11d48" stroke-width="2.5" />
                    <path d="M20,28 Q24,23 28,28" stroke="#1e293b" stroke-width="2.2" stroke-linecap="round" fill="none" />
                    <path d="M32,28 Q36,23 40,28" stroke="#1e293b" stroke-width="2.2" stroke-linecap="round" fill="none" />
                    <polygon points="30,33 27,30 33,30" fill="#f43f5e" />
                    <path d="M26,36 Q30,39 30,34 Q30,39 34,36" stroke="#1e293b" stroke-width="1.8" stroke-linecap="round" fill="none" />
                    <circle cx="16" cy="33" r="3" fill="#fecdd3" opacity="0.9" />
                    <circle cx="44" cy="33" r="3" fill="#fecdd3" opacity="0.9" />
                    <ellipse cx="18" cy="46" rx="5" ry="3.5" fill="#ffffff" stroke="#e11d48" stroke-width="2" />
                    <ellipse cx="42" cy="46" rx="5" ry="3.5" fill="#ffffff" stroke="#e11d48" stroke-width="2" />
                  </svg>
                </div>

                <button 
                  type="submit" 
                  class="btn btn-pulse-primary w-100 py-2.5 fw-bold d-flex align-items-center justify-content-center gap-2 shadow-sm pulse-submit-btn text-white position-relative"
                  :class="{ 'pulse-btn-submitting': isSubmitting }"
                  :disabled="isSubmitting"
                  style="font-size: 0.875rem;"
                >
                  <span v-if="isSubmitting" class="spinner-border spinner-border-sm text-white" role="status"></span>
                  <span class="text-white">{{ isSubmitting ? 'Authenticating...' : 'Sign In' }}</span>
                  <span v-if="!isSubmitting" class="text-white">→</span>
                </button>
              </div>
            </form>

            <!-- Feature-Rich New ExCo Onboarding Button (Secondary Action with Generous Breathing Room) -->
            <div class="mt-4 pt-1">
              <button 
                type="button" 
                class="btn w-100 rounded-3 d-flex align-items-center justify-content-between new-exco-feature-btn shadow-2xs" 
                style="padding: 10px 16px;"
                @click="emit('signup')"
              >
                <div class="d-flex align-items-center text-start" style="gap: 12px;">
                  <div class="new-exco-icon-box flex-shrink-0">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                      <circle cx="8.5" cy="7" r="4"></circle>
                      <line x1="20" y1="8" x2="20" y2="14"></line>
                      <line x1="23" y1="11" x2="17" y2="11"></line>
                    </svg>
                  </div>
                  <div class="text-start">
                    <span class="d-block fw-bold text-dark new-exco-label" style="font-size: 0.8rem;">
                      New ExCo Onboarding
                    </span>
                    <small class="text-muted d-block" style="font-size: 0.7rem; margin-top: 1px;">
                      Approved CCAs via OSL Whitelist Check
                    </small>
                  </div>
                </div>
                
                <div class="d-flex align-items-center" style="gap: 6px;">
                  <span class="badge bg-secondary-subtle text-secondary border px-2.5 py-1" style="font-size: 0.68rem; font-weight: 600;">
                    Whitelist
                  </span>
                  <span class="new-exco-arrow text-muted">→</span>
                </div>
              </button>
            </div>

            <!-- Collapsible 1-Click Persona Drawer -->
            <div class="mt-4 pt-3 border-top">
              <button 
                type="button" 
                class="btn w-100 rounded-3 d-flex align-items-center justify-content-between demo-toggle-bar text-start"
                :class="showDemoLogins ? 'demo-toggle-active' : 'demo-toggle-inactive'"
                style="padding: 11px 16px; border-radius: 12px;"
                @click="showDemoLogins = !showDemoLogins"
              >
                <div class="d-flex align-items-center text-start flex-grow-1 min-w-0" style="gap: 12px;">
                  <span class="badge rounded-pill demo-badge flex-shrink-0" style="font-size: 0.72rem; font-weight: 700; padding: 5px 12px;">
                    ⚡ 1-Click
                  </span>
                  <span class="fw-bold text-dark text-start" style="font-size: 0.82rem; letter-spacing: -0.01em; white-space: nowrap;">
                    Click here for 1-Click Login for different personas
                  </span>
                </div>
                <div class="d-flex align-items-center small text-muted flex-shrink-0 ms-2" style="font-size: 0.74rem; font-weight: 500; gap: 6px;">
                  <span>{{ showDemoLogins ? 'Hide' : 'Expand' }}</span>
                  <svg 
                    width="13" 
                    height="13" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="currentColor" 
                    stroke-width="2.5"
                    :style="{ transform: showDemoLogins ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.25s ease' }"
                  >
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </div>
              </button>

              <!-- Collapsible Content -->
              <transition name="drawer-fade">
                <div v-if="showDemoLogins" class="mt-2 p-2.5 rounded-3 bg-light bg-opacity-75 border demo-cards-container">
                  <div class="d-flex align-items-center justify-content-between mb-2 px-1">
                    <span class="text-uppercase fw-bold text-muted" style="font-size: 0.64rem; letter-spacing: 0.05em;">
                      Select a persona to sign in:
                    </span>
                    <span class="small text-muted" style="font-size: 0.65rem;">Instant Session</span>
                  </div>

                  <div class="row g-2">
                    <!-- Persona 1: Rachel Tan -->
                    <div class="col-12 col-sm-6">
                      <button 
                        type="button" 
                        class="btn btn-sm btn-outline-secondary w-100 text-start p-2 rounded-3 d-flex justify-content-between align-items-center bg-white persona-tile h-100"
                        :disabled="isSubmitting"
                        @click="handleQuickLogin('rachel')"
                      >
                        <div class="me-1 text-truncate">
                          <strong class="d-block text-dark text-truncate" style="font-size: 0.76rem;">Rachel Tan</strong>
                          <small class="text-muted d-block text-truncate" style="font-size: 0.66rem;">Eurhythmix ExCo</small>
                        </div>
                        <span class="badge bg-danger bg-opacity-10 text-danger border flex-shrink-0" style="font-size: 0.65rem;">Arts</span>
                      </button>
                    </div>

                    <!-- Persona 2: Darren Koh -->
                    <div class="col-12 col-sm-6">
                      <button 
                        type="button" 
                        class="btn btn-sm btn-outline-secondary w-100 text-start p-2 rounded-3 d-flex justify-content-between align-items-center bg-white persona-tile h-100"
                        :disabled="isSubmitting"
                        @click="handleQuickLogin('darren')"
                      >
                        <div class="me-1 text-truncate">
                          <strong class="d-block text-dark text-truncate" style="font-size: 0.76rem;">Darren Koh</strong>
                          <small class="text-muted d-block text-truncate" style="font-size: 0.66rem;">Samba Masala ExCo</small>
                        </div>
                        <span class="badge bg-warning bg-opacity-25 text-dark border flex-shrink-0" style="font-size: 0.65rem;">Samba</span>
                      </button>
                    </div>

                    <!-- Persona 3: Chloe Ang -->
                    <div class="col-12 col-sm-6">
                      <button 
                        type="button" 
                        class="btn btn-sm btn-outline-secondary w-100 text-start p-2 rounded-3 d-flex justify-content-between align-items-center bg-white persona-tile h-100"
                        :disabled="isSubmitting"
                        @click="handleQuickLogin('chloe')"
                      >
                        <div class="me-1 text-truncate">
                          <strong class="d-block text-dark text-truncate" style="font-size: 0.76rem;">Chloe Ang</strong>
                          <small class="text-muted d-block text-truncate" style="font-size: 0.66rem;">OSL Facility Admin</small>
                        </div>
                        <span class="badge bg-dark text-white flex-shrink-0" style="font-size: 0.65rem;">Staff</span>
                      </button>
                    </div>

                    <!-- Persona 4: Dev Administrator -->
                    <div class="col-12 col-sm-6">
                      <button 
                        type="button" 
                        class="btn btn-sm btn-outline-secondary w-100 text-start p-2 rounded-3 d-flex justify-content-between align-items-center bg-white persona-tile h-100"
                        :disabled="isSubmitting"
                        @click="handleQuickLogin('dev')"
                      >
                        <div class="me-1 text-truncate">
                          <strong class="d-block text-dark text-truncate" style="font-size: 0.76rem;">Dev Administrator</strong>
                          <small class="text-muted d-block text-truncate" style="font-size: 0.66rem;">All CCAs Super-Admin</small>
                        </div>
                        <span class="badge text-white flex-shrink-0" style="background-color: var(--pulse-purple-transit); font-size: 0.65rem;">Dev</span>
                      </button>
                    </div>
                  </div>
                </div>
              </transition>
            </div>

            <!-- Guest Explorer Link (Card Footer) -->
            <div class="border-top pt-3 mt-3 text-center">
              <button 
                type="button" 
                class="btn btn-link text-muted small text-decoration-none guest-link"
                @click="emit('explore')"
              >
                Skip sign-in and explore live facility calendar as guest →
              </button>
            </div>

            <!-- Interactive Authenticating / Fun Fact Screen Overlay -->
            <transition name="loading-fade">
              <div 
                v-if="isAuthenticating" 
                class="position-absolute top-0 start-0 w-100 h-100 d-flex flex-column justify-content-center align-items-center p-4 rounded-4 auth-loading-overlay text-center"
                style="z-index: 25;"
              >
                <!-- Animated Mascot Cat Head & Crown -->
                <div class="auth-mascot-container mb-3 position-relative">
                  <div class="supreme-crown">👑</div>
                  <div class="mascot-cat-face">
                    <svg width="76" height="76" viewBox="0 0 100 100" fill="none" class="cat-svg">
                      <polygon points="18,36 10,8 36,22" fill="#fda4af" stroke="#e11d48" stroke-width="3" stroke-linejoin="round" class="cat-ear-left" />
                      <polygon points="82,36 90,8 64,22" fill="#fda4af" stroke="#e11d48" stroke-width="3" stroke-linejoin="round" class="cat-ear-right" />
                      <circle cx="50" cy="54" r="38" fill="#ffffff" stroke="#e11d48" stroke-width="3.5" />
                      <path d="M34,48 Q40,42 46,48" stroke="#1e293b" stroke-width="3.5" stroke-linecap="round" fill="none" />
                      <path d="M54,48 Q60,42 66,48" stroke="#1e293b" stroke-width="3.5" stroke-linecap="round" fill="none" />
                      <polygon points="50,56 46,52 54,52" fill="#f43f5e" />
                      <path d="M44,61 Q50,66 50,58 Q50,66 56,61" stroke="#1e293b" stroke-width="2.5" stroke-linecap="round" fill="none" />
                      <line x1="22" y1="52" x2="38" y2="55" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" />
                      <line x1="20" y1="60" x2="38" y2="60" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" />
                      <line x1="78" y1="52" x2="62" y2="55" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" />
                      <line x1="80" y1="60" x2="62" y2="60" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" />
                      <circle cx="28" cy="58" r="5" fill="#fecdd3" opacity="0.8" />
                      <circle cx="72" cy="58" r="5" fill="#fecdd3" opacity="0.8" />
                    </svg>
                  </div>
                </div>

                <h5 class="fw-bold mb-1 text-dark" style="letter-spacing: -0.02em;">Authenticating Session...</h5>
                <p class="text-muted small mb-3" style="font-size: 0.78rem;">{{ loadingStageText }}</p>

                <!-- Sims 4 Style Smooth Progress Bar -->
                <div class="progress w-100 rounded-pill mb-3" style="height: 6px; max-width: 320px; background-color: rgba(226, 232, 240, 0.8);">
                  <div class="progress-bar progress-bar-striped progress-bar-animated bg-danger" :style="{ width: `${authProgress}%`, transition: 'width 0.15s ease-out' }"></div>
                </div>

                <!-- Sims 4 Style 3-Round Rotating Trivia Card -->
                <div class="p-3 rounded-3 bg-white border shadow-sm w-100 text-start sims-tip-card position-relative overflow-hidden" style="max-width: 440px;">
                  <div class="d-flex align-items-center justify-content-between mb-2">
                    <div class="d-flex align-items-center gap-1.5">
                      <span class="badge bg-danger bg-opacity-10 text-danger border border-danger-subtle px-2 py-0.5" style="font-size: 0.65rem; font-weight: 700;">
                        💡 CAMPUS TRIVIA
                      </span>
                      <span class="badge bg-light text-dark border px-2 py-0.5 ms-1" style="font-size: 0.65rem; font-weight: 600;">
                        Round {{ currentRound }} of 3
                      </span>
                    </div>
                    <!-- 3 Round Indicator Dots -->
                    <div class="d-flex align-items-center gap-1">
                      <span class="sims-tip-dot" :class="{ active: currentRound === 1 }"></span>
                      <span class="sims-tip-dot" :class="{ active: currentRound === 2 }"></span>
                      <span class="sims-tip-dot" :class="{ active: currentRound === 3 }"></span>
                    </div>
                  </div>

                  <transition name="sims-tip-swap" mode="out-in">
                    <p :key="currentRound" class="text-dark small mb-0 fw-medium sims-tip-text" style="font-size: 0.77rem; line-height: 1.5; min-height: 48px;">
                      {{ activeRoundFacts[currentRound - 1] || 'Loading SMU facts...' }}
                    </p>
                  </transition>
                </div>
              </div>
            </transition>

          </div>
        </div>

      </div>
    </div>

  </div>
</template>

<style scoped>
/* ==========================================================================
   Liquid Glass & Mesh Aesthetic
   ========================================================================== */
.pulse-login-canvas {
  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 45%, #e2e8f0 100%);
  position: relative;
}

/* Floating Ambient Liquid Glow Orbs */
.liquid-orb {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
  filter: blur(80px);
  opacity: 0.65;
  transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  z-index: 0;
}

.liquid-orb-primary {
  width: 480px;
  height: 480px;
  top: -80px;
  left: 5%;
  background: radial-gradient(circle, rgba(225, 29, 72, 0.22) 0%, rgba(225, 29, 72, 0.04) 65%, transparent 100%);
  animation: floatOrb1 20s ease-in-out infinite alternate;
}

.liquid-orb-cyan {
  width: 520px;
  height: 520px;
  top: 35%;
  right: -80px;
  background: radial-gradient(circle, rgba(14, 165, 233, 0.20) 0%, rgba(56, 189, 248, 0.03) 65%, transparent 100%);
  animation: floatOrb2 25s ease-in-out infinite alternate;
}

.liquid-orb-purple {
  width: 440px;
  height: 440px;
  bottom: -80px;
  left: 38%;
  background: radial-gradient(circle, rgba(168, 85, 247, 0.16) 0%, rgba(147, 51, 234, 0.03) 65%, transparent 100%);
  animation: floatOrb3 22s ease-in-out infinite alternate;
}

@keyframes floatOrb1 {
  0% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(40px, 30px) scale(1.08); }
  100% { transform: translate(-20px, 50px) scale(0.95); }
}

@keyframes floatOrb2 {
  0% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(-50px, -40px) scale(1.1); }
  100% { transform: translate(30px, 30px) scale(0.92); }
}

@keyframes floatOrb3 {
  0% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(-30px, 40px) scale(1.05); }
  100% { transform: translate(40px, -20px) scale(0.98); }
}

/* Subtle architectural grid pattern overlay */
.liquid-mesh-grid {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-image: radial-gradient(rgba(148, 163, 184, 0.22) 1px, transparent 1px);
  background-size: 28px 28px;
  opacity: 0.6;
  pointer-events: none;
  z-index: 0;
}

/* Glassmorphism Container */
.liquid-glass-card {
  background: rgba(255, 255, 255, 0.88) !important;
  backdrop-filter: blur(24px) saturate(190%) !important;
  -webkit-backdrop-filter: blur(24px) saturate(190%) !important;
  border: 1px solid rgba(255, 255, 255, 0.95) !important;
  box-shadow: 
    0 24px 50px -12px rgba(15, 23, 42, 0.12),
    0 0 0 1px rgba(255, 255, 255, 0.8) inset,
    0 8px 24px -4px rgba(225, 29, 72, 0.05) !important;
  border-radius: 1.5rem !important;
  position: relative;
  z-index: 1;
}

.liquid-glass-tag {
  background: rgba(255, 255, 255, 0.82) !important;
  backdrop-filter: blur(16px) saturate(160%) !important;
  -webkit-backdrop-filter: blur(16px) saturate(160%) !important;
  border: 1px solid rgba(255, 255, 255, 0.9) !important;
  box-shadow: 0 4px 16px -2px rgba(15, 23, 42, 0.05) !important;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.liquid-glass-tag:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px -4px rgba(15, 23, 42, 0.1) !important;
  border-color: rgba(225, 29, 72, 0.25) !important;
}

/* ==========================================================================
   Glanceable Campus Operations Showcase
   ========================================================================== */
.glance-showcase-box {
  background: rgba(255, 255, 255, 0.88) !important;
  border-radius: 1.25rem !important;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.glance-pulse-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.7);
  animation: glance-pulse 2s infinite;
  display: inline-block;
}

@keyframes glance-pulse {
  0% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.7); }
  70% { box-shadow: 0 0 0 6px rgba(34, 197, 94, 0); }
  100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
}

.glance-item-card {
  transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1);
  background: #ffffff;
  border: 1px solid #e2e8f0;
}

.glance-item-card:hover {
  transform: translateY(-2px);
  border-color: rgba(225, 29, 72, 0.25) !important;
  box-shadow: 0 6px 18px -4px rgba(15, 23, 42, 0.08) !important;
}

.glance-icon-circle {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

/* ==========================================================================
   Remembered Session Cache Card
   ========================================================================== */
.remembered-session-card {
  background: rgba(255, 255, 255, 0.95);
  border: 1.5px solid #fda4af !important;
  animation: fadeIn 0.25s ease-out;
}

.remembered-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--pulse-primary), #9f1239);
  font-size: 0.85rem;
  flex-shrink: 0;
}

/* ==========================================================================
   Sign In Button & Peeking Cat Mascot
   ========================================================================== */
.sign-in-btn-wrapper {
  margin-top: 0.25rem;
}

/* Side-Peeking Mascot Cat (Pops out from left or right edge beside the button) */
.peeking-mascot-cat {
  position: absolute;
  top: 50%;
  z-index: 10;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  opacity: 0;
  transition: all 0.28s cubic-bezier(0.34, 1.56, 0.64, 1);
}

/* Left side peeking: peeks out from the left edge */
.peeking-mascot-cat.left {
  left: -8px;
  transform: translateY(-50%) translateX(16px) scale(0.6) rotate(-8deg);
}

.peeking-mascot-cat.left.is-active,
.sign-in-btn-wrapper:hover .peeking-mascot-cat.left {
  transform: translateY(-50%) translateX(-14px) scale(1) rotate(-8deg);
  opacity: 1;
}

/* Right side peeking: peeks out from the right edge */
.peeking-mascot-cat.right {
  right: -8px;
  transform: translateY(-50%) translateX(-16px) scale(0.6) rotate(8deg);
}

.peeking-mascot-cat.right.is-active,
.sign-in-btn-wrapper:hover .peeking-mascot-cat.right {
  transform: translateY(-50%) translateX(14px) scale(1) rotate(8deg);
  opacity: 1;
}

.cat-bubble {
  background: #ffffff;
  border: 1.5px solid #fda4af;
  color: #e11d48;
  font-size: 0.54rem;
  font-weight: 800;
  padding: 1px 6px;
  border-radius: 9999px;
  box-shadow: 0 4px 10px rgba(225, 29, 72, 0.15);
  margin-bottom: -2px;
  white-space: nowrap;
  animation: bubble-bounce 1s ease infinite alternate;
}

@keyframes bubble-bounce {
  0% { transform: translateY(0); }
  100% { transform: translateY(-3px); }
}

.sign-in-btn-wrapper:hover .ear-l {
  animation: ear-twitch 0.8s ease infinite alternate;
}

.sign-in-btn-wrapper:hover .ear-r {
  animation: ear-twitch 0.8s ease 0.2s infinite alternate;
}

@keyframes ear-twitch {
  0% { transform: rotate(0deg); }
  50% { transform: rotate(-8deg); }
  100% { transform: rotate(0deg); }
}

/* Neutralize Safari & Chrome aggressive autofill solid blue/yellow background locks */
input:-webkit-autofill,
input:-webkit-autofill:hover, 
input:-webkit-autofill:focus, 
input:-webkit-autofill:active {
  -webkit-box-shadow: 0 0 0 1000px #ffffff inset !important;
  -webkit-text-fill-color: var(--pulse-ink, #0f172a) !important;
  caret-color: var(--pulse-ink, #0f172a) !important;
  transition: background-color 5000s ease-in-out 0s;
}

.input-clear-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  color: #94a3b8 !important;
  background: transparent;
  transition: all 0.15s ease;
  line-height: 1;
}

.input-clear-btn:hover {
  background: #fee2e2;
  color: #e11d48 !important;
}

.pulse-submit-btn {
  background: linear-gradient(135deg, #e11d48 0%, #f43f5e 50%, #be123c 100%) !important;
  background-size: 200% auto !important;
  color: #ffffff !important;
  border: none !important;
  font-weight: 700 !important;
  border-radius: 0.75rem !important;
  box-shadow: 0 6px 20px -2px rgba(225, 29, 72, 0.38) !important;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
  position: relative;
  overflow: hidden;
}

.pulse-submit-btn *,
.pulse-submit-btn span {
  color: #ffffff !important;
}

.pulse-submit-btn:hover:not(:disabled) {
  background-position: right center !important;
  transform: translateY(-2px) scale(1.01) !important;
  box-shadow: 0 10px 28px -3px rgba(225, 29, 72, 0.52) !important;
}

.pulse-submit-btn:active:not(:disabled) {
  transform: translateY(1px) scale(0.99) !important;
}

/* Liquid Shimmer Sweep across the button */
.pulse-submit-btn::after {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 50%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.28), transparent);
  transform: skewX(-20deg);
  transition: none;
}

.pulse-submit-btn:hover:not(:disabled)::after {
  left: 200%;
  transition: left 0.85s cubic-bezier(0.16, 1, 0.3, 1);
}

/* Pulsing Ring while Submitting */
.pulse-btn-submitting {
  animation: pulse-ring-glow 1.4s infinite !important;
}

@keyframes pulse-ring-glow {
  0% {
    box-shadow: 0 0 0 0 rgba(225, 29, 72, 0.5), 0 6px 20px rgba(225, 29, 72, 0.4);
  }
  70% {
    box-shadow: 0 0 0 8px rgba(225, 29, 72, 0), 0 6px 20px rgba(225, 29, 72, 0.4);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(225, 29, 72, 0), 0 6px 20px rgba(225, 29, 72, 0.4);
  }
}

/* ==========================================================================
   New ExCo Feature Button
   ========================================================================== */
.new-exco-feature-btn {
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid #e2e8f0;
  padding: 10px 16px !important;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
}

.new-exco-icon-box {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  background-color: #fff1f2;
  color: var(--pulse-primary, #e11d48);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: transform 0.2s ease;
}

.new-exco-feature-btn:hover {
  background: #ffffff;
  border-color: #fda4af;
  box-shadow: 0 4px 12px rgba(225, 29, 72, 0.08);
  transform: translateY(-1px);
}

.new-exco-feature-btn:hover .new-exco-icon-box {
  transform: scale(1.1);
}

.new-exco-feature-btn:hover .new-exco-label {
  color: var(--pulse-primary, #e11d48) !important;
}

.new-exco-feature-btn:hover .new-exco-arrow {
  transform: translateX(2px);
  color: var(--pulse-primary, #e11d48) !important;
}

.new-exco-arrow {
  transition: transform 0.2s ease, color 0.2s ease;
  font-size: 0.85rem;
}

/* ==========================================================================
   Collapsible Demo Persona Drawer
   ========================================================================== */
.demo-toggle-bar {
  background: rgba(255, 255, 255, 0.7);
  border: 1px dashed #cbd5e1;
  padding: 11px 16px !important;
  transition: all 0.2s ease;
  text-align: left !important;
}

.demo-toggle-bar:hover {
  background: #ffffff;
  border-color: #94a3b8;
}

.demo-toggle-active {
  background: #fff1f2;
  border-color: #fecdd3;
  border-style: solid;
}

.demo-badge {
  background-color: rgba(225, 29, 72, 0.1);
  color: var(--pulse-primary, #e11d48);
  border: 1px solid rgba(225, 29, 72, 0.2);
  font-size: 0.65rem;
  font-weight: 700;
}

.drawer-fade-enter-active,
.drawer-fade-leave-active {
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  max-height: 280px;
  opacity: 1;
  overflow: hidden;
}

.drawer-fade-enter-from,
.drawer-fade-leave-to {
  max-height: 0;
  opacity: 0;
  transform: translateY(-8px);
  margin-top: 0 !important;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
  overflow: hidden;
}

.persona-tile {
  transition: all 0.16s ease-in-out;
  border-color: #e2e8f0;
}

.persona-tile:hover:not(:disabled) {
  transform: translateY(-2px);
  border-color: var(--pulse-primary, #e11d48);
  background-color: #fff1f2 !important;
  box-shadow: 0 4px 12px rgba(225, 29, 72, 0.12);
}

.guest-link {
  transition: color 0.15s ease;
}

.guest-link:hover {
  color: var(--pulse-primary, #e11d48) !important;
}

/* ==========================================================================
   Interactive Auth Loading Screen Overlay
   ========================================================================== */
.auth-loading-overlay {
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  animation: fadeIn 0.25s ease-out;
}

.supreme-crown {
  position: absolute;
  top: -14px;
  left: 50%;
  transform: translateX(-50%) rotate(4deg);
  font-size: 1.35rem;
  z-index: 5;
  animation: crown-float 1.5s ease-in-out infinite alternate;
}

@keyframes crown-float {
  0% { transform: translateX(-50%) translateY(0) rotate(4deg); }
  100% { transform: translateX(-50%) translateY(-3px) rotate(-2deg); }
}

.mascot-cat-face {
  filter: drop-shadow(0 6px 16px rgba(225, 29, 72, 0.18));
  animation: cat-breathe 2s ease-in-out infinite alternate;
}

@keyframes cat-breathe {
  0% { transform: scale(1); }
  100% { transform: scale(1.04); }
}

.cat-ear-left {
  animation: ear-wiggle-left 1.8s infinite ease-in-out;
  transform-origin: 20px 30px;
}

.cat-ear-right {
  animation: ear-wiggle-right 1.8s infinite ease-in-out 0.3s;
  transform-origin: 70px 30px;
}

@keyframes ear-wiggle-left {
  0%, 100% { transform: rotate(0deg); }
  50% { transform: rotate(-5deg); }
}

@keyframes ear-wiggle-right {
  0%, 100% { transform: rotate(0deg); }
  50% { transform: rotate(5deg); }
}

.loading-fade-enter-active,
.loading-fade-leave-active {
  transition: opacity 0.25s ease;
}

.loading-fade-enter-from,
.loading-fade-leave-to {
  opacity: 0;
}

/* Sims 4-Style 3-Round Rotating Trivia Card */
.sims-tip-card {
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(226, 232, 240, 0.95) !important;
  box-shadow: 0 4px 18px rgba(15, 23, 42, 0.06);
}

.sims-tip-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: #cbd5e1;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  display: inline-block;
}

.sims-tip-dot.active {
  width: 18px;
  border-radius: 4px;
  background-color: #e11d48;
}

.sims-tip-swap-enter-active,
.sims-tip-swap-leave-active {
  transition: all 0.28s cubic-bezier(0.4, 0, 0.2, 1);
}

.sims-tip-swap-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.sims-tip-swap-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
