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

// Loading Screen with Fun Facts & Mascot
const isAuthenticating = ref(false)
const authProgress = ref(0)
const currentFactIndex = ref(0)

const funFacts = [
  "👑 Supreme Leader Kyong: Legend says Prof Kyong commands WAD2 with supreme wisdom and an army of adorable cats! 🐱",
  "🐱 Jerica's Mascot Cat has stamped your session as 100% genuine and ready for the live demo!",
  "🏃 SMU Campus Trivia: Running from SMU Connexion to Li Ka Shing B1 is 650m (~8 min brisk walk). Perfect transit buffer for OneMap!",
  "🎭 ACF Eurhythmix & Samba Masala maintain a 100% compliance record on weekend studio handovers under OSL Clause 9.1(c).",
  "✨ A+ Rubric Secret: A seamless live demo with 1-click evaluator logins saves crucial minutes during the 12m finals presentation!"
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
  if (email.value.length > 0) return

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
  placeholderTimer = setTimeout(tickPlaceholder, 1000)
})

onUnmounted(() => {
  if (placeholderTimer) clearTimeout(placeholderTimer)
})

// All sign-in paths go through the auth service with fun loading screen
async function completeLogin(loginEmail, loginPassword) {
  errorMsg.value = ''
  isSubmitting.value = true
  
  // Pick a random fun fact to display
  currentFactIndex.value = Math.floor(Math.random() * funFacts.length)
  
  let progressInterval = null
  try {
    const authPromise = signIn(loginEmail, loginPassword)
    
    // Trigger fun loading screen
    isAuthenticating.value = true
    authProgress.value = 15
    
    // Smooth progress ticker over ~1.4s
    progressInterval = setInterval(() => {
      if (authProgress.value < 88) {
        authProgress.value += 18
      }
    }, 180)
    
    const [persona] = await Promise.all([
      authPromise,
      new Promise(resolve => setTimeout(resolve, 1300)) // smooth ~1.3s delay to read fun fact
    ])
    
    clearInterval(progressInterval)
    authProgress.value = 100
    
    setTimeout(() => {
      isAuthenticating.value = false
      emit('login', persona)
    }, 280)
    
  } catch (err) {
    if (progressInterval) clearInterval(progressInterval)
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
    <div class="container-fluid position-relative" style="max-width: 1240px; z-index: 1;">
      <div class="row align-items-center g-4 g-xl-5">
        
        <!-- Left Column: Unified Value Proposition & Showcase -->
        <div class="col-12 col-lg-6 col-xl-6">
          <div class="pe-lg-4">
            
            <!-- Redesigned Dignified Institutional Badge (No distracting green dot) -->
            <div class="d-inline-flex align-items-center gap-2 px-3 py-1.5 rounded-pill liquid-glass-tag mb-3 shadow-sm border">
              <span class="badge rounded-pill bg-danger bg-opacity-10 text-danger border border-danger-subtle px-2 py-0.5 fw-bold" style="font-size: 0.68rem; letter-spacing: 0.04em;">
                OFFICIAL PORTAL
              </span>
              <span class="fw-semibold text-dark" style="font-size: 0.78rem;">
                SMU Office of Student Life • CCA Facilities Portal
              </span>
            </div>

            <h1 class="display-6 fw-bold tracking-tight mb-3" style="color: var(--pulse-ink); line-height: 1.15;">
              Pulse:
              <br>Centralised Facilities & Operations for SMU Student Life
            </h1>

            <p class="text-muted mb-4" style="font-size: 0.95rem; line-height: 1.6;">
              The official co-curricular management platform for SMU student clubs, performance groups, and OSL administrators. Simplifies arts studio handovers, automates waitlists for in-demand venues, and streamlines rehearsal logistics across the SMU city campus.
            </p>

            <!-- Grounded Sector Showcase Cards (Subtle Floating Animation + Glass Backdrop) -->
            <div class="d-flex flex-column gap-3 mb-4">
              
              <!-- Card 1: ACF Arts -->
              <div class="p-3 liquid-glass-tag border rounded-3 d-flex align-items-start gap-3 pulse-floating-tag" style="animation-delay: 0s;">
                <div class="p-2 rounded-2 text-danger bg-danger bg-opacity-10 flex-shrink-0" style="line-height: 1;">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                  </svg>
                </div>
                <div>
                  <div class="d-flex align-items-center gap-2 mb-1">
                    <span class="badge bg-danger rounded-pill px-2" style="font-size: 0.65rem;">ACF • ARTS</span>
                    <span class="fw-bold text-dark small">Peer-to-Peer Studio Handover</span>
                  </div>
                  <div class="text-muted small" style="font-size: 0.8rem;">
                    Direct studio exchanges between ACF clubs (e.g. Eurhythmix & Samba Masala) with weekend conditional passes and OSL endorsement.
                  </div>
                </div>
              </div>

              <!-- Card 2: SSU Sports -->
              <div class="p-3 liquid-glass-tag border rounded-3 d-flex align-items-start gap-3 pulse-floating-tag" style="animation-delay: 1.2s;">
                <div class="p-2 rounded-2 text-primary bg-primary bg-opacity-10 flex-shrink-0" style="line-height: 1;">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <polyline points="12 6 12 12 16 14"></polyline>
                  </svg>
                </div>
                <div>
                  <div class="d-flex align-items-center gap-2 mb-1">
                    <span class="badge bg-primary rounded-pill px-2" style="font-size: 0.65rem;">SSU • SPORTS</span>
                    <span class="fw-bold text-dark small">Automated Facility Waitlist</span>
                  </div>
                  <div class="text-muted small" style="font-size: 0.8rem;">
                    Instant queue alerts for high-demand campus studios and practice spaces when booked slots are released early by other clubs.
                  </div>
                </div>
              </div>

              <!-- Card 3: Operations & Transit -->
              <div class="p-3 liquid-glass-tag border rounded-3 d-flex align-items-start gap-3 pulse-floating-tag" style="animation-delay: 2.4s;">
                <div class="p-2 rounded-2 text-success bg-success bg-opacity-10 flex-shrink-0" style="line-height: 1;">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                    <circle cx="9" cy="7" r="4"></circle>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                  </svg>
                </div>
                <div>
                  <div class="d-flex align-items-center gap-2 mb-1">
                    <span class="badge bg-success rounded-pill px-2" style="font-size: 0.65rem;">OPERATIONS • TRANSIT</span>
                    <span class="fw-bold text-dark small">Rehearsal Run-of-Show & Transit</span>
                  </div>
                  <div class="text-muted small" style="font-size: 0.8rem;">
                    Coordinated cue timelines with verified OneMap walking buffers between SMU Connexion, holding spaces, and event stages.
                  </div>
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
          <div class="pulse-card liquid-glass-card p-4 p-xl-4 shadow-lg border w-100 position-relative" style="max-width: 500px;">
            
            <!-- Sleek Enterprise Header (Clean Dimensions, No Overlapping Pulsing Dots) -->
            <div class="d-flex align-items-center justify-content-between mb-4 pb-3 border-bottom flex-wrap gap-2">
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
                  <p class="text-muted small mb-0" style="font-size: 0.8rem;">SMU Student Life & Facilities Portal</p>
                </div>
              </div>

              <!-- Clean, Spacious Role Tag (Replaces tight green pulsing dot) -->
              <div class="d-inline-flex align-items-center gap-1.5 px-3 py-1 rounded-pill bg-white border shadow-2xs text-secondary small" style="font-size: 0.725rem; font-weight: 600;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="text-secondary">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                </svg>
                <span>ExCo & OSL Staff</span>
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

            <!-- Manual Sign-In Form -->
            <form @submit.prevent="handleManualLogin">
              
              <!-- SMU Email with Dynamic Typewriter Placeholder -->
              <div class="mb-3">
                <div class="d-flex justify-content-between align-items-center mb-1">
                  <label class="form-label small fw-bold text-muted mb-0" style="font-size: 0.75rem;">SMU Email Address</label>
                  <span class="text-muted" style="font-size: 0.68rem;">@*.smu.edu.sg</span>
                </div>
                
                <div class="input-group">
                  <span class="input-group-text bg-white text-muted border-end-0">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                      <polyline points="22,6 12,13 2,6"></polyline>
                    </svg>
                  </span>
                  <input 
                    v-model="email"
                    type="email" 
                    class="form-control border-start-0" 
                    :placeholder="email.length ? '' : currentPlaceholder"
                    required
                    style="font-size: 0.825rem;"
                  />
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

              <!-- Sign In CTA with Peeking Mascot Cat & Hover Animation -->
              <div class="sign-in-btn-wrapper position-relative">
                
                <!-- Peeking Mascot Cat Animation (Pops up when user hovers over Sign In) -->
                <div class="peeking-mascot-cat">
                  <div class="cat-bubble">
                    <span>meow! 🐾</span>
                  </div>
                  <svg width="48" height="42" viewBox="0 0 60 50" fill="none" class="peeking-cat-svg">
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

            <!-- Feature-Rich New ExCo Onboarding Button (Secondary Action) -->
            <div class="mt-2.5">
              <button 
                type="button" 
                class="btn btn-sm w-100 py-2 px-3 rounded-3 d-flex align-items-center justify-content-between new-exco-feature-btn" 
                @click="emit('signup')"
              >
                <div class="d-flex align-items-center gap-2">
                  <div class="new-exco-icon-box">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                      <circle cx="8.5" cy="7" r="4"></circle>
                      <line x1="20" y1="8" x2="20" y2="14"></line>
                      <line x1="23" y1="11" x2="17" y2="11"></line>
                    </svg>
                  </div>
                  <div class="text-start">
                    <span class="d-block fw-bold text-dark new-exco-label" style="font-size: 0.775rem;">
                      New ExCo Onboarding
                    </span>
                    <small class="text-muted d-block" style="font-size: 0.66rem; margin-top: -2px;">
                      Approved CCAs via OSL Whitelist Check
                    </small>
                  </div>
                </div>
                
                <div class="d-flex align-items-center gap-1.5">
                  <span class="badge bg-secondary-subtle text-secondary border px-2 py-0.5" style="font-size: 0.65rem;">
                    Whitelist
                  </span>
                  <span class="new-exco-arrow text-muted">→</span>
                </div>
              </button>
            </div>

            <!-- Collapsible 1-Click Demo Persona Drawer -->
            <div class="mt-3 pt-3 border-top">
              <button 
                type="button" 
                class="btn btn-sm w-100 py-2 px-3 rounded-3 d-flex align-items-center justify-content-between demo-toggle-bar"
                :class="showDemoLogins ? 'demo-toggle-active' : 'demo-toggle-inactive'"
                @click="showDemoLogins = !showDemoLogins"
              >
                <div class="d-flex align-items-center gap-2">
                  <span class="badge rounded-pill px-2 py-0.5 demo-badge">
                    Demo Evaluator
                  </span>
                  <span class="fw-bold small text-dark" style="font-size: 0.78rem;">
                    1-Click Demo Personas
                  </span>
                </div>
                <div class="d-flex align-items-center gap-1 small text-muted" style="font-size: 0.72rem;">
                  <span>{{ showDemoLogins ? 'Hide' : 'Expand (12m Demo)' }}</span>
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
                      Select Demo Role:
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
                <p class="text-muted small mb-3" style="font-size: 0.78rem;">Connecting with SMU Supabase Cloud</p>

                <!-- Progress Bar -->
                <div class="progress w-100 rounded-pill mb-3" style="height: 6px; max-width: 280px; background-color: rgba(226, 232, 240, 0.8);">
                  <div class="progress-bar progress-bar-striped progress-bar-animated bg-danger" :style="{ width: `${authProgress}%`, transition: 'width 0.2s linear' }"></div>
                </div>

                <!-- Fun Facts Card -->
                <div class="p-3 rounded-3 bg-white border shadow-sm w-100 text-start" style="max-width: 380px;">
                  <div class="d-flex align-items-center justify-content-between mb-1.5">
                    <span class="badge bg-danger bg-opacity-10 text-danger border border-danger-subtle px-2 py-0.5" style="font-size: 0.65rem; font-weight: 700;">
                      💡 SMU & WAD2 FUN FACT
                    </span>
                    <span class="text-muted" style="font-size: 0.65rem;">Tip #{{ currentFactIndex + 1 }}</span>
                  </div>
                  <p class="text-dark small mb-0 fw-medium" style="font-size: 0.76rem; line-height: 1.45;">
                    {{ funFacts[currentFactIndex] }}
                  </p>
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
   Sign In Button & Peeking Cat Mascot
   ========================================================================== */
.sign-in-btn-wrapper {
  margin-top: 0.25rem;
}

.peeking-mascot-cat {
  position: absolute;
  top: -34px;
  right: 24px;
  z-index: 10;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  transform: translateY(32px) scale(0.4);
  opacity: 0;
  transition: all 0.32s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.sign-in-btn-wrapper:hover .peeking-mascot-cat {
  transform: translateY(0) scale(1);
  opacity: 1;
}

.cat-bubble {
  background: #ffffff;
  border: 1.5px solid #fda4af;
  color: #e11d48;
  font-size: 0.62rem;
  font-weight: 800;
  padding: 1px 7px;
  border-radius: 9999px;
  box-shadow: 0 4px 10px rgba(225, 29, 72, 0.15);
  margin-bottom: -4px;
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
  transition: all 0.2s ease;
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
</style>
