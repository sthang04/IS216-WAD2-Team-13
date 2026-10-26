<script setup>
import { ref, reactive } from 'vue';
import { checkSignupEligibility, signUpExco } from '../services/authService';
import PasswordVisibilityToggle from '../components/PasswordVisibilityToggle.vue';

const emit = defineEmits(['done', 'cancel']);

// Common ExCo titles; any other title can be typed in
const POSITION_SUGGESTIONS = [
  'President',
  'Vice President',
  'Honorary Finance Secretary',
  'Honorary General Secretary',
  'Logistics Director',
  'Marketing Director',
];

// Step 1: check the email is on OSL's ExCo list. Step 2: set up the profile and password.
const step = ref(1)
const email = ref('')
const ccas = ref([]) // set by OSL; one per CCA they lead
const fullName = ref('')
const positions = reactive({}) // { [cca]: title }
const telegramHandle = ref('')
const password = ref('')
const confirmPassword = ref('')
const showPassword = ref(false)
const errorMsg = ref('')
const isSubmitting = ref(false)

async function handleCheckEmail() {
  errorMsg.value = ''
  isSubmitting.value = true
  try {
    const result = await checkSignupEligibility(email.value)
    email.value = result.email
    ccas.value = result.ccas
    for (const cca of result.ccas) positions[cca] = positions[cca] || ''
    step.value = 2
  } catch (err) {
    errorMsg.value = err.message
  } finally {
    isSubmitting.value = false
  }
}

async function handleCreateAccount() {
  errorMsg.value = ''
  const handle = telegramHandle.value.trim().replace(/^@/, '')

  if (!fullName.value.trim() || ccas.value.some((cca) => !positions[cca]?.trim())) {
    errorMsg.value = ccas.value.length > 1
      ? 'Please fill in your name and your ExCo position in each CCA.'
      : 'Please fill in your name and ExCo position.'
    return
  }
  if (!/^[A-Za-z0-9_]{5,32}$/.test(handle)) {
    errorMsg.value = 'Telegram handles are 5–32 letters, numbers or underscores.'
    return
  }
  if (password.value.length < 8) {
    errorMsg.value = 'Your password needs at least 8 characters.'
    return
  }
  if (password.value !== confirmPassword.value) {
    errorMsg.value = "The two passwords don't match."
    return
  }

  isSubmitting.value = true
  try {
    const persona = await signUpExco({
      email: email.value,
      fullName: fullName.value.trim(),
      positions: Object.fromEntries(ccas.value.map((cca) => [cca, positions[cca].trim()])),
      telegramHandle: handle,
      password: password.value,
    })
    emit('done', persona)
  } catch (err) {
    errorMsg.value = err.message
  } finally {
    isSubmitting.value = false
  }
}

function backToEmail() {
  step.value = 1
  errorMsg.value = ''
}
</script>

<template>
  <div class="min-vh-100 d-flex align-items-center justify-content-center p-3" style="background-color: var(--pulse-bg);">
    <div class="card border-0 shadow-sm p-4 w-100" style="max-width: 460px; border-radius: 1rem; background-color: var(--pulse-card-bg);">

      <div class="d-flex align-items-center gap-2 mb-1">
        <span class="badge bg-danger rounded-pill px-3 py-1" style="font-size: 0.7rem; font-weight: 800; letter-spacing: 0.05em;">PULSE</span>
        <span class="text-muted small">ExCo Sign Up • Step {{ step }} of 2</span>
      </div>
      <h4 class="fw-bold mb-1">Create your ExCo account</h4>
      <p class="text-muted small mb-3">
        Only ExCos that OSL has added to the ExCo list can sign up.
      </p>

      <div v-if="errorMsg" class="alert alert-danger py-2 px-3 small rounded-3 mb-3" role="alert">
        {{ errorMsg }}
      </div>

      <!-- Step 1: SMU email, checked against the ExCo list -->
      <form v-if="step === 1" @submit.prevent="handleCheckEmail">
        <div class="mb-3">
          <label for="signupEmail" class="form-label small fw-bold text-muted mb-1">SMU email address</label>
          <input id="signupEmail" v-model="email" type="email" class="form-control" placeholder="name.2025@smu.edu.sg" autocomplete="email" required />
        </div>
        <button type="submit" class="btn btn-pulse-primary w-100 py-2 fw-bold d-flex align-items-center justify-content-center gap-2" :disabled="isSubmitting">
          <span v-if="isSubmitting" class="spinner-border spinner-border-sm" role="status"></span>
          <span>Continue</span>
        </button>
      </form>

      <!-- Step 2: profile + password (CCA comes from OSL's list and can't be changed) -->
      <form v-else @submit.prevent="handleCreateAccount">
        <div class="p-3 rounded-3 mb-3 border" style="font-size: 0.8rem;">
          <div class="d-flex justify-content-between">
            <span class="text-muted">SMU email</span>
            <strong>{{ email }}</strong>
          </div>
          <div class="d-flex justify-content-between mt-1">
            <span class="text-muted">{{ ccas.length > 1 ? 'CCAs' : 'CCA' }} (set by OSL)</span>
            <strong class="text-end">{{ ccas.join(', ') }}</strong>
          </div>
        </div>

        <div class="mb-3">
          <label for="signupName" class="form-label small fw-bold text-muted mb-1">Full name</label>
          <input id="signupName" v-model="fullName" type="text" class="form-control" placeholder="e.g. Rachel Tan" autocomplete="name" />
        </div>

        <!-- One position per CCA (titles can differ between CCAs) -->
        <div v-for="(cca, index) in ccas" :key="cca" class="mb-3">
          <label :for="`signupPosition${index}`" class="form-label small fw-bold text-muted mb-1">
            {{ ccas.length > 1 ? `ExCo position in ${cca}` : 'ExCo position' }}
          </label>
          <input :id="`signupPosition${index}`" v-model="positions[cca]" type="text" class="form-control" list="positionSuggestions" placeholder="Pick or type your title" />
        </div>
        <datalist id="positionSuggestions">
          <option v-for="title in POSITION_SUGGESTIONS" :key="title" :value="title" />
        </datalist>

        <div class="mb-3">
          <label for="signupTelegram" class="form-label small fw-bold text-muted mb-1">Telegram handle</label>
          <div class="input-group">
            <span class="input-group-text">@</span>
            <input id="signupTelegram" v-model="telegramHandle" type="text" class="form-control" placeholder="racheltan" autocomplete="off" />
          </div>
          <small class="text-muted" style="font-size: 0.72rem;">Used for slot release alerts and run-of-show updates.</small>
        </div>

        <div class="mb-3">
          <label for="signupPassword" class="form-label small fw-bold text-muted mb-1">Password</label>
          <div class="position-relative">
            <input id="signupPassword" v-model="password" :type="showPassword ? 'text' : 'password'" class="form-control pe-5" placeholder="At least 8 characters" autocomplete="new-password" />
            <PasswordVisibilityToggle :visible="showPassword" @toggle="showPassword = !showPassword" />
          </div>
        </div>

        <div class="mb-4">
          <label for="signupConfirm" class="form-label small fw-bold text-muted mb-1">Confirm password</label>
          <input id="signupConfirm" v-model="confirmPassword" :type="showPassword ? 'text' : 'password'" class="form-control" autocomplete="new-password" />
        </div>

        <button type="submit" class="btn btn-pulse-primary w-100 py-2 fw-bold d-flex align-items-center justify-content-center gap-2" :disabled="isSubmitting">
          <span v-if="isSubmitting" class="spinner-border spinner-border-sm" role="status"></span>
          <span>Create account</span>
        </button>
        <button type="button" class="btn btn-link w-100 text-muted small mt-1 text-decoration-none" :disabled="isSubmitting" @click="backToEmail">
          Use a different email
        </button>
      </form>

      <button type="button" class="btn btn-link w-100 text-muted small text-decoration-none" :disabled="isSubmitting" @click="emit('cancel')">
        Already have an account? Sign in
      </button>

    </div>
  </div>
</template>
