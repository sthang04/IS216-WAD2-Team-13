<script setup>
import { ref, reactive, onUnmounted } from 'vue';
import { checkSignupEligibility, signUpExco } from '../services/authService';
import { canLinkTelegram, fetchTelegramLinked, openTelegramLink } from '../services/notificationService';
import PasswordVisibilityToggle from '../components/PasswordVisibilityToggle.vue';

const emit = defineEmits(['done', 'cancel']);

// Step 1: check the email is on OSL's ExCo list. Step 2: set up the profile, role and password.
// Step 3: connect Telegram. A bot can't message someone until they press Start, so a handle alone can't do this.
const step = ref(1)
const email = ref('')
const ccas = ref([]) // set by OSL; one per CCA they lead
const roles = ref([]) // [{ code, name }] from exco_roles
const fullName = ref('')
const positions = reactive({}) // { [cca]: role_code }
const telegramHandle = ref('')
const password = ref('')
const confirmPassword = ref('')
const showPassword = ref(false)
const errorMsg = ref('')
const isSubmitting = ref(false)
const newPersona = ref(null)
const savedHandle = ref('')
const telegramOpened = ref(false)
const telegramLinked = ref(false)
let linkTimer = null

function stopCheckingLink() {
  clearInterval(linkTimer)
  linkTimer = null
}

onUnmounted(stopCheckingLink)

async function handleConnectTelegram() {
  errorMsg.value = ''
  try {
    await openTelegramLink()
  } catch (err) {
    errorMsg.value = err.message
    return
  }
  telegramOpened.value = true
  // The bot links them when they press Start, so keep checking until that happens
  stopCheckingLink()
  linkTimer = setInterval(async () => {
    if (await fetchTelegramLinked()) {
      telegramLinked.value = true
      stopCheckingLink()
    }
  }, 3000)
}

function finishSignUp() {
  stopCheckingLink()
  emit('done', newPersona.value)
}

async function handleCheckEmail() {
  errorMsg.value = ''
  isSubmitting.value = true
  try {
    const result = await checkSignupEligibility(email.value)
    email.value = result.email
    ccas.value = result.ccas
    roles.value = result.roles
    // Prefill with the name OSL whitelisted; they can still correct it
    if (result.fullName) fullName.value = result.fullName
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

  if (!fullName.value.trim() || ccas.value.some((cca) => !positions[cca])) {
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
      positions: Object.fromEntries(ccas.value.map((cca) => [cca, positions[cca]])),
      telegramHandle: handle,
      password: password.value,
    })
    newPersona.value = persona
    savedHandle.value = handle
    if (await canLinkTelegram(email.value)) {
      step.value = 3
    } else {
      finishSignUp()
    }
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
        <span class="badge bg-danger text-white rounded-pill px-3 py-1" style="font-size: 0.7rem; font-weight: 800; letter-spacing: 0.05em;">PULSE</span>
        <span class="text-muted small">ExCo Sign Up • Step {{ step }} of 3</span>
      </div>
      <h4 class="fw-bold mb-1">{{ step === 3 ? 'Connect your Telegram' : 'Create your ExCo account' }}</h4>
      <p class="text-muted small mb-3">
        {{ step === 3
          ? 'Your account is ready. Connect Telegram to get slot release, meeting and run-of-show alerts from the Pulse bot.'
          : 'Only ExCo members on OSL’s approved list can create an account.' }}
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
        <button type="submit" class="btn btn-pulse-primary text-white w-100 py-2.5 fw-bold d-flex align-items-center justify-content-center gap-2 shadow-sm" :disabled="isSubmitting">
          <span v-if="isSubmitting" class="spinner-border spinner-border-sm text-white" role="status"></span>
          <span class="text-white">Continue →</span>
        </button>
      </form>

      <!-- Step 2: profile + password (CCA comes from OSL's list and can't be changed) -->
      <form v-else-if="step === 2" @submit.prevent="handleCreateAccount">
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

        <!-- One role per CCA (roles can differ between CCAs); it sets what they can do in Pulse -->
        <div v-for="(cca, index) in ccas" :key="cca" class="mb-3">
          <label :for="`signupPosition${index}`" class="form-label small fw-bold text-muted mb-1">
            {{ ccas.length > 1 ? `ExCo position in ${cca}` : 'ExCo position' }}
          </label>
          <select :id="`signupPosition${index}`" v-model="positions[cca]" class="form-select">
            <option value="" disabled>Choose your role</option>
            <option v-for="r in roles" :key="r.code" :value="r.code">{{ r.name }}</option>
          </select>
        </div>

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

        <button type="submit" class="btn btn-pulse-primary text-white w-100 py-2.5 fw-bold d-flex align-items-center justify-content-center gap-2 shadow-sm" :disabled="isSubmitting">
          <span v-if="isSubmitting" class="spinner-border spinner-border-sm text-white" role="status"></span>
          <span class="text-white">Create account ✓</span>
        </button>
        <button type="button" class="btn btn-link w-100 text-muted small mt-1 text-decoration-none" :disabled="isSubmitting" @click="backToEmail">
          Use a different email
        </button>
      </form>

      <!-- Step 3: pressing Start in the bot links this account to their Telegram -->
      <div v-else>
        <div v-if="telegramLinked" class="alert alert-success py-2 px-3 small rounded-3 mb-3" role="status">
          ✓ Telegram connected. Your Pulse alerts will arrive there.
        </div>
        <template v-else>
          <p class="small mb-2">Sign in to Telegram as <strong>@{{ savedHandle }}</strong>, then press <strong>Start</strong> in the bot.</p>
          <p v-if="telegramOpened" class="text-muted small mb-3" role="status">Waiting for you to press Start in Telegram…</p>
          <button type="button" class="btn btn-pulse-primary text-white w-100 py-2.5 fw-bold shadow-sm mb-2" @click="handleConnectTelegram">
            <span class="text-white">{{ telegramOpened ? 'Open Telegram again' : 'Connect Telegram' }}</span>
          </button>
        </template>
        <button v-if="telegramLinked" type="button" class="btn btn-pulse-primary text-white w-100 py-2.5 fw-bold shadow-sm" @click="finishSignUp">
          <span class="text-white">Continue to Pulse →</span>
        </button>
        <button v-else type="button" class="btn btn-link w-100 text-muted small text-decoration-none" @click="finishSignUp">
          Skip for now
        </button>
        <p v-if="!telegramLinked" class="text-muted text-center mb-0" style="font-size: 0.72rem;">You can connect later from the notification bell.</p>
      </div>

      <button v-if="step !== 3" type="button" class="btn btn-link w-100 text-muted small text-decoration-none" :disabled="isSubmitting" @click="emit('cancel')">
        Already have an account? Sign in
      </button>

    </div>
  </div>
</template>
