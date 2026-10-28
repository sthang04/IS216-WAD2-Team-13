<script setup>
import { computed } from 'vue'

// Options come from the facilities table, not from hard-coded metadata.
const props = defineProps({
  facilities: { type: Array, required: true },
  filters: { type: Object, required: true },
  weekLabel: { type: String, default: '' }
})
const emit = defineEmits(['update:filters'])

const CAPACITY_OPTIONS = [
  { value: 'any', label: 'Any capacity' },
  { value: '1-25', label: '1–25 people' },
  { value: '26-50', label: '26–50 people' },
  { value: '51-150', label: '51–150 people' },
  { value: '151+', label: '150+ people' }
]

const AVAILABILITY_OPTIONS = [
  { value: 'All', label: 'All statuses' },
  { value: 'Booked', label: 'Booked' },
  { value: 'Proposed Peer Transfer', label: 'Proposed (available to claim)' },
  { value: 'Pending Admin Sign-off', label: 'Pending Admin Sign-off' },
  { value: 'Officially Confirmed Booking', label: 'Officially Confirmed' }
]


const typeOptions = computed(() => [...new Set(props.facilities.map(f => f.facility_type))].sort())
const equipmentOptions = computed(() => [...new Set(props.facilities.flatMap(f => f.equipment || []))].sort())

function update(key, value) {
  emit('update:filters', { ...props.filters, [key]: value })
}
</script>

<template>
  <section class="pulse-panel p-3 p-lg-4 mb-4">
    <div class="mb-3">
      <div>
        <h2 class="h6 fw-bold mb-0">Facilities for {{ weekLabel }}</h2>
      </div>
    </div>


    <div class="row g-3">
      <div class="col-12 col-md-6 col-xl-3">
        <label class="form-label small fw-bold mb-1" for="f-type">Facility Type</label>
        <select id="f-type" class="form-select" :value="filters.type" @change="update('type', $event.target.value)">
          <option value="All">All</option>
          <option v-for="type in typeOptions" :key="type" :value="type">{{ type }}</option>
        </select>
      </div>
      <div class="col-12 col-md-6 col-xl-3">
        <label class="form-label small fw-bold mb-1" for="f-equipment">Equipment</label>
        <select id="f-equipment" class="form-select" :value="filters.equipment" @change="update('equipment', $event.target.value)">
          <option value="All">All</option>
          <option v-for="item in equipmentOptions" :key="item" :value="item">{{ item }}</option>
        </select>
      </div>
      <div class="col-12 col-md-6 col-xl-3">
        <label class="form-label small fw-bold mb-1" for="f-capacity">Capacity</label>
        <select id="f-capacity" class="form-select" :value="filters.capacity" @change="update('capacity', $event.target.value)">
          <option v-for="opt in CAPACITY_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
      </div>
      <div class="col-12 col-md-6 col-xl-3">
        <label class="form-label small fw-bold mb-1" for="f-availability">Availability</label>
        <select id="f-availability" class="form-select" :value="filters.availability" @change="update('availability', $event.target.value)">
          <option v-for="opt in AVAILABILITY_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
      </div>
    </div>

    <div class="mt-3 pt-3 border-top">
      <input
        type="search"
        class="form-control pulse-search"
        placeholder="Search facility, CCA, equipment or FBS reference…"
        aria-label="Search facility, CCA, equipment or FBS reference"
        :value="filters.search"
        @input="update('search', $event.target.value)"
      />
    </div>
  </section>
</template>
