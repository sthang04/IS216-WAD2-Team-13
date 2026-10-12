<script setup>
import { ref, onMounted } from 'vue';
import { facilityService } from './services/facilityService';

const slots = ref([])
const loading = ref(true) 

onMounted(async () => {
  const res = await facilityService.getSlots()
  slots.value = res.data
  loading.value = false
})
</script>

<template>
  <div class="container py-4">
    <div class="d-flex justify-content-between align-items-center mb-4">
      <h2 class="fw-bold mb-0">Pulse - Master Facility Calendar</h2>
      <span class="badge bg-danger">SMU Eurhythmix</span>
    </div>

    <div v-if="loading" class="text-center py-5">
      <div class="spinner-border text-danger" role="status"></div>
      <p class="text-muted mt-2">Loading faciltiy slots...</p>
    </div>

    <div v-else class="row">
      <div v-for="slot in slots" :key="slot.id" class="col-md-6 mb-3">
        <div class="card p-3 shadow-sm h-100">
          <div class="d-flex justify-content-between align-items-start">
            <h5 class="fw-bold mb-1">{{ slot.venue_name }}</h5>
            <span class="badge bg-secondary">{{ slot.status }}</span>
            </div>
            <small class="text-muted mb-2">{{ slot.building_location }}</small>
            <p class="mb-1"><strong>Time:</strong> {{ slot.time_slot }}</p>
            <p class="mb-0 text-muted small"><strong>Owner:</strong> {{ slot.owner_club }}</p>
          </div>
        </div>
    </div>
  </div>
</template>
