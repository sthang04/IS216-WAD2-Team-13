<script setup>
import { ref, onMounted, computed } from 'vue';
import { facilityService } from './services/facilityService';
import WhatIfSimulator from './components/WhatIfSimulator.vue'

const slots = ref([])
const loading = ref(true)
const processingId = ref(null)
const toast = ref('')

// ADDED: simulated role  (no real authentication).
const selectedRole = ref('club')
const selectedClub = ref('Eurhythmix')
const clubs = [
  'Ardiente',
  'Artdicted',
  'Ballare',
  'Broadcast & Entertainment',
  'Caderas Latinas',
  'Chamber Choir',
  'Chinese Orchestra',
  'Eurhythmix',
  'Funk Movement',
  'Guitarissimo',
  'INDANCITY',
  'Ivory Keys',
  'Literati',
  'Malay Language & Cultural Club',
  'SMUSAIC',
  'Samba Masala',
  'SoundFoundry',
  'Stageit',
  'Stereometa',
  'Symphonia',
  'VOIX',
  'ACF ExCo',
]
const isAdmin = computed(() => selectedRole.value === 'admin')
const profileMenuOpen = ref(false)
const toastType = ref('info')

// ADDED: venue category filter tabs (values match venue_type in the data).
const categories = [
  { label: 'All Venues', value: 'All' },
  { label: 'Dance Studios', value: 'Dance Studio' },
  { label: 'Acoustic Rooms', value: 'Acoustic Room' },
  { label: 'Sports Courts', value: 'Sports Court' },
  { label: 'Multi-Purpose', value: 'Multi-Purpose' },
]
const selectedCategory = ref('All')
const filteredSlots = computed(() =>
  selectedCategory.value === 'All'
    ? slots.value
    : slots.value.filter((slot) => slot.venue_type === selectedCategory.value)
)

function selectProfile(role) {
  selectedRole.value = role
  profileMenuOpen.value = false
  toast.value = ''
}
async function loadSlots() {
  const res = await facilityService.getSlots();
  slots.value = res.data || [];
}

//handles different facility actions
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
  await handleAction(slot,
    () => facilityService.releaseSlot(slot.id, selectedClub.value),
    `${slot.venue_name} released to marketplace!`)
}

async function handleConfirm(slot) {
  await handleAction(slot,
    () => facilityService.confirmPeerTransfer(slot.id),
    `${slot.venue_name} transfer confirmed!`)
}

async function handleClaim(slot) {
  await handleAction(slot,
    () => facilityService.claimSlot(slot.id, selectedClub.value),
    `${slot.venue_name} claim submitted for admin approval!`)
}

async function handleUndo(slot) {
  await handleAction(slot,
    () => facilityService.undoRelease(slot.id, selectedClub.value),
    `${slot.venue_name} release undone!`)
}

async function handleReject(slot) {
  await handleAction(slot,
    () => facilityService.rejectPeerTransfer(slot.id),
    `${slot.venue_name} claim rejected; slot available for claim again!`)
}

onMounted(async () => {
  try {
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
  <div class="container py-4">
    <WhatIfSimulator />
    <div class="d-flex justify-content-between align-items-center mb-4 gap-3">
      <div class="text-start">
        <h2 class="fw-bold mb-0">Pulse - Master Facility Calendar</h2>
        <div class="badge bg-danger mt-3 w-50 ">
          {{ isAdmin ? 'Facility Admin' : selectedClub + ' EXCO' }}
        </div>

      </div>

<!-- Reset button for demo page -->
      <div class="d-flex align-items-center gap-2">
        <button
          type="button"
          class="btn btn-outline-danger btn-sm"

          @click="facilityService.resetData().then(() => { loadSlots(); toast = ''; })"
        >
          Reset Demo
        </button>

      <!-- Profile menu: switch between Club EXCO and Facility Admin -->
      <div class="position-relative">
        <button
          type="button"
          class="btn btn-outline-secondary d-flex align-items-center gap-2"
          :aria-expanded="profileMenuOpen"
          @click="profileMenuOpen = !profileMenuOpen"
        >
          <span aria-hidden="true">👤</span>
          {{ isAdmin ? 'Facility Admin' : 'Club EXCO' }}
          <span aria-hidden="true">▾</span>
        </button>
        <div v-if="profileMenuOpen" class="card shadow position-absolute end-0 mt-2 p-2" style="min-width: 190px; z-index: 10;">
          <button type="button" class="btn btn-light text-start mb-1" @click="selectProfile('club')">
            Club EXCO
          </button>
          <button type="button" class="btn btn-light text-start" @click="selectProfile('admin')">
            Facility Admin
          </button>
        </div>
      </div>
    </div>
  </div>
    <!-- Club switcher appears only for Club EXCO -->
    <div v-if="!isAdmin" class="mb-3">
      <label for="clubSwitcher" class="form-label fw-bold">Club Switcher</label>
      <select id="clubSwitcher" v-model="selectedClub" class="form-select" @change="toast = ''">
        <option v-for="club in clubs" :key="club" :value="club">{{ club }}</option>
      </select>
    </div>
    <div v-else class="alert alert-light border mb-3">
      <strong>Facility Admin </strong> 
    </div>

    <!-- Venue category filter tabs -->
    <ul class="nav nav-pills mb-3">
      <li v-for="category in categories" :key="category.value" class="nav-item">
        <button
          type="button"
          class="nav-link"
          :class="{ active: selectedCategory === category.value }"
          @click="selectedCategory = category.value"
        >
          {{ category.label }}
        </button>
      </li>
    </ul>

    <!-- Original alert banner: shown only for the user clicking an action -->
    <div v-if="toast" class="alert alert-dismissible fade show" :class="`alert-${toastType}`" role="alert">
      {{ toast }}
      <button type="button" class="btn-close" @click="toast = ''"></button>
    </div>

    <div v-if="loading" class="text-center py-5">
      <div class="spinner-border text-danger" role="status"></div>
      <p class="text-muted mt-2">Loading facility slots...</p>
    </div>

    <p v-else-if="!filteredSlots.length" class="text-center text-muted py-5">
      No facility slots in this category.
    </p>

    <div v-else class="row">
      <div v-for="slot in filteredSlots" :key="slot.id" class="col-md-6 mb-3">
        <div class="card p-3 shadow-sm h-100">
          <div class="d-flex justify-content-between align-items-start">
            <h5 class="fw-bold mb-1">{{ slot.venue_name }}</h5>
            <span class="badge bg-secondary">{{ slot.status }}</span>
          </div>
          <small class="text-muted mb-2">{{ slot.building_location }}</small>
          <p class="mb-1"><strong>Time:</strong> {{ slot.time_slot }}</p>
          <p class="mb-0 text-muted small"><strong>Owner:</strong> {{ slot.owner_club }}</p>
          <p v-if="slot.claiming_club" class="mb-0 text-muted small"><strong>Claiming Club:</strong> {{ slot.claiming_club }}</p>

          <!-- Same action button section, with role-specific conditions -->
          <div class="mt-auto d-flex flex-wrap gap-2 pt-3">
            <button
              v-if="!isAdmin && slot.status === 'Booked' && slot.owner_club === selectedClub"
              class="btn btn-outline-primary btn-sm"
              :disabled="processingId !== null"
              @click="handleRelease(slot)">
              Release to Marketplace
            </button>

            <button
              v-if="!isAdmin && slot.status === 'Proposed Peer Transfer' && slot.owner_club === selectedClub"
              class="btn btn-outline-secondary btn-sm"
              :disabled="processingId !== null"
              @click="handleUndo(slot)">
              Undo Release
            </button>

            <button
              v-if="!isAdmin && slot.status === 'Proposed Peer Transfer' && slot.owner_club !== selectedClub"
              class="btn btn-primary btn-sm"
              :disabled="processingId !== null"
              @click="handleClaim(slot)">
              Claim Facility
            </button>

            <button
              v-if="isAdmin && slot.status === 'Pending Admin Sign-off'"
              class="btn btn-success btn-sm"
              :disabled="processingId !== null"
              @click="handleConfirm(slot)">
              Confirm Transfer
            </button>

            <button
              v-if="isAdmin && slot.status === 'Pending Admin Sign-off'"
              class="btn btn-outline-danger btn-sm"
              :disabled="processingId !== null"
              @click="handleReject(slot)">
              Reject Transfer
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
