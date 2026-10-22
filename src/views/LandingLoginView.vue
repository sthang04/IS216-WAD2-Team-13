<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { DEMO_PERSONAS } from '../services/authProfiles';

const emit = defineEmits(['login', 'explore']);

const email = ref('')
const password = ref('')
const isPasswordFocused = ref(false)
const isTyping = ref(false)
const errorMsg = ref('')
const showSsoModal = ref(false)
const activeSsoProvider = ref('')

// Cursor tracking for Pulse Beacon
const mouseX = ref(0)
const mouseY = ref(0)

function handleMouseMove(e) {
  const rect = e.currentTarget.getBoundingClientRect()
  mouseX.value = ((e.clientX - rect.left) / rect.width - 0.5) * 24
  mouseY.value = ((e.clientY - rect.top) / rect.height - 0.5) * 24
}

// SMU Domain Validation
const isSmuEmail = computed(() => {
  const pattern = /^[a-zA-Z0-9._%+-]+@([a-zA-Z0-9.-]+\.)?smu\.edu\.sg$/i
  return pattern.test(email.value.trim())
})

const derivedRole = computed(() => {
  const lower = email.value.trim().toLowerCase()
  if (!lower) return null
  if (lower.includes('osl') || lower.includes('admin') || (!lower.match(/\.\d{4}@/) && lower.endsWith('@smu.edu.sg'))) {
    return { name: 'Facility Admin (OSL)', type: 'admin', club: 'ACF ExCo', isDev: false }
  }
  if (lower.includes('dev')) {
    return { name: 'Developer (All CCAs)', type: 'dev', club: 'Eurhythmix', isDev: true }
  }
  if (lower.includes('darren') || lower.includes('samba')) {
    return { name: 'Club EXCO (Samba Masala)', type: 'club', club: 'Samba Masala', isDev: false }
  }
  if (lower.includes('marcus') || lower.includes('symphonia')) {
    return { name: 'Club EXCO (Symphonia)', type: 'club', club: 'Symphonia', isDev: false }
  }
  return { name: 'Club EXCO (Eurhythmix)', type: 'club', club: 'Eurhythmix', isDev: false }
})

// Dynamic Typewriter Animated Placeholder for Login Email
const sampleQueries = [
  'john.doe.2025@scis.smu.edu.sg',
  'rachel.tan.2024@scis.smu.edu.sg',
  'darren.koh.2024@business.smu.edu.sg',
  'marcus.lim.2024@socsc.smu.edu.sg',
  'chloe.ang@smu.edu.sg',
  'dev.admin@smu.edu.sg',
]

const currentPlaceholder = ref('john.doe.2025@scis.smu.edu.sg')
let placeholderTimer = null
let queryIndex = 0
let charIndex = 0
let isDeleting = false

function tickPlaceholder() {
  if (email.value.length > 0 || isTyping.value) return

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

// Typewriter Simulation for Demo Logins
async function simulateTypewriter(personaKey) {
  const persona = DEMO_PERSONAS[personaKey]
  if (!persona || isTyping.value) return

  isTyping.value = true
  email.value = ''
  password.value = ''
  errorMsg.value = ''

  const targetEmail = persona.email
  const targetPassword = 'password123'

  for (let i = 0; i < targetEmail.length; i++) {
    email.value += targetEmail[i]
    await new Promise(r => setTimeout(r, 22))
  }
  await new Promise(r => setTimeout(r, 150))

  for (let i = 0; i < targetPassword.length; i++) {
    password.value += targetPassword[i]
    await new Promise(r => setTimeout(r, 22))
  }
  await new Promise(r => setTimeout(r, 250))

  isTyping.value = false
  emit('login', {
    personaId: persona.id,
    email: persona.email,
    name: persona.name,
    role: persona.role,
    club: persona.cca,
    allowedClubs: persona.allowedClubs,
    isDev: persona.isDev,
    smartSearches: persona.smartSearches,
  })
}

// 1-Click Institutional SSO Selection (Microsoft / Google)
function openSsoModal(provider) {
  activeSsoProvider.value = provider
  showSsoModal.value = true
}

function selectSsoAccount(personaKey) {
  const persona = DEMO_PERSONAS[personaKey]
  showSsoModal.value = false
  emit('login', {
    personaId: persona.id,
    email: persona.email,
    name: persona.name,
    role: persona.role,
    club: persona.cca,
    allowedClubs: persona.allowedClubs,
    isDev: persona.isDev,
    smartSearches: persona.smartSearches,
  })
}

function handleManualLogin() {
  if (!email.value.trim()) {
    errorMsg.value = 'Please enter your SMU institutional email.'
    return
  }
  if (!isSmuEmail.value) {
    errorMsg.value = 'Access restricted: Please enter an authorized @*.smu.edu.sg account.'
    return
  }

  // Derive persona
  const lower = email.value.trim().toLowerCase()
  let matchedPersona = DEMO_PERSONAS.rachel
  if (lower.includes('darren') || lower.includes('samba')) matchedPersona = DEMO_PERSONAS.darren
  else if (lower.includes('marcus') || lower.includes('symphonia')) matchedPersona = DEMO_PERSONAS.marcus
  else if (lower.includes('chloe') || lower.includes('admin') || lower.includes('osl')) matchedPersona = DEMO_PERSONAS.chloe
  else if (lower.includes('dev')) matchedPersona = DEMO_PERSONAS.dev
  else if (lower.includes('john') || lower.includes('doe')) matchedPersona = DEMO_PERSONAS.john

  emit('login', {
    personaId: matchedPersona.id,
    email: email.value.trim(),
    name: matchedPersona.name,
    role: derivedRole.value.type,
    club: derivedRole.value.club,
    allowedClubs: matchedPersona.allowedClubs,
    isDev: derivedRole.value.isDev,
    smartSearches: matchedPersona.smartSearches,
  })
}
</script>

<template>
  <div 
    class="min-vh-100 d-flex flex-column justify-content-center align-items-center position-relative py-5 px-3"
    style="background: radial-gradient(circle at 50% 15%, #ffffff 0%, #f8fafc 60%, #f1f5f9 100%);"
    @mousemove="handleMouseMove"
  >
    
    <!-- Cohesive Enterprise Container: Desktop & Laptop Dimension Optimized -->
    <div class="container-fluid" style="max-width: 1280px;">
      <div class="row align-items-center g-4 g-xl-5">
        
        <!-- Left Column: Unified Value Proposition & Showcase -->
        <div class="col-12 col-lg-5 col-xl-5">
          <div class="pe-lg-3">
            
            <div class="d-inline-flex align-items-center gap-2 px-3 py-1 rounded-pill bg-white border shadow-sm mb-3">
              <span class="pulse-status-dot pulse-status-confirmed"></span>
              <span class="small fw-bold text-uppercase" style="font-size: 0.7rem; letter-spacing: 0.05em; color: var(--pulse-primary);">
                SMU Office of Student Life • CCA Facilities Portal
              </span>
            </div>

            <h1 class="display-6 fw-bold tracking-tight mb-3" style="color: var(--pulse-ink); line-height: 1.15;">
              Pulse:
              <br>Centralised Facilities & Operations for SMU Student Life </br>
            </h1>

            <p class="text-muted mb-4" style="font-size: 0.95rem; line-height: 1.6;">
              The official co-curricular management platform for SMU student clubs, performance groups, and OSL administrators. Simplifies arts studio handovers, automates waitlists for in-demand venues, and streamlines rehearsal logistics across the SMU city campus.
            </p>

            <!-- Grounded Sector Showcase Cards (Subtle Floating Animation) -->
            <div class="d-flex flex-column gap-3 mb-4">
              
              <!-- Card 1: ACF Arts -->
              <div class="p-3 bg-white border rounded-3 shadow-sm d-flex align-items-start gap-3 pulse-floating-tag" style="animation-delay: 0s;">
                <div class="p-2 rounded-2 text-danger bg-danger bg-opacity-10" style="line-height: 1;">
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
              <div class="p-3 bg-white border rounded-3 shadow-sm d-flex align-items-start gap-3 pulse-floating-tag" style="animation-delay: 1.2s;">
                <div class="p-2 rounded-2 text-primary bg-primary bg-opacity-10" style="line-height: 1;">
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
              <div class="p-3 bg-white border rounded-3 shadow-sm d-flex align-items-start gap-3 pulse-floating-tag" style="animation-delay: 2.4s;">
                <div class="p-2 rounded-2 text-success bg-success bg-opacity-10" style="line-height: 1;">
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
              <span>Authenticated via SMU Institutional Single Sign-On (@*.smu.edu.sg)</span>
            </div>

          </div>
        </div>

        <!-- Right Column: Institutional SSO & Login Card (Desktop Dimension Optimized) -->
        <div class="col-12 col-lg-7 col-xl-7">
          <div class="pulse-card p-4 p-xl-4 shadow-lg border mx-auto w-100" style="max-width: 760px;">
            
            <!-- Sleek Horizontal Enterprise Header -->
            <div class="d-flex align-items-center justify-content-between mb-4 pb-3 border-bottom flex-wrap gap-2">
              <div class="d-flex align-items-center gap-3">
                <div 
                  class="d-inline-flex flex-column align-items-center justify-content-center rounded-circle shadow-sm position-relative flex-shrink-0"
                  :style="{
                    background: isPasswordFocused ? 'linear-gradient(135deg, #0f172a, #1e293b)' : 'linear-gradient(135deg, #fff1f2, #ffe4e6)',
                    transform: `perspective(600px) rotateY(${mouseX}deg) rotateX(${-mouseY}deg)`,
                    transition: 'transform 0.1s ease-out, background 0.3s ease',
                    width: '54px',
                    height: '54px',
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
                  <p class="text-muted small mb-0">SMU Student Life & Facilities Portal</p>
                </div>
              </div>

              <div class="d-inline-flex align-items-center gap-2 px-3 py-1 rounded-pill bg-light border text-muted small" style="font-size: 0.675rem;">
                <span class="pulse-status-dot pulse-status-confirmed" style="width: 6px; height: 6px;"></span>
                <span>Session: Active • SMU OASIS SSO</span>
              </div>
            </div>

            <!-- Two-Column Internal Split: Credentials (Left) & Quick-Select Personas (Right) -->
            <div class="row g-4 align-items-stretch">
              
              <!-- Sub-Column 1: Institutional SSO & Credentials Form -->
              <div class="col-12 col-md-6 pe-md-4 border-end-md d-flex flex-column justify-content-between">
                <div>
                  <div class="d-flex justify-content-between align-items-center mb-2">
                    <span class="text-muted small fw-bold text-uppercase" style="font-size: 0.68rem; letter-spacing: 0.05em;">
                      Institutional SSO
                    </span>
                    <span class="badge bg-secondary-subtle text-dark border" style="font-size: 0.65rem;">OAuth 2.0</span>
                  </div>

                  <!-- Institutional SSO Quick Buttons -->
                  <div class="d-flex flex-column gap-2 mb-3">
                    <button
                      type="button"
                      class="btn btn-outline-secondary py-2 px-3 d-flex align-items-center justify-content-between rounded-3 border bg-white shadow-sm sso-btn"
                      @click="openSsoModal('Microsoft 365')"
                    >
                      <div class="d-flex align-items-center gap-2">
                        <svg width="17" height="17" viewBox="0 0 23 23">
                          <path fill="#f35325" d="M1 1h10v10H1z"/>
                          <path fill="#81bc06" d="M12 1h10v10H12z"/>
                          <path fill="#05a6f0" d="M1 12h10v10H1z"/>
                          <path fill="#ffba08" d="M12 12h10v10H12z"/>
                        </svg>
                        <span class="fw-semibold text-dark" style="font-size: 0.82rem;">Sign in with Microsoft</span>
                      </div>
                      <span class="badge bg-light text-muted border flex-shrink-0" style="font-size: 0.65rem;">SMU OASIS</span>
                    </button>

                    <button
                      type="button"
                      class="btn btn-outline-secondary py-2 px-3 d-flex align-items-center justify-content-between rounded-3 border bg-white shadow-sm sso-btn"
                      @click="openSsoModal('Google Workspace')"
                    >
                      <div class="d-flex align-items-center gap-2">
                        <svg width="17" height="17" viewBox="0 0 24 24">
                          <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.66v3.05h3.9c2.27-2.09 3.645-5.18 3.645-9.15z"/>
                          <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.9-3.05c-1.08.72-2.45 1.16-4.03 1.16-3.1 0-5.74-2.1-6.68-4.91H1.21v3.13C3.26 21.48 7.33 24 12 24z"/>
                          <path fill="#FBBC05" d="M5.32 14.29c-.24-.73-.38-1.5-.38-2.29s.14-1.56.38-2.29V6.58H1.21C.44 8.11 0 9.99 0 12s.44 3.89 1.21 5.42l4.11-3.13z"/>
                          <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.52 1.21 6.58l4.11 3.13c.94-2.81 3.58-4.96 6.68-4.96z"/>
                        </svg>
                        <span class="fw-semibold text-dark" style="font-size: 0.82rem;">Sign in with Google</span>
                      </div>
                      <span class="badge bg-light text-muted border flex-shrink-0" style="font-size: 0.65rem;">SMU Google</span>
                    </button>
                  </div>

                  <!-- Divider -->
                  <div class="position-relative text-center my-3">
                    <hr class="text-muted opacity-25 m-0">
                    <span class="position-absolute top-50 start-50 translate-middle bg-white px-2 text-muted small" style="font-size: 0.675rem; text-transform: uppercase; letter-spacing: 0.05em;">
                      or credentials
                    </span>
                  </div>

                  <!-- Error Banner -->
                  <div v-if="errorMsg" class="alert alert-danger py-2 px-3 small rounded-3 mb-2" role="alert">
                    {{ errorMsg }}
                  </div>

                  <!-- Manual Form -->
                  <form @submit.prevent="handleManualLogin">
                    
                    <!-- SMU Email with Dynamic Typewriter Placeholder -->
                    <div class="mb-2">
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
                          :disabled="isTyping"
                          required
                          style="font-size: 0.825rem;"
                        />
                      </div>

                      <!-- Domain Validation Tag -->
                      <div v-if="email.trim()" class="mt-1">
                        <span v-if="isSmuEmail" class="badge bg-success bg-opacity-10 text-success border border-success-subtle" style="font-size: 0.68rem;">
                          Verified: <strong>{{ derivedRole?.name }}</strong>
                        </span>
                        <span v-else class="badge bg-danger bg-opacity-10 text-danger border border-danger-subtle" style="font-size: 0.68rem;">
                          Restricted to @*.smu.edu.sg
                        </span>
                      </div>
                    </div>

                    <!-- Password Input -->
                    <div class="mb-3">
                      <div class="d-flex justify-content-between align-items-center mb-1">
                        <label class="form-label small fw-bold text-muted mb-0" style="font-size: 0.75rem;">Password</label>
                        <span class="text-muted" style="font-size: 0.68rem;">SMU OASIS</span>
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
                          type="password" 
                          class="form-control border-start-0" 
                          placeholder="••••••••••••"
                          :disabled="isTyping"
                          @focus="isPasswordFocused = true"
                          @blur="isPasswordFocused = false"
                          required
                          style="font-size: 0.825rem;"
                        />
                      </div>
                    </div>

                    <button 
                      type="submit" 
                      class="btn btn-pulse-primary w-100 py-2 fw-bold d-flex align-items-center justify-content-center gap-2 shadow-sm"
                      :disabled="isTyping"
                      style="font-size: 0.85rem;"
                    >
                      <span>Sign In to Workspace</span>
                      <span>→</span>
                    </button>
                  </form>
                </div>
              </div>

              <!-- Sub-Column 2: 1-Click Typewriter Demo Personas -->
              <div class="col-12 col-md-6 ps-md-4 d-flex flex-column justify-content-between">
                <div>
                  <div class="d-flex justify-content-between align-items-center mb-2">
                    <span class="text-muted small fw-bold text-uppercase" style="font-size: 0.68rem; letter-spacing: 0.05em;">
                      Quick-Select Demo Personas
                    </span>
                    <span v-if="isTyping" class="badge bg-danger rounded-pill px-2 py-0 pulse-auto-typing-badge" style="font-size: 0.65rem;">
                      Auto-Typing...
                    </span>
                    <span v-else class="badge bg-light text-muted border" style="font-size: 0.65rem;">
                      1-Click Sign-In
                    </span>
                  </div>
                  
                  <p class="text-muted small mb-2" style="font-size: 0.725rem;">
                    Instant evaluator simulation with scoped club permissions:
                  </p>

                  <div class="d-flex flex-column gap-2">
                    
                    <!-- Persona 1: Rachel Tan (Eurhythmix ExCo) -->
                    <button 
                      type="button" 
                      class="btn btn-sm btn-outline-secondary text-start p-2 px-3 rounded-3 d-flex justify-content-between align-items-center bg-white persona-tile"
                      :disabled="isTyping"
                      @click="simulateTypewriter('rachel')"
                    >
                      <div class="me-2 text-truncate">
                        <strong class="d-block text-dark text-truncate" style="font-size: 0.78rem;">Rachel Tan (Eurhythmix ExCo)</strong>
                        <small class="text-muted d-block text-truncate" style="font-size: 0.68rem;">rachel.tan.2024@scis.smu.edu.sg • Eurhythmix</small>
                      </div>
                      <span class="badge bg-danger bg-opacity-10 text-danger border flex-shrink-0" style="font-size: 0.68rem;">Eurhythmix</span>
                    </button>

                    <!-- Persona 2: Darren Koh (Samba Masala ExCo) -->
                    <button 
                      type="button" 
                      class="btn btn-sm btn-outline-secondary text-start p-2 px-3 rounded-3 d-flex justify-content-between align-items-center bg-white persona-tile"
                      :disabled="isTyping"
                      @click="simulateTypewriter('darren')"
                    >
                      <div class="me-2 text-truncate">
                        <strong class="d-block text-dark text-truncate" style="font-size: 0.78rem;">Darren Koh (Samba Masala ExCo)</strong>
                        <small class="text-muted d-block text-truncate" style="font-size: 0.68rem;">darren.koh.2024@business.smu.edu.sg • Samba</small>
                      </div>
                      <span class="badge bg-warning bg-opacity-25 text-dark border flex-shrink-0" style="font-size: 0.68rem;">Samba Masala</span>
                    </button>

                    <!-- Persona 3: Marcus Lim (SMU Symphonia ExCo) -->
                    <button 
                      type="button" 
                      class="btn btn-sm btn-outline-secondary text-start p-2 px-3 rounded-3 d-flex justify-content-between align-items-center bg-white persona-tile"
                      :disabled="isTyping"
                      @click="simulateTypewriter('marcus')"
                    >
                      <div class="me-2 text-truncate">
                        <strong class="d-block text-dark text-truncate" style="font-size: 0.78rem;">Marcus Lim (SMU Symphonia ExCo)</strong>
                        <small class="text-muted d-block text-truncate" style="font-size: 0.68rem;">marcus.lim.2024@socsc.smu.edu.sg • Symphonia</small>
                      </div>
                      <span class="badge bg-info bg-opacity-10 text-dark border flex-shrink-0" style="font-size: 0.68rem;">Symphonia</span>
                    </button>

                    <!-- Persona 4: Chloe Ang (OSL Facility Administrator) -->
                    <button 
                      type="button" 
                      class="btn btn-sm btn-outline-secondary text-start p-2 px-3 rounded-3 d-flex justify-content-between align-items-center bg-white persona-tile"
                      :disabled="isTyping"
                      @click="simulateTypewriter('chloe')"
                    >
                      <div class="me-2 text-truncate">
                        <strong class="d-block text-dark text-truncate" style="font-size: 0.78rem;">Chloe Ang (OSL Facility Admin)</strong>
                        <small class="text-muted d-block text-truncate" style="font-size: 0.68rem;">chloe.ang@smu.edu.sg • Administrative Sign-Off</small>
                      </div>
                      <span class="badge bg-dark text-white flex-shrink-0" style="font-size: 0.68rem;">OSL Staff</span>
                    </button>

                    <!-- Persona 5: Dev / Super Admin (All CCAs View) -->
                    <button 
                      type="button" 
                      class="btn btn-sm btn-outline-secondary text-start p-2 px-3 rounded-3 d-flex justify-content-between align-items-center bg-white persona-tile"
                      :disabled="isTyping"
                      @click="simulateTypewriter('dev')"
                    >
                      <div class="me-2 text-truncate">
                        <strong class="d-block text-dark text-truncate" style="font-size: 0.78rem;">Dev Administrator (All CCAs)</strong>
                        <small class="text-muted d-block text-truncate" style="font-size: 0.68rem;">dev.admin@smu.edu.sg • All 24 CCAs Unlocked</small>
                      </div>
                      <span class="badge text-white flex-shrink-0" style="background-color: var(--pulse-purple-transit); font-size: 0.68rem;">Dev View</span>
                    </button>

                  </div>
                </div>
              </div>

            </div>

            <!-- Guest Explorer Link (Card Footer) -->
            <div class="border-top pt-3 mt-4 text-center">
              <button 
                type="button" 
                class="btn btn-link text-muted small text-decoration-none guest-link"
                @click="emit('explore')"
              >
                Skip sign-in and explore live facility calendar as guest →
              </button>
            </div>

          </div>
        </div>

      </div>
    </div>

    <!-- Modal: Simulated Institutional SSO Account Picker (Microsoft / Google) -->
    <div 
      v-if="showSsoModal" 
      class="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center p-3"
      style="background: rgba(15, 23, 42, 0.65); backdrop-filter: blur(4px); z-index: 2000;"
    >
      <div class="card shadow-lg border-0 p-4 w-100" style="max-width: 440px; border-radius: 1rem;">
        
        <div class="d-flex justify-content-between align-items-start mb-3">
          <div>
            <div class="d-flex align-items-center gap-2 mb-1">
              <span class="badge bg-secondary-subtle text-dark" style="font-size: 0.7rem;">Institutional SSO</span>
              <span class="small text-muted">{{ activeSsoProvider }}</span>
            </div>
            <h5 class="fw-bold mb-0">Choose an SMU Account</h5>
          </div>
          <button type="button" class="btn-close" @click="showSsoModal = false"></button>
        </div>

        <p class="text-muted small mb-3">
          Select an authenticated university identity to continue to Pulse Workspace:
        </p>

        <div class="d-flex flex-column gap-2 mb-3">
          
          <button 
            v-for="(persona, key) in DEMO_PERSONAS" 
            :key="key"
            type="button"
            class="btn btn-outline-light text-dark text-start p-2 border rounded-3 d-flex justify-content-between align-items-center hover-bg-light"
            @click="selectSsoAccount(key)"
          >
            <div>
              <div class="fw-bold" style="font-size: 0.825rem;">{{ persona.name }}</div>
              <small class="text-muted" style="font-size: 0.725rem;">{{ persona.email }}</small>
            </div>
            <span class="badge bg-light text-muted border" style="font-size: 0.7rem;">{{ persona.roleLabel }}</span>
          </button>

        </div>

        <button type="button" class="btn btn-light w-100 btn-sm text-muted" @click="showSsoModal = false">
          Cancel
        </button>

      </div>
    </div>

  </div>
</template>

<style scoped>
.persona-tile {
  transition: all 0.16s ease-in-out;
  border-color: #e2e8f0;
}

.persona-tile:hover:not(:disabled) {
  transform: translateX(3px);
  border-color: var(--pulse-primary, #e11d48);
  background-color: #fff1f2 !important;
}

.sso-btn {
  transition: all 0.15s ease-in-out;
  border-color: #e2e8f0;
}

.sso-btn:hover {
  border-color: #cbd5e1;
  background-color: #f8fafc !important;
  transform: translateY(-1px);
}

.guest-link {
  transition: color 0.15s ease;
}

.guest-link:hover {
  color: var(--pulse-primary, #e11d48) !important;
}

@media (min-width: 768px) {
  .border-end-md {
    border-right: 1px solid rgba(226, 232, 240, 0.8) !important;
  }
}

.pulse-auto-typing-badge {
  animation: pulse-badge-glow 1.5s infinite;
}

@keyframes pulse-badge-glow {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.8;
    transform: scale(1.05);
  }
}

:deep(body.dark-mode) .border-end-md {
  border-right-color: rgba(51, 65, 85, 0.8) !important;
}

:deep(body.dark-mode) .persona-tile {
  background-color: #1e293b !important;
  border-color: #334155;
  color: #f1f5f9;
}

:deep(body.dark-mode) .persona-tile strong {
  color: #f8fafc !important;
}

:deep(body.dark-mode) .persona-tile:hover:not(:disabled) {
  background-color: #0f172a !important;
  border-color: var(--pulse-primary, #e11d48);
}

:deep(body.dark-mode) .sso-btn {
  background-color: #1e293b !important;
  border-color: #334155;
  color: #f1f5f9;
}

:deep(body.dark-mode) .sso-btn span.text-dark {
  color: #f1f5f9 !important;
}
</style>
