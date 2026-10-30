<script setup>
import { ref, computed, watch } from 'vue'
import {
  addDays, weekStartOf, formatWeekLabel, defaultWeekStart, singaporeToday, formatDate,
  transferCutoffDate, CALENDAR_END
} from '../services/facilityService'

// Drawn like a desk calendar: a header with binder rings, then one tile per day.
const props = defineProps({
  weekStart: { type: String, required: true },
  // Optional { 'YYYY-MM-DD': { available, pending } } shown on each day tile.
  dayCounts: { type: Object, default: null },
  // Optional day filter (v-model:selected-day); null means the whole week.
  selectedDay: { type: String, default: null },
  selectable: { type: Boolean, default: false }
})
const emit = defineEmits(['update:weekStart', 'update:selectedDay'])

const minWeek = computed(() => weekStartOf(singaporeToday()))
const maxWeek = computed(() => weekStartOf(CALENDAR_END))
const label = computed(() => formatWeekLabel(props.weekStart))
const isDefault = computed(() => props.weekStart === defaultWeekStart())
const monthLabel = computed(() =>
  new Date(`${props.weekStart}T00:00:00Z`).toLocaleDateString('en-SG', { month: 'long', year: 'numeric', timeZone: 'UTC' }))

// Tells people up front which days in this week can still be transferred.
const lockNote = computed(() => {
  const cutoff = transferCutoffDate()
  const weekEnd = addDays(props.weekStart, 6)
  if (cutoff <= props.weekStart) return { open: true, text: 'Every day this week is open for transfers' }
  if (cutoff > weekEnd) return { open: false, text: 'This whole week is inside the 4-day lock' }
  return { open: true, text: `Transfers open from ${formatDate(cutoff)} (4-day rule)` }
})

const days = computed(() => {
  const today = singaporeToday()
  const cutoff = transferCutoffDate()
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(props.weekStart, i)
    const d = new Date(`${date}T00:00:00Z`)
    return {
      date,
      weekday: d.toLocaleDateString('en-SG', { weekday: 'short', timeZone: 'UTC' }),
      day: d.getUTCDate(),
      today: date === today,
      locked: date < cutoff,
      outside: date > CALENDAR_END,
      counts: props.dayCounts?.[date] || null
    }
  })
})

// Moving forward tears the page off upwards; moving back flips it down into place.
const flip = ref('next')
watch(() => props.weekStart, (next, prev) => { flip.value = next > prev ? 'next' : 'prev' })

function shift(weeks) {
  const next = addDays(props.weekStart, weeks * 7)
  if (next < minWeek.value || next > maxWeek.value) return
  emit('update:selectedDay', null)
  emit('update:weekStart', next)
}

function jumpTo(value) {
  if (!value) return
  const week = weekStartOf(value)
  if (week < minWeek.value || week > maxWeek.value) return
  emit('update:selectedDay', null)
  emit('update:weekStart', week)
}

function pickDay(day) {
  if (!props.selectable || day.outside) return
  emit('update:selectedDay', props.selectedDay === day.date ? null : day.date)
}
</script>

<template>
  <section class="pulse-cal mb-4">
    <header class="pulse-cal-head">
      <span class="pulse-cal-ring left" aria-hidden="true"></span>
      <span class="pulse-cal-ring right" aria-hidden="true"></span>

      <div>
        <div class="pulse-cal-month">{{ monthLabel }}</div>
        <div class="d-flex align-items-center gap-2 flex-wrap">
          <Transition name="swap" mode="out-in">
            <h2 :key="label" class="h4 fw-bold mb-0">{{ label }}</h2>
          </Transition>
          <span v-if="isDefault" class="pulse-cal-chip">Next week</span>
          <button v-else type="button" class="pulse-cal-link" @click="emit('update:weekStart', defaultWeekStart())">
            Back to next week
          </button>
        </div>
      </div>

      <div class="d-flex align-items-center gap-2">
        <button type="button" class="pulse-cal-arrow" aria-label="Previous week" :disabled="weekStart <= minWeek" @click="shift(-1)">‹</button>
        <label class="visually-hidden" for="week-jump">Jump to week</label>
        <input
          id="week-jump"
          type="date"
          class="form-control form-control-sm pulse-cal-jump"
          title="Jump to week"
          :value="weekStart"
          :min="minWeek"
          :max="CALENDAR_END"
          @change="jumpTo($event.target.value)"
        />
        <button type="button" class="pulse-cal-arrow" aria-label="Next week" :disabled="weekStart >= maxWeek" @click="shift(1)">›</button>
      </div>
    </header>

    <div class="pulse-cal-pad">
      <Transition :name="`pulse-tear-${flip}`">
    <div :key="weekStart" class="pulse-cal-grid pulse-cal-sheet" role="list">
      <component
        :is="selectable ? 'button' : 'div'"
        v-for="day in days"
        :key="day.date"
        role="listitem"
        :type="selectable ? 'button' : undefined"
        class="pulse-cal-day"
        :class="{ today: day.today, locked: day.locked, outside: day.outside, selected: selectedDay === day.date, selectable }"
        :aria-pressed="selectable ? selectedDay === day.date : undefined"
        :title="day.locked ? 'Inside the 4-day lock: no transfers' : ''"
        @click="pickDay(day)"
      >
        <span class="pulse-cal-weekday">{{ day.weekday }}</span>
        <span class="pulse-cal-num">{{ day.day }}</span>
        <span v-if="day.today" class="pulse-cal-mark" aria-label="Today">✓</span>
        <span v-else-if="day.locked" class="pulse-cal-mark" aria-label="Locked">🔒</span>
        <span v-if="day.counts" class="pulse-cal-counts">
          <span v-if="day.counts.available" class="pulse-cal-pill claim">{{ day.counts.available }} open</span>
          <span v-if="day.counts.pending" class="pulse-cal-pill sky">{{ day.counts.pending }} pending</span>
        </span>
      </component>
    </div>
      </Transition>
    </div>

    <footer class="pulse-cal-foot">
      <span class="pulse-lock-note" :class="{ open: lockNote.open }">
        <span class="pulse-dot"></span>{{ lockNote.text }}
      </span>
      <span v-if="selectable" class="text-muted small">
        {{ selectedDay ? `Showing ${formatDate(selectedDay)} only.` : 'Pick a day to show only that day.' }}
        <button v-if="selectedDay" type="button" class="btn btn-link btn-sm p-0 align-baseline" @click="emit('update:selectedDay', null)">Show whole week</button>
      </span>
    </footer>
  </section>
</template>
