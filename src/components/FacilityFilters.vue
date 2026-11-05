<script setup>
import { computed, ref, onUnmounted, watch } from 'vue'
import { OTHER_CCA_FILTER, MY_CCA_FILTER, UNAVAILABLE_FILTER } from '../services/facilityService'

// Options come from the facilities table, not from hard-coded metadata.
const props = defineProps({
  facilities: { type: Array, required: true },
  filters: { type: Object, required: true },
  weekLabel: { type: String, default: '' },
  hasActiveClub: { type: Boolean, default: false }   // "Other CCA Bookings" needs a CCA to compare against
})
const emit = defineEmits(['update:filters'])

const NO_FILTERS = { type: 'All', equipment: 'All', capacity: 'any', availability: 'All', search: '' }
const hasFilters = computed(() => Object.keys(NO_FILTERS).some((key) => props.filters[key] !== NO_FILTERS[key]))

function clearFilters() {
  emit('update:filters', { ...NO_FILTERS })
}

const CAPACITY_OPTIONS = [
  { value: 'any', label: 'Any capacity' },
  { value: '1-25', label: '1–25 people' },
  { value: '26-50', label: '26–50 people' },
  { value: '51-150', label: '51–150 people' },
  { value: '151+', label: '151+ people' }
]

// Values are the database statuses; labels are what users see
const STATUS_OPTIONS = computed(() => [
  { value: 'Proposed Peer Transfer', label: 'Available to Claim' },
  { value: 'Pending Admin Sign-off', label: 'Awaiting OSL approval' },
  { value: 'Booked', label: props.hasActiveClub ? 'Booked by my CCA' : 'Booked' },
  // With a CCA, its transferred slots are under My CCA's bookings
  ...(props.hasActiveClub
    ? [{ value: UNAVAILABLE_FILTER, label: 'Unavailable' }]
    : [{ value: 'Officially Confirmed Booking', label: 'Successfully Transferred' }])
])


const typeOptions = computed(() => [...new Set(props.facilities.map(f => f.facility_type))].sort())
const equipmentOptions = computed(() => [...new Set(props.facilities.flatMap(f => f.equipment || []))].sort())

function update(key, value) {
  emit('update:filters', { ...props.filters, [key]: value })
}

// The search box just says "Search" until someone hovers over it or clicks in,
// then the hint types out once and stays.
const RESTING_PLACEHOLDER = 'Search'
const SEARCH_HINT = 'Search for facilities, CCAs or equipment…'
const TYPING_MS = 28

const searchPlaceholder = ref(RESTING_PLACEHOLDER)
const searchHovered = ref(false)
const searchFocused = ref(false)
let typingTimer = null

function typeHint() {
  clearTimeout(typingTimer)
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    searchPlaceholder.value = SEARCH_HINT
    return
  }
  let length = 0
  const step = () => {
    length += 1
    searchPlaceholder.value = SEARCH_HINT.slice(0, length)
    if (length < SEARCH_HINT.length) typingTimer = setTimeout(step, TYPING_MS)
  }
  step()
}

watch(() => searchHovered.value || searchFocused.value, (active) => {
  if (active) {
    typeHint()
  } else {
    clearTimeout(typingTimer)
    searchPlaceholder.value = RESTING_PLACEHOLDER
  }
})

onUnmounted(() => clearTimeout(typingTimer))
</script>

<template>
  <section class="pulse-panel p-3 p-lg-4 mb-4">
    <div class="mb-3 d-flex flex-wrap align-items-center justify-content-between gap-2">
      <h2 class="h6 fw-bold mb-0">Facilities for {{ weekLabel }}</h2>
      <button type="button" class="pulse-clear-filters" :disabled="!hasFilters" @click="clearFilters">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>Clear filters
      </button>
    </div>

    <!-- Dynamic Search Box (Immediate Access on Mobile & Desktop) -->
    <div class="mb-3">
      <div class="pulse-apple-search-box position-relative" @mouseenter="searchHovered = true" @mouseleave="searchHovered = false">
        <svg class="pulse-search-icon position-absolute" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
        <input
          type="text"
          class="form-control pulse-search pulse-apple-input"
          :placeholder="searchPlaceholder"
          aria-label="Search facility, CCA or equipment"
          :value="filters.search"
          @focus="searchFocused = true"
          @blur="searchFocused = false"
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

      </div>

    <!-- 4 Filter Dropdowns -->
    <div class="mt-4 pt-3 border-top">
    <div class="row g-2 g-md-3">
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
          <optgroup v-if="hasActiveClub" label="By holder">
            <option :value="MY_CCA_FILTER">My CCA's bookings</option>
            <option :value="OTHER_CCA_FILTER">Other CCAs' bookings</option>
          </optgroup>
        </select>
      </div>
    </div>
    </div>
  </section>
</template>
