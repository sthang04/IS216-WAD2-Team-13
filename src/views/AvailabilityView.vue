<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { supabase } from '../supabase'; // Ensure relative path to your supabase client is correct

const props = defineProps({
  apiMode: { type: Boolean, default: true },
  readOnly: { type: Boolean, default: false }
});

const emit = defineEmits(['back', 'meeting-scheduled']);

/* ================================================================== */
/* 1. BASICS: toast message + guest check                              */
/* ================================================================== */
const showClassBaseline = ref(true)
const toastMsg = ref('')

function showToast(msg, ms = 4000) {
  toastMsg.value = msg
  setTimeout(() => { toastMsg.value = '' }, ms)
}

function blockedForGuest() {
  if (!props.readOnly) return false
  showToast('Guest view is read-only. Sign in as a CCA ExCo to make changes.')
  return true
}

/* ================================================================== */
/* 2. DATE HELPERS                                                    */
/* ================================================================== */
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function pad(n) { return String(n).padStart(2, '0') }
function toISO(dt) { return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}` }

function parseISO(s) {
  if (!s) return null
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function addDays(dt, n) { return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + n) }
function dayIndex(dt) { return (dt.getDay() + 6) % 7 }
function mondayOf(dt) { return addDays(dt, -dayIndex(dt)) }

function shortLabel(dt) { return `${WEEKDAYS_SHORT[dt.getDay()]} ${dt.getDate()} ${MONTHS_SHORT[dt.getMonth()]}` }
function longLabel(dt) { return `${WEEKDAYS_LONG[dt.getDay()]}, ${dt.getDate()} ${MONTHS_LONG[dt.getMonth()]} ${dt.getFullYear()}` }

function hourLabel(h) { return `${pad(h)}:00` }
function hourNum(label) { return parseInt(label, 10) }

/* ================================================================== */
/* 3. WEEK NAVIGATION                                                  */
/* ================================================================== */
const EXAMPLE_WEEK_START = mondayOf(new Date()) // Defaults to current week's Monday
const weekStart = ref(EXAMPLE_WEEK_START)

const weekKey = computed(() => toISO(weekStart.value))
const weekDates = computed(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart.value, i)))
const days = computed(() => weekDates.value.map(shortLabel))

const weekRangeLabel = computed(() => {
  const first = weekDates.value[0]
  const last = weekDates.value[6]
  return `${first.getDate()} ${MONTHS_SHORT[first.getMonth()]} – ${last.getDate()} ${MONTHS_SHORT[last.getMonth()]} ${last.getFullYear()}`
})

function shiftWeek(n) {
  weekStart.value = addDays(weekStart.value, n * 7)
}
function goToExampleWeek() { weekStart.value = EXAMPLE_WEEK_START }

/* ================================================================== */
/* 4. AVAILABILITY DATA & SUPABASE INTEGRATION                         */
/* ================================================================== */
const hours = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00']
const TOTAL_MEMBERS = 12
const CURRENT_USER_ID = 1 // Rachel Tan

// Fallback example baseline count for OTHER 11 members if database has no records yet
const EXAMPLE_MATRIX = [
  [0, 8, 0, 4, 8, 0, 4, 0, 0, 0, 0, 8, 4, 0],
  [0, 0, 4, 8, 4, 0, 0, 8, 0, 4, 8, 8, 4, 0],
  [0, 0, 8, 0, 0, 0, 0, 0, 4, 8, 4, 0, 0, 8],
  [4, 8, 0, 4, 0, 8, 4, 0, 8, 11, 11, 4, 8, 0],
  [8, 4, 0, 0, 8, 0, 0, 4, 11, 11, 11, 8, 4, 0],
  [0, 0, 4, 8, 0, 4, 0, 8, 4, 0, 0, 4, 0, 4],
  [4, 0, 8, 4, 0, 0, 8, 0, 4, 8, 8, 4, 0, 8]
]

// Stores fetched Supabase records: { "dayIndex_hourIndex": Set(user_ids) }
const dbAvailabilityMap = ref({})
const isLoadingDb = ref(false)

// Slots you have clicked: Key = "weekKey|dayIndex|hourIndex", value = true/false
const myClicks = ref({})

// Fetch availability records for current week from Supabase
async function fetchWeekAvailability() {
  if (!supabase) return
  isLoadingDb.value = true

  try {
    const { data, error } = await supabase
      .from('exco_availability')
      .select('user_id, day_index, hour_index, is_available')
      .eq('week_key', weekKey.value)
      .eq('is_available', true)

    if (error) throw error

    const map = {}
    const userClicks = {}

    if (data) {
      data.forEach(row => {
        const key = `${row.day_index}_${row.hour_index}`
        if (!map[key]) map[key] = new Set()
        map[key].add(row.user_id)

        // Sync local click state for the current logged in user
        if (row.user_id === CURRENT_USER_ID) {
          userClicks[`${weekKey.value}|${row.day_index}|${row.hour_index}`] = true
        }
      })
    }

    dbAvailabilityMap.value = map
    myClicks.value = { ...myClicks.value, ...userClicks }
  } catch (err) {
    console.warn('Supabase fetch failed, utilizing baseline matrix:', err.message)
  } finally {
    isLoadingDb.value = false
  }
}

// Watch weekKey changes to load data dynamically
watch(weekKey, () => {
  fetchWeekAvailability()
}, { immediate: true })

// Are YOU available in this slot?
function isMine(wk, d, h) {
  const clicked = myClicks.value[`${wk}|${d}|${h}`]
  return clicked === undefined ? false : clicked
}

// Compute total free members dynamically from Supabase or fallback matrix
function getCount(wk, d, h) {
  const key = `${d}_${h}`
  const userSet = dbAvailabilityMap.value[key]

  if (userSet && userSet.size > 0) {
    let count = userSet.size
    const userInSet = userSet.has(CURRENT_USER_ID)
    const localMine = isMine(wk, d, h)
    
    // Adjust real-time if local state differs from synced database state
    if (localMine && !userInSet) count++
    if (!localMine && userInSet) count--
    
    return Math.max(0, Math.min(TOTAL_MEMBERS, count))
  }

  // Fallback if no database data exists for this week
  const baseOthersCount = EXAMPLE_MATRIX[d][h]
  const myStatus = isMine(wk, d, h) ? 1 : 0
  return Math.max(0, Math.min(TOTAL_MEMBERS, baseOthersCount + myStatus))
}

function heatClass(count) {
  const percent = count / TOTAL_MEMBERS
  if (percent < 0.5) return 'avail-red'
  if (percent <= 0.75) return 'avail-yellow'
  return 'avail-green'
}

function freeMemberIds(wk, d, h) {
  const key = `${d}_${h}`
  const userSet = dbAvailabilityMap.value[key]

  if (userSet && userSet.size > 0) {
    const ids = Array.from(userSet)
    const mine = isMine(wk, d, h)
    if (mine && !ids.includes(CURRENT_USER_ID)) ids.push(CURRENT_USER_ID)
    if (!mine && ids.includes(CURRENT_USER_ID)) return ids.filter(id => id !== CURRENT_USER_ID)
    return ids
  }

  const mine = isMine(wk, d, h)
  const othersFreeCount = getCount(wk, d, h) - (mine ? 1 : 0)
  const others = allMembers.filter(m => m.id !== CURRENT_USER_ID)
  const shift = (d * 4) % others.length
  const rotated = [...others.slice(shift), ...others.slice(0, shift)]

  const freeIds = rotated.slice(0, othersFreeCount).map(m => m.id)
  if (mine) freeIds.push(CURRENT_USER_ID)
  return freeIds
}

// Dynamic Click & Supabase Upsert
async function handleCellClick(d, h, dIdx, hIdx) {
  if (blockedForGuest()) return

  const nowAvailable = !isMine(weekKey.value, dIdx, hIdx)
  myClicks.value[`${weekKey.value}|${dIdx}|${hIdx}`] = nowAvailable

  // Write change to Supabase
  if (supabase) {
    try {
      const { error } = await supabase
        .from('exco_availability')
        .upsert({
          user_id: CURRENT_USER_ID,
          week_key: weekKey.value,
          day_index: dIdx,
          hour_index: hIdx,
          is_available: nowAvailable,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id,week_key,day_index,hour_index' })

      if (error) throw error
    } catch (err) {
      console.error('Failed to sync availability to Supabase:', err.message)
    }
  }

  const total = getCount(weekKey.value, dIdx, hIdx)
  const deltaText = nowAvailable ? '+1' : '-1'
  const statusText = nowAvailable ? 'Available' : 'Unavailable'

  showToast(`When2Meet: Marked Rachel Tan as ${statusText} on ${d} @ ${h} (${deltaText} member). Total: ${total}/12 members.`)
}

/* ================================================================== */
/* 5. CLASS BLOCKS & REMINDERS                                        */
/* ================================================================== */
function isClassBlock(dIdx, hIdx) {
  if (dIdx === 0 && hIdx >= 7 && hIdx <= 9) return true   // Mon: CS101
  if (dIdx === 2 && hIdx >= 7 && hIdx <= 10) return true  // Wed: IS216
  return false
}
function isClassSlot(dIdx, hIdx) { return showClassBaseline.value && isClassBlock(dIdx, hIdx) }
function getClassName(dIdx) { return dIdx === 0 ? 'CS101' : dIdx === 2 ? 'IS216' : '' }

const unconfirmedMembers = ref([
  { name: 'Darren Koh', role: 'Performance Lead', handle: '@darrenk' },
  { name: 'Marcus Tan', role: 'Stage Manager', handle: '@marcustan' },
  { name: 'Sarah Lim', role: 'Audio Tech', handle: '@sarahlim' }
])

function pingMemberOnTelegram(member) {
  if (blockedForGuest()) return
  showToast(`Telegram reminder dispatched to ${member.name} (${member.handle}): "Please confirm your availability for SMU Arts Festival rehearsals."`)
}

function pingAllOnTelegram() {
  if (blockedForGuest()) return
  showToast('Automated Telegram broadcast dispatched to all 3 unconfirmed ExCo members!')
}

/* ================================================================== */
/* 6. AI SCHEDULING ENGINE                                             */
/* ================================================================== */
const refreshCount = ref(0)
const isRefreshing = ref(false)
const lastRefreshed = ref(new Date())
const lastRefreshedLabel = computed(() => `${pad(lastRefreshed.value.getHours())}:${pad(lastRefreshed.value.getMinutes())}`)

async function refreshMatches() {
  if (isRefreshing.value) return
  isRefreshing.value = true
  await fetchWeekAvailability()
  refreshCount.value++
  lastRefreshed.value = new Date()
  isRefreshing.value = false
  showToast('Scheduling engine refreshed with live Supabase ExCo availability.', 3000)
}

const bestCount = computed(() => {
  refreshCount.value
  let best = 0
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < hours.length; h++) {
      if (!isClassBlock(d, h)) best = Math.max(best, getCount(weekKey.value, d, h))
    }
  }
  return best
})

function isBestSlot(d, h) {
  return !isClassBlock(d, h) && getCount(weekKey.value, d, h) === bestCount.value
}

const bestMatches = computed(() => {
  if (bestCount.value === 0) return []
  const matches = []

  for (let d = 0; d < 7; d++) {
    let h = 0
    while (h < hours.length) {
      if (isBestSlot(d, h)) {
        const startHour = h
        while (h < hours.length && isBestSlot(d, h)) h++
        matches.push({
          iso: toISO(weekDates.value[d]),
          label: longLabel(weekDates.value[d]),
          start: hours[startHour],
          end: hourLabel(8 + h),
          duration: h - startHour
        })
      } else {
        h++
      }
    }
  }
  return matches
})

/* ================================================================== */
/* 7. MEETING SELECTION & FORM                                         */
/* ================================================================== */
const selectedSlot = ref({ date: toISO(new Date()), start: '16:00', end: '19:00' })
const startOptions = hours
const endOptions = computed(() =>
  [...hours, '22:00'].filter(t => hourNum(t) > hourNum(selectedSlot.value.start))
)

function isMatchSelected(m) {
  return selectedSlot.value.date === m.iso && selectedSlot.value.start === m.start && selectedSlot.value.end === m.end
}
function selectMatch(m) {
  selectedSlot.value = { date: m.iso, start: m.start, end: m.end }
}

watch(() => selectedSlot.value.start, () => {
  if (!endOptions.value.includes(selectedSlot.value.end)) {
    selectedSlot.value.end = endOptions.value[0]
  }
})

watch(() => selectedSlot.value.date, (newDate) => {
  const dt = parseISO(newDate)
  if (dt) weekStart.value = mondayOf(dt)
})

const slotReport = computed(() => {
  const dt = parseISO(selectedSlot.value.date)
  if (!dt) return null

  const wk = toISO(mondayOf(dt))
  const d = dayIndex(dt)
  const firstHour = hourNum(selectedSlot.value.start)
  const lastHour = hourNum(selectedSlot.value.end)

  const busyHoursByMember = {}
  let classClash = ''

  for (let hour = firstHour; hour < lastHour; hour++) {
    const h = hour - 8
    if (isClassBlock(d, h)) classClash = getClassName(d)

    const freeIds = freeMemberIds(wk, d, h)
    allMembers.forEach(m => {
      if (!freeIds.includes(m.id)) {
        if (!busyHoursByMember[m.id]) busyHoursByMember[m.id] = []
        busyHoursByMember[m.id].push(hourLabel(hour))
      }
    })
  }

  const unavailable = allMembers
    .filter(m => busyHoursByMember[m.id])
    .map(m => ({ id: m.id, name: m.name, role: m.role, busyAt: busyHoursByMember[m.id].join(', ') }))

  return {
    dateLabel: longLabel(dt),
    unavailable,
    freeCount: allMembers.length - unavailable.length,
    classClash
  }
})

/* ================================================================== */
/* 8. MODAL & EXPORT                                                   */
/* ================================================================== */
const showMeetingModal = ref(false)
const meetingConfirmed = ref(false)
const meetingForm = ref({
  date: longLabel(new Date()),
  time: '16:00 – 19:00',
  title: 'SMU Eurhythmix — Arts Festival Run-of-Show Alignment',
  venue: 'SMU Connexion Meeting Room 3',
  agenda: '1. Stage positioning & lighting cues alignment (Act 1 & 2)\n2. OneMap transit buffer and performer holding area protocol\n3. Address late performer check-in protocols and props handover',
  attendees: 12
})

const allMembers = [
  { id: 1, name: 'Rachel Tan', handle: '@racheltan', role: 'President', subcommittee: 'Executive' },
  { id: 2, name: 'Angel Low', handle: '@angellow', role: 'Vice President & Lead Dancer', subcommittee: 'Dancers' },
  { id: 3, name: 'Rachel Chua', handle: '@rachelc', role: 'Choreography Lead', subcommittee: 'Dancers' },
  { id: 4, name: 'Darren Koh', handle: '@darrenk', role: 'Logistics & Props Head', subcommittee: 'Logistics' },
  { id: 5, name: 'Marcus Lim', handle: '@marcuslim', role: 'Sound & Tech Specialist', subcommittee: 'Technical' },
  { id: 6, name: 'Sarah Lim', handle: '@sarahlim', role: 'Rehearsal Coordinator', subcommittee: 'Dancers' },
  { id: 7, name: 'Kevin Wong', handle: '@kevinw', role: 'Marketing & Ticketing Head', subcommittee: 'Marketing' },
  { id: 8, name: 'Chloe Goh', handle: '@chloeg', role: 'Wardrobe & Costume Lead', subcommittee: 'Logistics' },
  { id: 9, name: 'Benjamin Teo', handle: '@benteo', role: 'Stage Operations Lead', subcommittee: 'Technical' },
  { id: 10, name: 'Nadia Syafira', handle: '@nadias', role: 'Welfare Director', subcommittee: 'Executive' },
  { id: 11, name: 'Isaac Tan', handle: '@isaact', role: 'Finance Director', subcommittee: 'Executive' },
  { id: 12, name: 'Valerie Chee', handle: '@valeriec', role: 'Front-of-House Manager', subcommittee: 'Marketing' },
]

const selectedRecipientIds = ref([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
const recipientSearch = ref('')

const filteredRecipients = computed(() => {
  const query = recipientSearch.value.trim().toLowerCase()
  if (!query) return allMembers
  return allMembers.filter(m =>
    m.name.toLowerCase().includes(query) ||
    m.handle.toLowerCase().includes(query) ||
    m.role.toLowerCase().includes(query) ||
    m.subcommittee.toLowerCase().includes(query)
  )
})

function selectAllRecipients() { selectedRecipientIds.value = allMembers.map(m => m.id) }
function selectDancersOnly() { selectedRecipientIds.value = allMembers.filter(m => m.subcommittee === 'Dancers').map(m => m.id) }
function selectLogisticsOnly() { selectedRecipientIds.value = allMembers.filter(m => m.subcommittee === 'Logistics' || m.subcommittee === 'Technical').map(m => m.id) }
function selectExecutiveOnly() { selectedRecipientIds.value = allMembers.filter(m => m.subcommittee === 'Executive').map(m => m.id) }

function toggleRecipient(id) {
  if (selectedRecipientIds.value.includes(id)) {
    if (selectedRecipientIds.value.length === 1) return
    selectedRecipientIds.value = selectedRecipientIds.value.filter(i => i !== id)
  } else {
    selectedRecipientIds.value.push(id)
  }
}

function openMeetingModal() {
  if (blockedForGuest()) return
  const dt = parseISO(selectedSlot.value.date)
  if (dt) meetingForm.value.date = longLabel(dt)
  meetingForm.value.time = `${selectedSlot.value.start} – ${selectedSlot.value.end}`
  showMeetingModal.value = true
}

function confirmAndBroadcastMeeting() {
  meetingConfirmed.value = true
  showMeetingModal.value = false

  exportToCalendar(meetingForm.value)

  const count = selectedRecipientIds.value.length
  const sampleHandles = allMembers
    .filter(m => selectedRecipientIds.value.includes(m.id))
    .slice(0, 3)
    .map(m => m.handle)
    .join(', ')
  const handlesText = count > 3 ? `${sampleHandles} +${count - 3} more` : sampleHandles

  showToast(`Meeting scheduled! Telegram broadcast dispatched to ${count} members (${handlesText}) with agenda and calendar invite.`, 6000)

  emit('meeting-scheduled', {
    title: meetingForm.value.title,
    day: meetingForm.value.date,
    time: meetingForm.value.time,
    venue: meetingForm.value.venue,
    agenda: meetingForm.value.agenda,
    recipientsCount: count
  })
}

function toUtcStamp(iso, time) {
  const [y, m, d] = iso.split('-').map(Number)
  const utc = new Date(Date.UTC(y, m - 1, d, hourNum(time) - 8))
  return utc.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function exportToCalendar(details = null) {
  const slot = selectedSlot.value
  if (!parseISO(slot.date)) {
    showToast('Pick a valid date before exporting to calendar.', 3000)
    return
  }

  const title = details?.title || 'SMU Eurhythmix ExCo Weekly Logistics Sync'
  const location = details?.venue || 'SMU Connexion Meeting Room 3'
  const description = details?.agenda || 'Weekly logistics review for SMU Arts Festival Opening Night run-of-show. Exported via Pulse Availability Finder.'

  const icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SMU Pulse//Meeting Scheduler//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:pulse-meeting-${slot.date}-${slot.start.replace(':', '')}@smu.edu.sg`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,
    `DTSTART:${toUtcStamp(slot.date, slot.start)}`,
    `DTEND:${toUtcStamp(slot.date, slot.end)}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${description.replace(/\n/g, '\\n')}`,
    `LOCATION:${location}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n')

  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' })
  const link = document.createElement('a')
  link.href = window.URL.createObjectURL(blob)
  link.setAttribute('download', 'smu-eurhythmix-meeting.ics')
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)

  if (!details) {
    showToast('Downloaded smu-eurhythmix-meeting.ics! Open file to add to Google, Outlook, or Apple Calendar.', 4500)
  }
}
</script>

<template>
  <div class="py-2">

    <!-- Top Bar with Navigation & Actions -->
    <div class="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-4">
      <div>
        <div class="d-flex align-items-center gap-2 mb-1">
          <span class="badge bg-danger rounded-pill px-2 py-1" style="font-size: 0.65rem; font-weight: 800;">FEATURE 2</span>
          <span v-if="apiMode" class="pulse-api-tag">Supabase DB Availability Query</span>
          <span v-if="apiMode" class="pulse-api-tag">iCalendar RFC 5545 API</span>
        </div>
        <h3 class="fw-bold mb-1">Weekly ExCo Availability Finder</h3>
        <p class="text-muted small mb-0">
          Aggregates schedules across 12 ExCos with timetable pre-loading, eliminating fragmented Telegram polls.
        </p>
      </div>

      <div class="d-flex flex-wrap gap-2">
        <!-- Toggle Recurring Class Blocks -->
        <button
          type="button"
          class="btn btn-sm btn-pulse-outline d-flex align-items-center gap-2"
          @click="showClassBaseline = !showClassBaseline"
        >
          <span>{{ showClassBaseline ? '✓' : '○' }}</span>
          <span>Show Class Baselines (IS216, CS101)</span>
        </button>

        <!-- 1-Click iCal Export -->
        <button
          type="button"
          class="btn btn-sm btn-pulse-primary d-flex align-items-center gap-2"
          @click="exportToCalendar()"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
          </svg>
          <span>Sync to Calendar (.ics)</span>
        </button>
      </div>
    </div>

    <!-- Alert Banner -->
    <div v-if="toastMsg" class="alert alert-success border-0 shadow-sm mb-4 d-flex align-items-center gap-2" role="alert">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
        <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
      </svg>
      <span>{{ toastMsg }}</span>
    </div>

    <!-- Colour legend -->
    <div class="card border-0 shadow-sm p-3 mb-4" style="border-radius: 1rem;">
      <div class="d-flex flex-wrap align-items-center gap-3 small fw-bold">
        <span class="d-flex align-items-center gap-1">
          <span class="legend-swatch" style="background: #f6dcdc;"></span>
          Below 50% free
        </span>
        <span class="d-flex align-items-center gap-1">
          <span class="legend-swatch" style="background: #fbf1cc;"></span>
          50–75% free
        </span>
        <span class="d-flex align-items-center gap-1">
          <span class="legend-swatch" style="background: #d9efe0;"></span>
          Above 75% free
        </span>
        <span class="d-flex align-items-center gap-1">
          <span class="legend-swatch" style="background: #16a34a; outline: 2px solid #6b7280; outline-offset: -2px;"></span>
          Brighter = you're available
        </span>
      </div>
    </div>

    <!-- Main Content: Grid + Sidebar -->
    <div class="row g-4">

      <!-- Left: Heatmap Grid -->
      <div class="col-lg-8">
        <div class="pulse-card p-3 shadow-sm">

          <!-- Week navigation -->
          <div class="d-flex flex-wrap align-items-center gap-2 mb-3 px-1">
            <button type="button" class="btn btn-sm btn-outline-secondary px-2 py-0" aria-label="Previous week" @click="shiftWeek(-1)">‹</button>
            <div class="fw-bold small text-center" style="min-width: 170px;">{{ weekRangeLabel }}</div>
            <button type="button" class="btn btn-sm btn-outline-secondary px-2 py-0" aria-label="Next week" @click="shiftWeek(1)">›</button>
            <button
              v-if="weekStart.getTime() !== EXAMPLE_WEEK_START.getTime()"
              type="button"
              class="btn btn-sm btn-link text-decoration-none py-0"
              style="font-size: 0.7rem;"
              @click="goToExampleWeek"
            >
              Back to example week
            </button>
          </div>

          <!-- When2Meet helper -->
          <div class="d-flex align-items-center gap-2 mb-2 px-1">
            <span class="badge bg-primary bg-opacity-10 text-primary border border-primary-subtle fw-bold" style="font-size: 0.675rem;">
              When2Meet Mode Active
            </span>
            <span class="text-muted small" style="font-size: 0.725rem;">
              Click any slot to add/remove your personal availability. Total available ExCos update live.
            </span>
          </div>

          <div class="table-responsive">
            <table class="table table-borderless align-middle mb-0 text-center" style="min-width: 650px;">
              <thead>
                <tr class="border-bottom">
                  <th style="width: 70px; font-size: 0.75rem;" class="text-muted text-uppercase">Time</th>
                  <th v-for="d in days" :key="d" style="font-size: 0.775rem;" class="fw-bold">
                    {{ d }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(h, hIdx) in hours" :key="h">
                  <td class="text-muted small fw-semibold py-1" style="font-size: 0.7rem;">{{ h }}</td>

                  <td v-for="(d, dIdx) in days" :key="d" class="p-1" style="height: 3.25rem;">

                    <!-- Class block -->
                    <div
                      v-if="isClassSlot(dIdx, hIdx)"
                      class="pulse-class-pill rounded-2"
                      :title="`Recurring Academic Timetable: ${getClassName(dIdx)}`"
                      @click="showToast(`${getClassName(dIdx)} Class Timetable: Fixed commitment for ${d} @ ${h}.`)"
                    >
                      <span class="pulse-class-name">{{ getClassName(dIdx) }}</span>
                      <span class="pulse-class-sub">SMU Core</span>
                    </div>

                    <!-- Normal heatmap cell: colour depends on how many are free -->
                    <div
                      v-else
                      class="pulse-heat-cell rounded-2 position-relative"
                      :class="[
                        heatClass(getCount(weekKey, dIdx, hIdx)),
                        isMine(weekKey, dIdx, hIdx) ? 'pulse-heat-my-active' : ''
                      ]"
                      :title="`${d} @ ${h}: ${getCount(weekKey, dIdx, hIdx)}/12 available. Click to toggle your personal availability (When2Meet style)`"
                      @click="handleCellClick(d, h, dIdx, hIdx)"
                    >
                      <span v-if="getCount(weekKey, dIdx, hIdx) > 0" class="pulse-heat-count">
                        {{ getCount(weekKey, dIdx, hIdx) }}/12
                      </span>
                      <span v-else class="pulse-heat-empty">-</span>

                      <span
                        v-if="isMine(weekKey, dIdx, hIdx)"
                        class="position-absolute top-0 end-0 translate-middle-y me-1 badge rounded-pill bg-primary shadow-sm"
                        style="font-size: 0.5rem; padding: 0.15rem 0.35rem;"
                      >
                        You
                      </span>
                    </div>

                  </td>
                </tr>
              </tbody>
            </table>
          </div>

        </div>
      </div>

      <!-- Right: Sidebar -->
      <div class="col-lg-4">

        <!-- Card 1: AI Scheduling Engine (all best matches) -->
        <div class="pulse-card p-4 shadow-sm mb-4 border-start border-success border-4">
          <div class="d-flex justify-content-between align-items-start gap-2 mb-1">
            <div>
              <div class="text-uppercase fw-bold text-success small" style="font-size: 0.7rem; letter-spacing: 0.08em;">
                AI Scheduling Engine
              </div>
              <h5 class="fw-bold mb-0">
                {{ bestCount === 0 ? 'No Match This Week' : bestMatches.length === 1 ? 'Best Match Found' : 'Best Matches Found' }}
              </h5>
            </div>
            <button
              type="button"
              class="btn btn-sm btn-outline-success d-flex align-items-center gap-1"
              :disabled="isRefreshing"
              @click="refreshMatches"
            >
              <span v-if="isRefreshing" class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
              <span style="font-size: 0.75rem;">{{ isRefreshing ? 'Refreshing' : 'Refresh' }}</span>
            </button>
          </div>
          <div class="text-muted mb-3" style="font-size: 0.7rem;">
            Week of {{ weekRangeLabel }} • Updated {{ lastRefreshedLabel }}
          </div>

          <!-- Shown when nobody has all 12 free, so the best is a lower number -->
          <p v-if="bestCount > 0 && bestCount < TOTAL_MEMBERS" class="small fw-semibold text-warning-emphasis mb-2">
            No slot has all 12 free. Showing the slots where the most people ({{ bestCount }}/12) can make it.
          </p>

          <!-- One card per best window. Scrolls if there are many. -->
          <div v-if="bestMatches.length" class="match-list d-flex flex-column gap-2 mb-2">
            <div
              v-for="m in bestMatches"
              :key="m.iso + m.start"
              class="match-card"
              :class="{ selected: isMatchSelected(m) }"
              role="button"
              @click="selectMatch(m)"
            >
              <div class="fw-bold small">{{ m.label }}</div>
              <div class="small">{{ m.start }} – {{ m.end }} ({{ m.duration }} hour{{ m.duration > 1 ? 's' : '' }})</div>
              <div class="small fw-semibold mt-1" :class="bestCount === TOTAL_MEMBERS ? 'text-success' : 'text-warning-emphasis'">
                {{ bestCount === TOTAL_MEMBERS ? '✓ All 12 ExCo members available' : `${bestCount}/12 ExCo members available` }}
              </div>
            </div>
          </div>
          <p v-else class="text-muted small mb-2">
            Nobody is free on any slot this week. Try another week with the arrows above the grid.
          </p>

          <p class="text-muted small mb-0">
            Click a match to select it, or pick your own date below. Class blocks are excluded. Scroll the list if there are more matches.
          </p>
        </div>

        <!-- Card 2: Pick any date and see who is unavailable -->
        <div class="pulse-card p-4 shadow-sm mb-4">
          <div class="text-uppercase fw-bold text-muted small" style="font-size: 0.65rem; letter-spacing: 0.08em;">Meeting Slot</div>
          <h6 class="fw-bold mb-3">Pick Any Date &amp; Time</h6>

          <div class="row g-2 mb-3">
            <div class="col-12">
              <label class="form-label small fw-bold text-muted mb-1">Date</label>
              <input v-model="selectedSlot.date" type="date" class="form-control form-control-sm fw-bold" />
            </div>
            <div class="col-6">
              <label class="form-label small fw-bold text-muted mb-1">From</label>
              <select v-model="selectedSlot.start" class="form-select form-select-sm">
                <option v-for="t in startOptions" :key="t" :value="t">{{ t }}</option>
              </select>
            </div>
            <div class="col-6">
              <label class="form-label small fw-bold text-muted mb-1">To</label>
              <select v-model="selectedSlot.end" class="form-select form-select-sm">
                <option v-for="t in endOptions" :key="t" :value="t">{{ t }}</option>
              </select>
            </div>
          </div>

          <template v-if="slotReport">
            <!-- Everyone is free -->
            <div
              v-if="slotReport.unavailable.length === 0"
              class="p-3 rounded-3 bg-success bg-opacity-10 text-success border border-success-subtle mb-3"
            >
              <div class="fw-bold small">{{ slotReport.dateLabel }}</div>
              <div class="small">{{ selectedSlot.start }} – {{ selectedSlot.end }}</div>
              <div class="small fw-semibold mt-1">✓ All 12 ExCo members available</div>
            </div>

            <!-- Some people are unavailable: list them -->
            <div v-else class="p-3 rounded-3 bg-danger bg-opacity-10 border border-danger-subtle mb-3">
              <div class="fw-bold small text-danger-emphasis">{{ slotReport.dateLabel }}</div>
              <div class="small text-danger-emphasis">{{ selectedSlot.start }} – {{ selectedSlot.end }}</div>
              <div class="small fw-semibold mt-1 text-danger-emphasis">
                {{ slotReport.freeCount }}/12 free for the whole window • {{ slotReport.unavailable.length }} unavailable
              </div>
              <div class="d-flex flex-column gap-1 mt-2">
                <div
                  v-for="u in slotReport.unavailable"
                  :key="u.id"
                  class="d-flex justify-content-between align-items-center gap-2 bg-light rounded-2 border px-2 py-1"
                >
                  <div>
                    <strong class="small d-block">{{ u.name }}</strong>
                    <span class="text-muted" style="font-size: 0.675rem;">{{ u.role }}</span>
                  </div>
                  <span class="text-muted text-end" style="font-size: 0.675rem;">Unavailable: {{ u.busyAt }}</span>
                </div>
              </div>
            </div>

            <div
              v-if="slotReport.classClash"
              class="small text-warning-emphasis bg-warning bg-opacity-10 border border-warning-subtle rounded-3 p-2 mb-3"
            >
              ⚠ This window overlaps the recurring {{ slotReport.classClash }} class block.
            </div>
          </template>
          <p v-else class="text-muted small mb-3">Select a date to see who is free.</p>

          <!-- Shown after a meeting has been confirmed -->
          <div v-if="meetingConfirmed" class="p-3 rounded-3 bg-success bg-opacity-10 border border-success mb-3 text-success small">
            <div class="fw-bold">Meeting Confirmed & Broadcasted!</div>
            <div class="mt-1 text-muted" style="font-size: 0.725rem;">
              {{ meetingForm.title }} • {{ meetingForm.date }} ({{ meetingForm.time }}) at {{ meetingForm.venue }}.
            </div>
          </div>

          <button
            type="button"
            class="btn btn-pulse-primary w-100 py-2 fw-bold mb-2"
            :disabled="!slotReport"
            @click="openMeetingModal()"
          >
            {{ meetingConfirmed ? 'Edit / Reschedule Meeting' : 'Create Meeting & Broadcast Agenda' }}
          </button>

          <button
            type="button"
            class="btn btn-outline-secondary w-100 btn-sm py-1 fw-semibold"
            :disabled="!slotReport"
            @click="exportToCalendar(meetingForm)"
          >
            Export to Calendar (.ics)
          </button>
        </div>

        <!-- Card 3: Telegram reminders for unconfirmed members -->
        <div class="pulse-card p-4 shadow-sm">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <div>
              <div class="text-uppercase fw-bold text-muted small" style="font-size: 0.65rem;">Prof K Recommendation</div>
              <h6 class="fw-bold mb-0">Unconfirmed Timetables</h6>
            </div>
            <span class="badge bg-warning bg-opacity-25 text-dark border border-warning" style="font-size: 0.65rem;">
              {{ unconfirmedMembers.length }} Pending
            </span>
          </div>
          <p class="text-muted small mb-3">
            These members haven't updated their weekly availability. Nudge them directly on Telegram with one tap.
          </p>

          <div class="d-flex flex-column gap-2 mb-3">
            <div
              v-for="m in unconfirmedMembers"
              :key="m.name"
              class="d-flex justify-content-between align-items-center p-2 rounded-3 bg-light border"
            >
              <div>
                <strong class="small d-block">{{ m.name }}</strong>
                <span class="text-muted" style="font-size: 0.7rem;">{{ m.role }} ({{ m.handle }})</span>
              </div>
              <button
                type="button"
                class="btn btn-sm btn-outline-primary py-1 px-2 fw-bold"
                style="font-size: 0.7rem;"
                @click="pingMemberOnTelegram(m)"
              >
                Ping via Telegram
              </button>
            </div>
          </div>

          <button
            type="button"
            class="btn btn-outline-secondary w-100 btn-sm py-2 fw-bold"
            @click="pingAllOnTelegram"
          >
            Broadcast Reminder to All Pending (Telegram Bot)
          </button>
        </div>

      </div>

    </div>

    <!-- Create Meeting & Broadcast Agenda Modal -->
    <div v-if="showMeetingModal" class="modal-backdrop fade show" style="background: rgba(15, 23, 42, 0.65); backdrop-filter: blur(4px); z-index: 1055;"></div>
    <div v-if="showMeetingModal" class="modal fade show d-block" tabindex="-1" style="z-index: 1060;">
      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content border-0 shadow-lg rounded-4 overflow-hidden" style="background-color: var(--pulse-card-bg);">
          <div class="modal-header border-bottom px-4 py-3 bg-light">
            <div class="d-flex align-items-center gap-2">
              <div class="pulse-logo-badge" style="width: 1.85rem; height: 1.85rem; font-size: 0.9rem;">
                <span>P</span>
              </div>
              <div>
                <h5 class="modal-title fw-bold mb-0">Schedule ExCo Meeting & Broadcast Agenda</h5>
                <small class="text-muted" style="font-size: 0.75rem;">Dispatches automated invitation and agenda to all 12 ExCo members on Telegram.</small>
              </div>
            </div>
            <button type="button" class="btn-close" @click="showMeetingModal = false"></button>
          </div>

          <div class="modal-body p-4">
            <div class="row g-3">
              <!-- Selected Time Window -->
              <div class="col-md-6">
                <label class="form-label small fw-bold text-muted">Confirmed Date & Time Window</label>
                <div class="p-2 rounded-3 bg-light border fw-bold small text-dark d-flex align-items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="16" y1="2" x2="16" y2="6"></line>
                    <line x1="8" y1="2" x2="8" y2="6"></line>
                    <line x1="3" y1="10" x2="21" y2="10"></line>
                  </svg>
                  <span>{{ meetingForm.date }} • {{ meetingForm.time }}</span>
                </div>
              </div>

              <!-- Venue Selection -->
              <div class="col-md-6">
                <label class="form-label small fw-bold text-muted">Venue / Facility Location</label>
                <input
                  v-model="meetingForm.venue"
                  type="text"
                  class="form-control form-control-sm fw-bold"
                  placeholder="e.g. SMU Connexion Meeting Room 3"
                />
              </div>

              <!-- Meeting Subject -->
              <div class="col-12">
                <label class="form-label small fw-bold text-muted">Meeting Title / Subject</label>
                <input v-model="meetingForm.title" type="text" class="form-control form-control-sm fw-bold" placeholder="e.g. SMU Arts Festival Opening Night - Run of Show Alignment" />
              </div>

              <!-- Meeting Agenda -->
              <div class="col-12">
                <label class="form-label small fw-bold text-muted d-flex justify-content-between align-items-center">
                  <span>Meeting Agenda & Objectives</span>
                  <span class="badge bg-purple text-white" style="font-size: 0.6rem; background-color: var(--pulse-purple-transit);">Auto-Broadcasts to Telegram</span>
                </label>
                <textarea v-model="meetingForm.agenda" class="form-control" rows="4" style="font-size: 0.8rem; font-family: inherit;" placeholder="List key agenda items..."></textarea>
              </div>

              <!-- Target Recipients with Multi-Select & Search -->
              <div class="col-12">
                <div class="p-3 rounded-3 bg-light border">
                  <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
                    <div>
                      <div class="small fw-bold text-dark">Telegram Broadcast Target ({{ selectedRecipientIds.length }} Selected)</div>
                      <div class="text-muted small" style="font-size: 0.725rem;">Select individual members or filter by committee.</div>
                    </div>
                    <div class="d-flex flex-wrap gap-1">
                      <button type="button" class="btn btn-sm btn-outline-secondary py-0 px-2 rounded-pill" style="font-size: 0.65rem;" @click="selectAllRecipients">
                        All (12)
                      </button>
                      <button type="button" class="btn btn-sm btn-outline-secondary py-0 px-2 rounded-pill" style="font-size: 0.65rem;" @click="selectDancersOnly">
                        Dancers (3)
                      </button>
                      <button type="button" class="btn btn-sm btn-outline-secondary py-0 px-2 rounded-pill" style="font-size: 0.65rem;" @click="selectLogisticsOnly">
                        Logistics/Tech (4)
                      </button>
                      <button type="button" class="btn btn-sm btn-outline-secondary py-0 px-2 rounded-pill" style="font-size: 0.65rem;" @click="selectExecutiveOnly">
                        Executive (3)
                      </button>
                    </div>
                  </div>

                  <div class="mb-2">
                    <input
                      v-model="recipientSearch"
                      type="text"
                      class="form-control form-control-sm"
                      placeholder="Search member by name, handle (e.g. @angellow), or role..."
                      style="font-size: 0.75rem;"
                    />
                  </div>

                  <div class="d-flex flex-wrap gap-1" style="max-height: 120px; overflow-y: auto;">
                    <button
                      v-for="member in filteredRecipients"
                      :key="member.id"
                      type="button"
                      class="btn btn-sm py-1 px-2 rounded-pill border d-inline-flex align-items-center gap-1 transition-all"
                      :class="selectedRecipientIds.includes(member.id) ? 'btn-danger text-white' : 'btn-white text-muted'"
                      style="font-size: 0.685rem;"
                      @click="toggleRecipient(member.id)"
                    >
                      <span>{{ selectedRecipientIds.includes(member.id) ? '✓' : '+' }}</span>
                      <span>{{ member.name }}</span>
                      <span class="opacity-75" style="font-size: 0.6rem;">({{ member.handle }})</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="modal-footer border-top px-4 py-3 bg-light d-flex justify-content-end">
            <button type="button" class="btn btn-pulse-primary btn-sm rounded-pill px-4 fw-bold" @click="confirmAndBroadcastMeeting">
              Confirm Meeting & Dispatch Telegram Broadcast
            </button>
          </div>
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
/* Heatmap colours: muted by default, vivid once you mark yourself available */
.pulse-heat-cell {
  cursor: pointer;
  transition: background-color 0.2s ease, color 0.2s ease;
}
.pulse-heat-cell.avail-red    { background: #f6dcdc; color: #a35555; }
.pulse-heat-cell.avail-yellow { background: #fbf1cc; color: #8a6a14; }
.pulse-heat-cell.avail-green  { background: #d9efe0; color: #3d7a52; }

.pulse-heat-cell.avail-red.pulse-heat-my-active    { background: #ef4444; color: #fff; }
.pulse-heat-cell.avail-yellow.pulse-heat-my-active { background: #facc15; color: #3b2a00; }
.pulse-heat-cell.avail-green.pulse-heat-my-active  { background: #16a34a; color: #fff; }

/* Grey border on your own slots */
.pulse-heat-cell.pulse-heat-my-active {
  outline: 2px solid #6b7280;
  outline-offset: -2px;
  border-color: #6b7280;
  box-shadow: none;
}

.pulse-heat-count,
.pulse-heat-empty {
  color: inherit;
}

.legend-swatch {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 2px;
}

/* Best-match list: scrolls inside its own box so the card doesn't get too long */
.match-list {
  max-height: 240px;
  overflow-y: auto;
  padding-right: 0.25rem;
}

/* Best-match cards */
.match-card {
  border: 1px solid #e2e8f0;
  border-radius: 0.75rem;
  padding: 0.65rem 0.75rem;
  cursor: pointer;
  background: var(--pulse-card-bg, #fff);
  transition: border-color 0.15s ease, background-color 0.15s ease;
}
.match-card:hover {
  border-color: #86efac;
}
.match-card.selected {
  border-color: #16a34a;
  background: rgba(22, 163, 74, 0.08);
}
</style>