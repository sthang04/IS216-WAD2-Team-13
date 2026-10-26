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

async function handleQuickLogin(personaKey) {
  const p = DEMO_PERSONAS[personaKey];
  if (!p) return;
  email.value = p.email;
  password.value = DEMO_PASSWORD;
  await completeLogin(p.email, DEMO_PASSWORD);
}

// Cursor tracking for Pulse Beacon
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

// All sign-in paths go through the auth service (real password check)
async function completeLogin(loginEmail, loginPassword) {
  errorMsg.value = ''
  isSubmitting.value = true
  try {
    const persona = await signIn(loginEmail, loginPassword)
    emit('login', persona)
  } catch (err) {
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
              <span>Sign-in restricted to SMU ExCos & OSL staff (@*.smu.edu.sg)</span>
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
                <span>Secure sign-in for SMU ExCos & OSL</span>
              </div>
            </div>

            <!-- Credentials Form & Evaluator Quick Logins -->
            <div class="row g-4 align-items-stretch">
              
              <!-- Left Column: Manual Form -->
              <div class="col-12 col-md-7 d-flex flex-column justify-content-between">
                <div>
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

                    <!-- Password Input -->
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

                    <button 
                      type="submit" 
                      class="btn btn-pulse-primary w-100 py-2 fw-bold d-flex align-items-center justify-content-center gap-2 shadow-sm"
                      :disabled="isSubmitting"
                      style="font-size: 0.85rem;"
                    >
                      <span v-if="isSubmitting" class="spinner-border spinner-border-sm" role="status"></span>
                      <span>Sign In to Workspace</span>
                      <span>→</span>
                    </button>
                  </form>

                  <!-- New ExCos create their own account (only emails on OSL's ExCo list) -->
                  <div class="text-center mt-2">
                    <button type="button" class="btn btn-link btn-sm text-decoration-none" style="font-size: 0.78rem;" @click="emit('signup')">
                      New ExCo? Create your account
                    </button>
                  </div>
                </div>
              </div>

              <!-- Right Column: Evaluator 1-Click Sign-In -->
              <div class="col-12 col-md-5 border-start-md ps-md-4 d-flex flex-column justify-content-between">
                <div>
                  <div class="d-flex align-items-center justify-content-between mb-2">
                    <span class="text-uppercase fw-bold text-muted" style="font-size: 0.675rem; letter-spacing: 0.05em;">
                      1-Click Sign-In
                    </span>
                    <span class="badge bg-secondary-subtle text-dark border" style="font-size: 0.65rem;">Demo Evaluator</span>
                  </div>
                  
                  <p class="text-muted small mb-2" style="font-size: 0.725rem;">
                    Instant evaluator simulation with scoped club permissions:
                  </p>

                  <div class="d-flex flex-column gap-2">
                    
                    <!-- Persona 1: Rachel Tan (Eurhythmix ExCo) -->
                    <button 
                      type="button" 
                      class="btn btn-sm btn-outline-secondary text-start p-2 px-3 rounded-3 d-flex justify-content-between align-items-center bg-white persona-tile"
                      :disabled="isSubmitting"
                      @click="handleQuickLogin('rachel')"
                    >
                      <div class="me-2 text-truncate">
                        <strong class="d-block text-dark text-truncate" style="font-size: 0.78rem;">Rachel Tan (Eurhythmix ExCo)</strong>
                        <small class="text-muted d-block text-truncate" style="font-size: 0.68rem;">rachel.tan.2024@scis.smu.edu.sg</small>
                      </div>
                      <span class="badge bg-danger bg-opacity-10 text-danger border flex-shrink-0" style="font-size: 0.68rem;">Eurhythmix</span>
                    </button>

                    <!-- Persona 2: Darren Koh (Samba Masala ExCo) -->
                    <button 
                      type="button" 
                      class="btn btn-sm btn-outline-secondary text-start p-2 px-3 rounded-3 d-flex justify-content-between align-items-center bg-white persona-tile"
                      :disabled="isSubmitting"
                      @click="handleQuickLogin('darren')"
                    >
                      <div class="me-2 text-truncate">
                        <strong class="d-block text-dark text-truncate" style="font-size: 0.78rem;">Darren Koh (Samba Masala ExCo)</strong>
                        <small class="text-muted d-block text-truncate" style="font-size: 0.68rem;">darren.koh.2024@business.smu.edu.sg</small>
                      </div>
                      <span class="badge bg-warning bg-opacity-25 text-dark border flex-shrink-0" style="font-size: 0.68rem;">Samba Masala</span>
                    </button>

                    <!-- Persona 3: Chloe Ang (OSL Facility Administrator) -->
                    <button 
                      type="button" 
                      class="btn btn-sm btn-outline-secondary text-start p-2 px-3 rounded-3 d-flex justify-content-between align-items-center bg-white persona-tile"
                      :disabled="isSubmitting"
                      @click="handleQuickLogin('chloe')"
                    >
                      <div class="me-2 text-truncate">
                        <strong class="d-block text-dark text-truncate" style="font-size: 0.78rem;">Chloe Ang (OSL Facility Admin)</strong>
                        <small class="text-muted d-block text-truncate" style="font-size: 0.68rem;">chloe.osl@smu.edu.sg</small>
                      </div>
                      <span class="badge bg-dark text-white flex-shrink-0" style="font-size: 0.68rem;">OSL Staff</span>
                    </button>

                    <!-- Persona 4: Dev / Super Admin (All CCAs View) -->
                    <button 
                      type="button" 
                      class="btn btn-sm btn-outline-secondary text-start p-2 px-3 rounded-3 d-flex justify-content-between align-items-center bg-white persona-tile"
                      :disabled="isSubmitting"
                      @click="handleQuickLogin('dev')"
                    >
                      <div class="me-2 text-truncate">
                        <strong class="d-block text-dark text-truncate" style="font-size: 0.78rem;">Dev Administrator (All CCAs)</strong>
                        <small class="text-muted d-block text-truncate" style="font-size: 0.68rem;">dev.admin@smu.edu.sg</small>
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
</style>
