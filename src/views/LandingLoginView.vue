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
            
            <div class="d-inline-flex align-items-center gap-2 px-3 py-1 rounded-pill liquid-glass-tag mb-3 shadow-sm">
              <span class="pulse-status-dot pulse-status-confirmed"></span>
              <span class="small fw-bold text-uppercase" style="font-size: 0.7rem; letter-spacing: 0.05em; color: var(--pulse-primary);">
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
          <div class="pulse-card liquid-glass-card p-4 p-xl-4 shadow-lg border w-100" style="max-width: 500px;">
            
            <!-- Sleek Enterprise Header -->
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

              <div class="d-inline-flex align-items-center gap-1.5 px-2.5 py-1 rounded-pill bg-light border text-muted small" style="font-size: 0.675rem;">
                <span class="pulse-status-dot pulse-status-confirmed" style="width: 6px; height: 6px;"></span>
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

              <!-- Sign In CTA with Creative Shimmer & Pulse Animation -->
              <button 
                type="submit" 
                class="btn btn-pulse-primary w-100 py-2.5 fw-bold d-flex align-items-center justify-content-center gap-2 shadow-sm pulse-submit-btn text-white"
                :class="{ 'pulse-btn-submitting': isSubmitting }"
                :disabled="isSubmitting"
                style="font-size: 0.875rem;"
              >
                <span v-if="isSubmitting" class="spinner-border spinner-border-sm text-white" role="status"></span>
                <span class="text-white">{{ isSubmitting ? 'Authenticating with Supabase...' : 'Sign In' }}</span>
                <span v-if="!isSubmitting" class="text-white">→</span>
              </button>
            </form>

            <!-- New ExCos create account link -->
            <div class="text-center mt-2.5">
              <button type="button" class="btn btn-link btn-sm text-decoration-none signup-link" style="font-size: 0.78rem;" @click="emit('signup')">
                New ExCo? Create your account
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
                  <span>{{ showDemoLogins ? 'Collapse' : 'Expand (12m Demo)' }}</span>
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
  background: rgba(255, 255, 255, 0.86) !important;
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
   Sign In Button Animation & Shimmer
   ========================================================================== */
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

.signup-link {
  color: var(--pulse-primary, #e11d48);
  font-weight: 600;
  transition: opacity 0.15s ease;
}

.signup-link:hover {
  opacity: 0.8;
  text-decoration: underline !important;
}
</style>
