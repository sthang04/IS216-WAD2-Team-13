<script setup>
import { computed, ref, onMounted, onUnmounted, watch } from 'vue'
import { OTHER_CCA_FILTER } from '../services/facilityService'

// Options come from the facilities table, not from hard-coded metadata.
const props = defineProps({
  facilities: { type: Array, required: true },
  filters: { type: Object, required: true },
  weekLabel: { type: String, default: '' },
  hasActiveClub: { type: Boolean, default: false }   // "Other CCA Bookings" needs a CCA to compare against
})
const emit = defineEmits(['update:filters'])

const CAPACITY_OPTIONS = [
  { value: 'any', label: 'Any capacity' },
  { value: '1-25', label: '1–25 people' },
  { value: '26-50', label: '26–50 people' },
  { value: '51-150', label: '51–150 people' },
  { value: '151+', label: '151+ people' }
]

// Values are the database statuses; labels are what users see
const STATUS_OPTIONS = [
  { value: 'Proposed Peer Transfer', label: 'Available to Claim' },
  { value: 'Pending Admin Sign-off', label: 'Awaiting OSL approval' },
  { value: 'Booked', label: 'Booked' },
  { value: 'Officially Confirmed Booking', label: 'Officially Confirmed' }
]


const typeOptions = computed(() => [...new Set(props.facilities.map(f => f.facility_type))].sort())
const equipmentOptions = computed(() => [...new Set(props.facilities.flatMap(f => f.equipment || []))].sort())

function update(key, value) {
  emit('update:filters', { ...props.filters, [key]: value })
}

// Dynamic Animated Typewriter Placeholder for Search Box
const searchPlaceholderQueries = [
  "Search 'Dance Studio'…",
  "Search 'Studio 7.2'…",
  "Search 'Samba Masala'…",
  "Search 'Acoustic Room'…",
  "Search 'Mirrors'…",
  "Search 'ACC'…"
]

// Only suggest searches that can find a facility
const SUGGESTIONS = [
  { label: 'Dance Studios', val: 'Dance' },
  { label: 'Band & Acoustic', val: 'Acoustic' },
  { label: 'Mirrors', val: 'Mirrors' },
  { label: 'ACC Concourse', val: 'ACC' }
]
const suggestions = computed(() => SUGGESTIONS.filter((chip) => {
  const word = chip.val.toLowerCase()
  return props.facilities.some((f) => [f.name, f.location, f.facility_type, ...(f.equipment || [])].join(' ').toLowerCase().includes(word))
}))
const currentSearchPlaceholder = ref('')
let searchPlaceholderTimer = null
let sqIndex = 0
let scIndex = 0
let sqDeleting = false

function tickSearchPlaceholder() {
  if (props.filters?.search && props.filters.search.length > 0) return

  const target = searchPlaceholderQueries[sqIndex]
  if (!sqDeleting) {
    scIndex++
    currentSearchPlaceholder.value = target.substring(0, scIndex)
    if (scIndex >= target.length) {
      sqDeleting = true
      searchPlaceholderTimer = setTimeout(tickSearchPlaceholder, 1800)
      return
    }
    searchPlaceholderTimer = setTimeout(tickSearchPlaceholder, 40)
  } else {
    scIndex--
    currentSearchPlaceholder.value = target.substring(0, scIndex)
    if (scIndex <= 0) {
      sqDeleting = false
      sqIndex = (sqIndex + 1) % searchPlaceholderQueries.length
      searchPlaceholderTimer = setTimeout(tickSearchPlaceholder, 380)
      return
    }
    searchPlaceholderTimer = setTimeout(tickSearchPlaceholder, 22)
  }
}

watch(() => props.filters?.search, (newVal) => {
  if (!newVal) {
    if (searchPlaceholderTimer) clearTimeout(searchPlaceholderTimer)
    scIndex = 0
    sqDeleting = false
    searchPlaceholderTimer = setTimeout(tickSearchPlaceholder, 250)
  }
})

onMounted(() => {
  searchPlaceholderTimer = setTimeout(tickSearchPlaceholder, 400)
})

onUnmounted(() => {
  if (searchPlaceholderTimer) clearTimeout(searchPlaceholderTimer)
})
</script>

<template>
  <section class="pulse-panel p-3 p-lg-4 mb-4">
    <div class="mb-3">
      <div>
        <h2 class="h6 fw-bold mb-0">Facilities for {{ weekLabel }}</h2>
      </div>
    </div>

    <!-- Dynamic Search Box (Immediate Access on Mobile & Desktop) -->
    <div class="mb-3">
      <div class="pulse-apple-search-box position-relative">
        <svg class="pulse-search-icon position-absolute" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
        <input
          type="search"
          class="form-control pulse-search pulse-apple-input"
          :placeholder="filters.search ? '' : (currentSearchPlaceholder || 'Search facility, CCA or equipment…')"
          aria-label="Search facility, CCA or equipment"
          :value="filters.search"
          @input="update('search', $event.target.value)"
        />
        <button
          v-if="filters.search"
          type="button"
          class="btn btn-link position-absolute end-0 top-50 translate-middle-y text-muted pe-3 p-0 border-0 text-decoration-none"
          title="Clear search"
          aria-label="Clear search"
          @click="update('search', '')"
        >
          ✕
        </button>
      </div>

      <!-- Quick Suggestion Chips (Apple-style fast filters) -->
      <div class="d-flex flex-wrap align-items-center gap-1 mt-2 ps-1">
        <span v-if="suggestions.length" class="text-muted small fw-semibold me-1" style="font-size: 0.72rem;">Suggested:</span>
        <button
          v-for="chip in suggestions"
          :key="chip.label"
          type="button"
          class="btn btn-sm pulse-search-chip"
          :class="{ active: filters.search === chip.val }"
          @click="update('search', filters.search === chip.val ? '' : chip.val)"
        >
          {{ chip.label }}
        </button>
      </div>
    </div>

    <!-- 4 Filter Dropdowns -->
    <div class="row g-2 g-md-3 pt-2 border-top">
      <div class="col-6 col-md-6 col-xl-3">
        <label class="form-label small fw-bold mb-1" for="f-type">Facility Type</label>
        <select id="f-type" class="form-select form-select-sm" :value="filters.type" @change="update('type', $event.target.value)">
          <option value="All">All</option>
          <option v-for="type in typeOptions" :key="type" :value="type">{{ type }}</option>
        </select>
      </div>
      <div class="col-6 col-md-6 col-xl-3">
        <label class="form-label small fw-bold mb-1" for="f-equipment">Equipment</label>
        <select id="f-equipment" class="form-select form-select-sm" :value="filters.equipment" @change="update('equipment', $event.target.value)">
          <option value="All">All</option>
          <option v-for="item in equipmentOptions" :key="item" :value="item">{{ item }}</option>
        </select>
      </div>
      <div class="col-6 col-md-6 col-xl-3">
        <label class="form-label small fw-bold mb-1" for="f-capacity">Capacity</label>
        <select id="f-capacity" class="form-select form-select-sm" :value="filters.capacity" @change="update('capacity', $event.target.value)">
          <option v-for="opt in CAPACITY_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
      </div>
      <div class="col-6 col-md-6 col-xl-3">
        <label class="form-label small fw-bold mb-1" for="f-availability">Availability</label>
        <select id="f-availability" class="form-select form-select-sm" :value="filters.availability" @change="update('availability', $event.target.value)">
          <option value="All">All bookings</option>
          <optgroup label="By status">
            <option v-for="opt in STATUS_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </optgroup>
          <optgroup v-if="hasActiveClub" label="By CCA">
            <option :value="OTHER_CCA_FILTER">Other CCA Bookings</option>
          </optgroup>
        </select>
      </div>
    </div>
  </section>
</template>
