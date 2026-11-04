<script setup>
// Purpose: Edit disruption dates/times within the selected event using explicit Singapore calendar boundaries.
import {computed, reactive, ref, watch} from 'vue'
import {eventDates, scheduleRange, disruptionTimeOptions, formatPickerTime} from '../services/disruptionScheduleService.js'
const props = defineProps({event:Object, start:String, end:String, disabled:Boolean, id:String, index:Number})
const emit = defineEmits(['update:start','update:end'])
const dates = reactive({start:'',end:''})
const feedback = ref('')
const fields = [{key:'start',title:'From',label:'Unavailable from (Singapore)'},{key:'end',title:'Until',label:'Unavailable until (Singapore)'}]
const availableDates = computed(() => eventDates(props.event))
const unavailable = computed(() => props.disabled || !scheduleRange(props.event))
watch(() => [props.start,props.end,props.event], () => {
 for (const key of ['start','end']) if (props[key]) dates[key] = props[key].slice(0,10)
 if (!scheduleRange(props.event)) dates.start = dates.end = ''
}, {immediate:true})
watch(() => props.event, () => { feedback.value = '' })
const options = key => disruptionTimeOptions(props.event, dates[key], props[key] ? dates[key]+'T'+props[key].split('T')[1] : '')
// Compare instants rather than timestamp strings: minute and fractional-second
// representations can differ even when they denote the same Singapore time.
const instant = value => Date.parse(value + '+08:00')
function permitted(key, value) {
 const other = props[key === 'start' ? 'end' : 'start']
 return !other || (key === 'start' ? instant(value) < instant(other) : instant(value) > instant(other))
}
function dateUnavailable(key, date) {
 return !disruptionTimeOptions(props.event,date,props[key]).some(value => permitted(key,value))
}
// Recalculate valid time choices after changing the calendar date, keeping supported precise values when possible.
function chooseDate(key, date) {
 if (!availableDates.value.includes(date) || dateUnavailable(key,date)) return
 dates[key] = date
 const candidate = date + 'T' + (props[key]?.split('T')[1] || '')
 if (options(key).includes(candidate) && permitted(key,candidate)) {
  emit('update:'+key,candidate)
 } else {
  // A changed date must not quietly clamp the user's time to another boundary.
  emit('update:'+key,'')
  feedback.value = 'Date changed. Choose an available ' + (key === 'start' ? 'From' : 'Until') + ' time for this date.'
 }
}
// Emit the selected event-bounded local timestamp; no schedule record is edited here.
function chooseTime(key, value) {
 if (!options(key).includes(value) || !permitted(key,value)) {
  feedback.value = 'This time is unavailable. Until must be later than From and both must be within the event schedule.'
  return
 }
 feedback.value = ''
 emit('update:'+key,value)
}
function formatDate(date) {
 return new Date(date+'T00:00:00+08:00').toLocaleDateString('en-SG',{timeZone:'Asia/Singapore',day:'2-digit',month:'short',year:'numeric'})
}
</script>

<template>
 <div class="disruption-interval">
  <fieldset v-for="field in fields" :key="field.key" class="interval-section" :disabled="unavailable">
   <legend>{{ field.title }}</legend>
   <div class="interval-controls">
    <div class="interval-control">
     <label :for="id+'-'+field.key+'-date'">Date</label>
     <div class="calendar-control">
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v5m10-5v5M3 11h18"/></svg>
      <select :id="id+'-'+field.key+'-date'" :aria-label="(field.key==='start'?'Start':'End')+' date for disruption '+index" :value="dates[field.key]" @change="chooseDate(field.key,$event.target.value)" class="form-select">
       <option value="" disabled>Select date</option>
       <option v-for="date in availableDates" :key="date" :value="date" :disabled="dateUnavailable(field.key,date)">{{ formatDate(date) }}{{ dateUnavailable(field.key,date) ? ' (unavailable)' : '' }}</option>
      </select>
     </div>
    </div>
    <div class="interval-control">
     <label :for="id+'-'+field.key">Time</label>
     <select :id="id+'-'+field.key" :aria-label="field.label" :value="props[field.key] || ''" :aria-describedby="id+'-picker-help'" @change="chooseTime(field.key,$event.target.value)" class="form-select">
      <option value="" disabled>Select time</option>
      <option v-if="props[field.key] && !options(field.key).includes(props[field.key])" :value="props[field.key]" disabled>Unavailable selection</option>
      <option v-for="time in options(field.key)" :key="time" :value="time" :disabled="!permitted(field.key,time)">{{ formatPickerTime(time) }}{{ !permitted(field.key,time) ? ' (unavailable)' : '' }}</option>
     </select>
    </div>
   </div>
  </fieldset>
  <p :id="id+'-picker-help'" class="small text-muted mb-0">Singapore time. Only event dates and times are available. Until must be later than From.</p>
  <p v-if="feedback" role="status" class="small text-warning-emphasis mb-0">{{ feedback }}</p>
 </div>
</template>

<style scoped>
.disruption-interval{display:grid;gap:.85rem;margin-top:.75rem;min-width:0}
.interval-section{min-width:0;margin:0;padding:0;border:0}
.interval-section legend{float:none;width:auto;font-size:.9rem;font-weight:700;margin-bottom:.4rem;color:var(--pulse-ink)}
.interval-controls{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:.55rem}
.interval-control{min-width:0}.interval-control label{font-size:.75rem;color:var(--pulse-ink-muted);margin-bottom:.25rem}
.interval-control .form-select{width:100%;min-width:0;border:1px solid var(--pulse-border);border-radius:.65rem;background-color:var(--pulse-card-bg);color:var(--pulse-ink);font-size:.8rem;min-height:44px;padding-left:.6rem;padding-right:1.5rem;background-position:right .4rem center;background-size:12px}
.calendar-control{position:relative}.calendar-control svg{position:absolute;left:.55rem;top:50%;transform:translateY(-50%);width:1rem;height:1rem;pointer-events:none;color:var(--pulse-primary)}
.calendar-control .form-select{padding-left:1.7rem}.interval-control select:disabled{opacity:.6}
.interval-control select:focus-visible{outline:2px solid var(--pulse-primary);outline-offset:2px}
@media(max-width:575px){.interval-control .form-select{font-size:.8rem!important}}
</style>
