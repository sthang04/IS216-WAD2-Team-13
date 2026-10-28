<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  show: { type: Boolean, default: false },
  title: { type: String, default: 'Are you sure?' },
  message: { type: String, default: '' },
  details: { type: Array, default: () => [] },    // [{ label, value }]
  confirmLabel: { type: String, default: 'Confirm' },
  danger: { type: Boolean, default: false },
  reasonLabel: { type: String, default: '' },     // set to ask for a reason
  busy: { type: Boolean, default: false }
})
const emit = defineEmits(['confirm', 'cancel'])

const reason = ref('')
watch(() => props.show, open => { if (open) reason.value = '' })
</script>

<template>
  <div v-if="show" class="pulse-modal-backdrop" @click.self="emit('cancel')">
    <div class="pulse-modal" role="dialog" aria-modal="true" :aria-label="title">
      <h2 class="h5 fw-bold mb-2">{{ title }}</h2>
      <p v-if="message" class="text-muted small">{{ message }}</p>
      <dl v-if="details.length" class="pulse-detail-grid small mb-3">
        <template v-for="row in details" :key="row.label">
          <dt>{{ row.label }}</dt>
          <dd>{{ row.value }}</dd>
        </template>
      </dl>
      <div v-if="reasonLabel" class="mb-3">
        <label class="form-label small fw-bold" for="modal-reason">{{ reasonLabel }}</label>
        <textarea id="modal-reason" v-model="reason" class="form-control" rows="3"></textarea>
      </div>
      <div class="d-flex justify-content-end gap-2">
        <button type="button" class="btn btn-outline-secondary" :disabled="busy" @click="emit('cancel')">Cancel</button>
        <button
          type="button"
          class="btn"
          :class="danger ? 'btn-danger' : 'btn-pulse-primary'"
          :disabled="busy || (!!reasonLabel && !reason.trim())"
          @click="emit('confirm', reason.trim())"
        >
          <span v-if="busy" class="spinner-border spinner-border-sm me-1"></span>{{ confirmLabel }}
        </button>
      </div>
    </div>
  </div>
</template>
