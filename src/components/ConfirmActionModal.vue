<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  show: { type: Boolean, default: false },
  title: { type: String, default: 'Are you sure?' },
  message: { type: String, default: '' },
  warning: { type: String, default: '' },
  details: { type: Array, default: () => [] },    // [{ label, value }]
  confirmLabel: { type: String, default: 'Confirm' },
  danger: { type: Boolean, default: false },
  reasonLabel: { type: String, default: '' },     // set to ask for a reason
  busy: { type: Boolean, default: false }
})
const emit = defineEmits(['confirm', 'cancel'])

// Escape cancels an open, idle confirmation; never interrupt a submitted request.
function cancelOnEscape(event) {
  if (event.key === 'Escape' && props.show && !props.busy) emit('cancel')
}
onMounted(() => document.addEventListener('keydown', cancelOnEscape))
onUnmounted(() => document.removeEventListener('keydown', cancelOnEscape))
const reason = ref('')
watch(() => props.show, open => { if (open) reason.value = '' })
</script>

<template>
  <div v-if="show" class="pulse-modal-backdrop" @click.self="emit('cancel')">
    <div class="pulse-modal" role="dialog" aria-modal="true" :aria-label="title">
      <h2 class="h5 fw-bold mb-2">{{ title }}</h2>
      <p v-if="message" class="text-muted small">{{ message }}</p>
      <div v-if="warning" class="pulse-modal-warning" role="alert">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0ZM12 9v4M12 17h.01"/></svg>
        <span>{{ warning }}</span>
      </div>
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
