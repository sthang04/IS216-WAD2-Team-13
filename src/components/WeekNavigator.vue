<script setup>
import { ref, computed, watch } from 'vue'
import {
  addDays, weekStartOf, formatWeekLabel, defaultWeekStart, singaporeToday, formatDate,
  transferCutoffDate, CALENDAR_END
} from '../services/facilityService'

// Drawn like a desk calendar: a header with binder rings, then one tile per day.
const props = defineProps({
  weekStart: { type: String, required: true },
  // Optional { 'YYYY-MM-DD': { available } } shown on each day tile.
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
  const today = singaporeToday()
  const cutoff = transferCutoffDate()
  const weekEnd = addDays(props.weekStart, 6)
  if (cutoff <= props.weekStart) return { open: true, text: 'Every day this week is open for transfers.' }
  if (weekEnd < today) return { open: false, text: 'This week has passed.' }
  if (cutoff > weekEnd) return { open: false, text: 'Transfer requests must be made at least 4 days before the booking.' }
  return { open: false, text: `Transfers for this week open from ${formatDate(cutoff)}. Requests must be made at least 4 days before the booking.` }
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
      passed: date < today,
      locked: date >= today && date < cutoff,
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

function slotsLabel(count) {
  return count + ' available slot' + (count === 1 ? '' : 's')
}

function openDatePicker(event) {
  try { event.target.showPicker?.() } catch { /* the browser opens its own picker */ }
}

function pickDay(day) {
  if (!props.selectable || day.outside || day.passed || day.locked) return
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
          <span v-if="isDefault" class="pulse-cal-chip">Upcoming week</span>
          <button v-else type="button" class="pulse-cal-link" @click="emit('update:weekStart', defaultWeekStart())">
            Go to upcoming week
          </button>
        </div>
      </div>

      <div class="pulse-cal-nav">
        <button type="button" class="pulse-cal-step" aria-label="Previous week" title="Previous week" :disabled="weekStart <= minWeek" @click="shift(-1)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>Previous<span class="pulse-cal-long"> week</span>
        </button>
        <label class="pulse-cal-step pulse-cal-choose" for="week-jump">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M16 3v4M8 3v4M4 11h16"/></svg>Choose date
          <input
            id="week-jump"
            type="date"
            aria-label="Jump to week"
            title="Choose date"
            :value="weekStart"
            :min="minWeek"
            :max="CALENDAR_END"
            @click="openDatePicker"
            @change="jumpTo($event.target.value)"
          />
        </label>
        <button type="button" class="pulse-cal-step" aria-label="Next week" title="Next week" :disabled="weekStart >= maxWeek" @click="shift(1)">
          Next<span class="pulse-cal-long"> week</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
        </button>
      </div>
    </header>

    <div class="pulse-cal-pad">
      <Transition :name="`pulse-tear-${flip}`">
    <div :key="weekStart" class="pulse-cal-grid pulse-cal-sheet" :role="selectable ? 'group' : 'list'" aria-label="Weekdays">
      <component
        :is="selectable ? 'button' : 'div'"
        v-for="(day, i) in days"
        :key="day.date"
        :style="{ '--i': i }"
        :role="selectable ? 'button' : 'listitem'"
        :type="selectable ? 'button' : undefined"
        class="pulse-cal-day"
        :class="{ today: day.today, locked: day.locked, passed: day.passed, outside: day.outside, selected: selectedDay === day.date, selectable: selectable && !day.passed && !day.locked }"
        :aria-pressed="selectable ? selectedDay === day.date : undefined"
        :disabled="selectable && (day.passed || day.locked || day.outside) ? true : undefined"
        :title="day.locked ? 'Transfer requests must be made at least 4 days before the booking' : day.passed ? 'This day has passed' : ''"
        @click="pickDay(day)"
      >
        <span class="pulse-cal-top">
          <span class="pulse-cal-weekday">{{ day.weekday }}</span>
          <span v-if="day.today" class="pulse-cal-tag today"><span class="pulse-cal-tag-text">Today</span></span>
          <span v-else-if="day.passed" class="pulse-cal-tag"><span class="pulse-cal-tag-text">Passed</span></span>
          <span v-else-if="day.locked" class="pulse-cal-tag locked">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg><span class="pulse-cal-tag-text">Locked</span>
          </span>
        </span>
        <span class="pulse-cal-num">{{ day.day }}</span>
        <span v-if="day.counts?.available && !day.passed && !day.locked" class="pulse-cal-entry" :aria-label="slotsLabel(day.counts.available)"><span class="pulse-cal-entry-count">{{ day.counts.available }}</span><span class="pulse-cal-entry-text"> available slot{{ day.counts.available === 1 ? '' : 's' }}</span></span>
      </component>
    </div>
      </Transition>
    </div>

    <footer class="pulse-cal-foot">
      <span class="pulse-lock-note" :class="{ open: lockNote.open }">
        <svg v-if="!lockNote.open" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
        <span v-else class="pulse-dot"></span>{{ lockNote.text }}
      </span>
      <span v-if="Object.values(dayCounts || {}).some((c) => c.available)" class="pulse-cal-key"><span class="pulse-cal-key-dot" aria-hidden="true"></span>Slots available to claim</span>
      <span v-if="selectable" class="pulse-cal-hint">
        {{ selectedDay ? `Showing ${formatDate(selectedDay)} only.` : 'Select a day to see only its bookings.' }}
        <button v-if="selectedDay" type="button" class="btn btn-link btn-sm p-0 align-baseline" @click="emit('update:selectedDay', null)">Show whole week</button>
      </span>
    </footer>
  </section>
</template>
