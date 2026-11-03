<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { supabase } from '../supabase';
import { session as facilitySession } from '../services/sessionState';
import { loadClubExcos, loadEvents as fetchEvents, saveEvent as saveEventToDb, deleteEvent as deleteEventFromDb, isMissingTableError } from '../services/opsService';

const props = defineProps({
  apiMode: { type: Boolean, default: false },
  readOnly: { type: Boolean, default: false },
  activePersona: { type: Object, default: null }
});

const toastMsg = ref('')

// Guests can look around but not make changes
function blockedForGuest() {
  if (!props.readOnly) return false
  toastMsg.value = 'Guest view is read-only. Sign in as a CCA ExCo to make changes.'
  return true
}

function showToast(message, ms = 4000) {
  toastMsg.value = message
  setTimeout(() => { toastMsg.value = '' }, ms)
}

/* ================================================================== */
/* 1. HELPERS                                                          */
/* ================================================================== */

// Block types, same colours as the legend
const BLOCK_TYPES = {
  setup: { label: 'Set up / Teardown', className: 'ops-block-setup' },
  move: { label: 'Movement', className: 'ops-block-move' },
  perform: { label: 'Rehearsal / Performance', className: 'ops-block-perform' },
  meal: { label: 'Meals / Breaks', className: 'ops-block-meal' },
  other: { label: 'Other tasks', className: 'ops-block-other' }
}

// Times are written as 'HH:MM' and stored as minutes after midnight
function toMinutes(time) {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

function formatTime(minutes) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// Today's date as 'YYYY-MM-DD' and the time now in minutes (this device's clock)
function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function minutesNow() {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes()
}

// '2026-11-13' -> 'Fri, 13 Nov 2026'
function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

// Ids are uuids so new events and tasks can be saved straight to Supabase
function newId() {
  return crypto.randomUUID()
}

// fixed = the time can't move (e.g. the show starts at 20:00 no matter what)
function block(start, end, title, type, venue = '', fixed = false) {
  return { id: newId(), start: toMinutes(start), end: toMinutes(end), title, type, venue, fixed }
}

/* ================================================================== */
/* 2. THE CCA'S EXCOS (from Supabase, or a sample list)                */
/* ================================================================== */

// Used for guests, and until the ops tables exist in Supabase
const SAMPLE_EXCOS = [
  { memberId: 's1', name: 'Mei Chen', role: 'President', phone: '@meichen' },
  { memberId: 's2', name: 'Rachel Tan', role: 'Logistics Director', phone: '@racheltan' },
  { memberId: 's3', name: 'Angel Low', role: 'Lead Dancer', phone: '@angellow' },
  { memberId: 's4', name: 'Rachel Chua', role: 'Choreography Lead', phone: '@rachelc' },
  { memberId: 's5', name: 'Darren Koh', role: 'Props Head', phone: '@darrenk' },
  { memberId: 's6', name: 'Marcus Tan', role: 'Stage Manager', phone: '@marcustan' },
  { memberId: 's7', name: 'Sarah Lim', role: 'Sound Engineer', phone: '@sarahlim' },
  { memberId: 's8', name: 'Jerica Koh', role: 'Marketing Director', phone: '@jericak' },
  { memberId: 's9', name: 'Giselle Goh', role: 'Finance Director', phone: '@giselleg' }
]

// Who can be put on a crew: the CCA's real ExCos when linked to Supabase
const excoPool = ref(SAMPLE_EXCOS)

// A crew member on one event: who they are, their tasks, and their check-in
function crewFromExco(exco, blocks = [], checkIn = {}) {
  return {
    memberId: exco.memberId,
    name: exco.name,
    role: exco.role,
    phone: exco.phone,
    blocks,
    checkedInAt: checkIn.at ?? null,
    late: checkIn.late || ''
  }
}

function crewMember(name, blocks = [], checkIn = {}) {
  return crewFromExco(SAMPLE_EXCOS.find(e => e.name === name), blocks, checkIn)
}

/* ================================================================== */
/* 3. EVENTS (each with its own crew and run of show)                  */
/* ================================================================== */

function sampleEvents() {
  return [
    {
      id: newId(),
      name: 'Showcase',
      date: todayIso(), // today, so the sample shows the day-of features
      venue: 'Main Hall',
      crew: [
        crewMember('Rachel Tan', [
          block('15:00', '16:00', 'Collect props from Studio 7.1', 'setup', 'Studio 7.1'),
          block('16:00', '16:30', 'Walk to Main Hall', 'move', 'Campus Concourse • 8 min walk'),
          block('16:30', '17:30', 'Stage setup', 'setup', 'Main Hall Stage'),
          block('17:30', '18:30', 'Dinner', 'meal', 'Holding Room B1.2'),
          block('18:30', '19:30', 'Tech rehearsal', 'perform', 'Main Hall Stage'),
          block('19:30', '20:00', 'Front of house check', 'other', 'Main Hall Foyer'),
          block('20:00', '22:00', 'Performance (backstage lead)', 'perform', 'Main Hall Stage', true),
          block('22:00', '22:30', 'Teardown', 'setup', 'Main Hall Stage')
        ], { at: toMinutes('14:55') }),
        crewMember('Angel Low', [
          block('15:00', '16:30', 'Warm up + run Act 2', 'perform', 'Studio 7.1'),
          block('16:30', '17:00', 'Walk to Main Hall', 'move', 'Campus Concourse • 8 min walk'),
          block('17:00', '17:30', 'Spacing on stage', 'perform', 'Main Hall Stage'),
          block('17:30', '18:30', 'Dinner + change into costumes', 'meal', 'Holding Room B1.2'),
          block('18:30', '19:30', 'Tech rehearsal', 'perform', 'Main Hall Stage'),
          block('19:30', '20:00', 'Hair & makeup', 'other', 'Holding Room B1.2'),
          block('20:00', '22:00', 'Performance', 'perform', 'Main Hall Stage', true),
          block('22:00', '22:30', 'Teardown', 'setup', 'Main Hall Stage')
        ], { at: toMinutes('14:58') }),
        crewMember('Rachel Chua', [
          block('15:00', '16:30', 'Warm up + run Act 2', 'perform', 'Studio 7.1'),
          block('16:30', '17:00', 'Walk to Main Hall', 'move', 'Campus Concourse • 8 min walk'),
          block('17:00', '17:30', 'Spacing on stage', 'perform', 'Main Hall Stage'),
          block('17:30', '18:30', 'Dinner + change into costumes', 'meal', 'Holding Room B1.2'),
          block('18:30', '19:30', 'Tech rehearsal', 'perform', 'Main Hall Stage'),
          block('19:30', '20:00', 'Give out passes to guests', 'other', 'Main Hall Foyer'),
          block('20:00', '22:00', 'Performance', 'perform', 'Main Hall Stage', true),
          block('22:00', '22:30', 'Teardown', 'setup', 'Main Hall Stage')
        ], { at: toMinutes('14:57') }),
        crewMember('Darren Koh', [
          block('15:00', '16:00', 'Load props onto lorry', 'setup', 'Studio 7.1'),
          block('16:00', '16:30', 'Go with lorry', 'move', 'Loading Bay'),
          block('16:30', '17:30', 'Stage setup', 'setup', 'Main Hall Stage'),
          block('17:30', '18:00', 'Buy dinner for ExCo', 'other', 'Campus Basement'),
          block('18:00', '18:30', 'Dinner', 'meal', 'Holding Room B1.2'),
          block('18:30', '19:30', 'Tech rehearsal', 'perform', 'Main Hall Stage'),
          block('19:30', '20:00', 'Props check', 'setup', 'Backstage'),
          block('20:00', '22:00', 'Performance (props crew)', 'perform', 'Backstage', true),
          block('22:00', '22:30', 'Teardown + load lorry', 'setup', 'Loading Bay')
        ], { late: 'Running 10 min late (SOE seminar)' }),
        crewMember('Marcus Tan', [
          block('16:00', '16:30', 'Arrive at Main Hall', 'move', 'Main Hall'),
          block('16:30', '17:30', 'Stage setup', 'setup', 'Main Hall Stage'),
          block('17:30', '18:00', 'Meet emcees', 'other', 'Main Hall Foyer'),
          block('18:00', '18:30', 'Dinner', 'meal', 'Holding Room B1.2'),
          block('18:30', '19:30', 'Run tech rehearsal', 'perform', 'Main Hall Stage'),
          block('19:30', '20:00', 'Call crew to standby', 'other', 'Backstage'),
          block('20:00', '22:00', 'Call the performance', 'perform', 'Stage Manager Desk', true),
          block('22:00', '22:30', 'Teardown', 'setup', 'Main Hall Stage')
        ], { at: toMinutes('15:55') }),
        crewMember('Sarah Lim', [
          block('15:30', '16:00', 'Walk to Main Hall', 'move', 'Campus Concourse • 8 min walk'),
          block('16:00', '17:30', 'Sound line check + LX programming', 'perform', 'Audio & Lighting Booth'),
          block('17:30', '18:00', 'Dinner', 'meal', 'Holding Room B1.2'),
          block('18:00', '18:30', 'Meet photographers', 'other', 'Main Hall Foyer'),
          block('18:30', '19:30', 'Tech rehearsal (sound desk)', 'perform', 'Audio & Lighting Booth'),
          block('19:30', '20:00', 'Mic check', 'perform', 'Main Hall Stage'),
          block('20:00', '22:00', 'Performance (sound desk)', 'perform', 'Audio & Lighting Booth', true),
          block('22:00', '22:30', 'Pack up sound', 'setup', 'Audio & Lighting Booth')
        ])
      ]
    },
    {
      id: newId(),
      name: 'Bazaar booth',
      date: '2026-11-28',
      venue: 'Campus Green',
      crew: [
        crewMember('Jerica Koh', [
          block('10:00', '11:00', 'Set up booth + banner', 'setup', 'Campus Green'),
          block('11:00', '13:00', 'Run booth (sign-ups)', 'perform', 'Campus Green', true),
          block('13:00', '13:30', 'Lunch', 'meal', 'Campus Green'),
          block('13:30', '15:00', 'Run booth (sign-ups)', 'perform', 'Campus Green', true)
        ]),
        crewMember('Giselle Goh', [
          block('10:30', '11:00', 'Collect cash float from OSL', 'other', 'OSL Office'),
          block('11:00', '13:00', 'Cashier', 'perform', 'Campus Green', true),
          block('13:00', '13:30', 'Lunch', 'meal', 'Campus Green'),
          block('13:30', '15:00', 'Cashier', 'perform', 'Campus Green', true),
          block('15:00', '15:30', 'Count cash + return float', 'other', 'OSL Office')
        ]),
        crewMember('Angel Low', [
          block('10:00', '11:00', 'Set up booth + banner', 'setup', 'Campus Green'),
          block('12:00', '12:30', 'Dance teaser performance', 'perform', 'Campus Green Stage', true),
          block('15:00', '15:30', 'Pack down booth', 'setup', 'Campus Green')
        ])
      ]
    }
  ]
}

const events = ref([])
const selectedEventId = ref(null)

const event = computed(() => events.value.find(e => e.id === selectedEventId.value) || events.value[0] || null)
const crew = computed(() => (event.value ? event.value.crew : []))

// Where the events live:
//   'supabase'  signed-in ExCo: saved for the whole CCA, every ExCo sees the same plan
//   'local'     guests, or until the ops tables exist: sample events kept in this browser
const dataMode = ref('local')
const loadingEvents = ref(true)
const saveState = ref('') // '', 'saving', 'saved' or 'error'
const activeClubId = computed(() => facilitySession.value.activeClubId)

// ---------------- Sample events kept in this browser ----------------

const storageKey = computed(() => `pulse_ops_events:${props.activePersona?.cca || 'demo'}`)

function loadLocalEvents() {
  excoPool.value = SAMPLE_EXCOS
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey.value))
    if (saved && Array.isArray(saved.events) && saved.events.length && typeof saved.events[0].id === 'string') {
      events.value = saved.events
      selectedEventId.value = saved.selectedEventId
      return
    }
  } catch {
    // Storage blocked or bad data: fall back to the sample events
  }
  events.value = sampleEvents()
  selectedEventId.value = events.value[0].id
}

function saveLocalEvents() {
  try {
    localStorage.setItem(storageKey.value, JSON.stringify({ events: events.value, selectedEventId: selectedEventId.value }))
  } catch {
    // Storage blocked (e.g. private window): changes just won't survive a refresh
  }
}

// ---------------- Supabase ----------------

// What each event looked like when last saved, so only real changes are sent
const lastSaved = new Map()

async function loadEventsForPage() {
  loadingEvents.value = true
  const clubId = activeClubId.value
  if (supabase && !props.readOnly && facilitySession.value.authUserId && clubId) {
    try {
      const excos = await loadClubExcos(clubId)
      const loaded = await fetchEvents(clubId, excos)
      excoPool.value = excos
      events.value = loaded
      lastSaved.clear()
      loaded.forEach(ev => lastSaved.set(ev.id, JSON.stringify(ev)))
      selectedEventId.value = loaded.length ? loaded[0].id : null
      dataMode.value = 'supabase'
      loadingEvents.value = false
      return
    } catch (error) {
      // Tables not created yet is expected; anything else is worth showing
      if (!isMissingTableError(error)) {
        showToast(`Couldn't load events from Supabase (${error.message}). Showing sample events instead.`, 6000)
      }
      console.log(error.message)
    }
  }
  dataMode.value = 'local'
  loadLocalEvents()
  loadingEvents.value = false
}

// Load once the session knows who is signed in, and again if they switch CCA
watch(
  () => [facilitySession.value.ready, facilitySession.value.authUserId, activeClubId.value, props.readOnly],
  ([ready]) => {
    if (ready || !supabase) loadEventsForPage()
  },
  { immediate: true }
)

// Save changes shortly after they happen (one save for a burst of edits)
let saveTimer = null
watch([events, selectedEventId], () => {
  if (dataMode.value === 'local') {
    saveLocalEvents()
    return
  }
  clearTimeout(saveTimer)
  saveTimer = setTimeout(saveChangedEvents, 600)
}, { deep: true })

async function saveChangedEvents() {
  const changed = events.value.filter(ev => lastSaved.get(ev.id) !== JSON.stringify(ev))
  if (!changed.length) return
  saveState.value = 'saving'
  try {
    for (const ev of changed) {
      const isNew = !lastSaved.has(ev.id)
      await saveEventToDb(activeClubId.value, ev, isNew ? facilitySession.value.memberId : null)
      lastSaved.set(ev.id, JSON.stringify(ev))
    }
    saveState.value = 'saved'
  } catch (error) {
    saveState.value = 'error'
    showToast(`Couldn't save to Supabase: ${error.message}`, 6000)
  }
}

// Switching event starts that event's day fresh
watch(selectedEventId, () => {
  delayNotice.value = null
  totalDelay.value = 0
  selectedName.value = ''
  resetClock()
})
watch(() => event.value?.date, resetClock)

function resetPlan() {
  if (blockedForGuest()) return
  events.value = sampleEvents()
  selectedEventId.value = events.value[0].id
  showClock.value = toMinutes('17:00')
  showToast('Events reset to the sample plans.')
}

/* ================================================================== */
/* 4. TIMELINE                                                         */
/* ================================================================== */

// From the first block to the last, rounded out to the half hour (09:00–18:00 if empty)
const allBlocks = computed(() => crew.value.flatMap(p => p.blocks))
const dayStart = computed(() =>
  allBlocks.value.length ? Math.floor(Math.min(...allBlocks.value.map(b => b.start)) / 30) * 30 : toMinutes('09:00')
)
const dayEnd = computed(() =>
  allBlocks.value.length ? Math.ceil(Math.max(...allBlocks.value.map(b => b.end)) / 30) * 30 : toMinutes('18:00')
)
const halfHours = computed(() => {
  const ticks = []
  for (let t = dayStart.value; t < dayEnd.value; t += 30) ticks.push(t)
  return ticks
})

// Where a time sits across the timeline, as a percentage
function percentAt(minutes) {
  return ((minutes - dayStart.value) / (dayEnd.value - dayStart.value)) * 100
}

function blockStyle(b) {
  return {
    left: `${percentAt(b.start)}%`,
    width: `${percentAt(b.end) - percentAt(b.start)}%`
  }
}

function sortedBlocks(person) {
  return [...person.blocks].sort((a, b) => a.start - b.start)
}

/* ================================================================== */
/* 5. CLOCK                                                            */
/*    On the event day it follows the real time ("live").              */
/*    Before the day it's a preview time you move with ◀ ▶, and        */
/*    check-in and delays don't apply yet.                             */
/* ================================================================== */

const showClock = ref(toMinutes('17:00'))
const today = ref(todayIso())
const followLive = ref(true) // event day: keep the clock on the real time

// 'today' | 'upcoming' | 'past'
const eventDay = computed(() => {
  if (!event.value) return 'upcoming'
  if (event.value.date === today.value) return 'today'
  return event.value.date > today.value ? 'upcoming' : 'past'
})
const isEventDay = computed(() => eventDay.value === 'today')

const daysAway = computed(() => {
  if (!event.value) return 0
  const [y, m, d] = event.value.date.split('-').map(Number)
  const [ty, tm, td] = today.value.split('-').map(Number)
  return Math.round((new Date(y, m - 1, d) - new Date(ty, tm - 1, td)) / 86400000)
})

// Event day: the real time. Otherwise: a preview a bit into the day.
function resetClock() {
  followLive.value = true
  if (isEventDay.value) {
    showClock.value = minutesNow()
  } else {
    showClock.value = dayStart.value + Math.min(120, Math.floor((dayEnd.value - dayStart.value) / 2 / 15) * 15)
  }
}

function moveClock(mins) {
  followLive.value = false
  showClock.value = Math.min(dayEnd.value, Math.max(dayStart.value, roundToQuarter(showClock.value) + mins))
}

// Keep the live clock (and today's date) up to date
let clockTimer = null
function tickClock() {
  const dateNow = todayIso()
  if (dateNow !== today.value) {
    today.value = dateNow
    resetClock()
  } else if (isEventDay.value && followLive.value) {
    showClock.value = minutesNow()
  }
}

function currentBlock(person, time = showClock.value) {
  return person.blocks.find(b => b.start <= time && time < b.end) || null
}

function nextBlock(person, time = showClock.value) {
  return sortedBlocks(person).find(b => b.start > time) || null
}

// Faded once it's over: on the day by the clock, and everything after the event
function isDone(b) {
  if (eventDay.value === 'past') return true
  return isEventDay.value && b.end <= showClock.value
}

/* ================================================================== */
/* 6. WHOSE SCHEDULE "MY SCHEDULE" SHOWS                               */
/* ================================================================== */

const selectedName = ref('')

// Signed-in person if they are on this event's crew, otherwise the first person
const me = computed(() => {
  const wanted = selectedName.value || props.activePersona?.name
  return crew.value.find(p => p.name === wanted) || crew.value[0] || null
})
const meIsSignedInUser = computed(() => !!me.value && me.value.name === props.activePersona?.name)

const myNow = computed(() => (me.value ? currentBlock(me.value) : null))
const myNext = computed(() => (me.value ? nextBlock(me.value) : null))

/* ================================================================== */
/* 7. TABS (phone opens on My schedule, desktop on the full grid)      */
/* ================================================================== */

const activeTab = ref('grid')
const showMoreMenu = ref(false)
const showDelayMenu = ref(false)

// Clicking anywhere else closes the dropdowns
function closeMoreMenu(e) {
  if (!e.target.closest('.ops-more')) showMoreMenu.value = false
  if (!e.target.closest('.ops-delay')) showDelayMenu.value = false
}

onMounted(() => {
  if (window.innerWidth < 768) activeTab.value = 'me'
  document.addEventListener('click', closeMoreMenu)
  clockTimer = setInterval(tickClock, 30000)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', closeMoreMenu)
  clearInterval(clockTimer)
})

/* ================================================================== */
/* 8. SHOW RUNNING LATE (fixed times never move)                       */
/* ================================================================== */

const MIN_MEAL_MINUTES = 15 // a meal can be squeezed down to this before it moves
const DELAY_OPTIONS = [5, 10, 15, 30] // minutes

const delayNotice = ref(null) // { summary, warnings[] }
const totalDelay = ref(0)

// Whatever this person is doing now overruns by `mins`. Later blocks move back
// until a gap or a meal absorbs it. A fixed block never moves: the block
// before it is cut short instead (or dropped if no time is left for it).
function delayPerson(person, now, mins) {
  const blocks = sortedBlocks(person)
  const i = blocks.findIndex(b => b.start <= now && now < b.end)
  if (i === -1 || blocks[i].fixed) return []

  const notes = []
  blocks[i].end += mins
  let prev = blocks[i]

  for (let j = i + 1; j < blocks.length; j++) {
    const b = blocks[j]
    const overlap = prev.end - b.start
    if (overlap <= 0) break // a gap absorbed the rest of the delay

    if (b.fixed) {
      prev.end = b.start
      if (prev.end - prev.start <= 0) {
        person.blocks = person.blocks.filter(x => x.id !== prev.id)
        notes.push({ kind: 'cut', text: `${person.name}: no time left for "${prev.title}" before ${b.title} at ${formatTime(b.start)}` })
      } else {
        notes.push({ kind: 'cut', text: `${person.name}: "${prev.title}" must finish ${overlap} min early to keep ${b.title} at ${formatTime(b.start)}` })
      }
      break
    }

    if (b.type === 'meal' && b.end - (b.start + overlap) >= MIN_MEAL_MINUTES) {
      b.start += overlap
      notes.push({ kind: 'meal', text: `${b.title} shortened to ${b.end - b.start} min` })
      break
    }

    b.start += overlap
    b.end += overlap
    prev = b
  }
  return notes
}

function applyOneClickDelay(mins) {
  showDelayMenu.value = false
  if (blockedForGuest()) return
  if (!isEventDay.value) {
    showToast('Delays can only be applied on the day of the event.')
    return
  }
  const now = showClock.value
  const notes = crew.value.flatMap(person => delayPerson(person, now, mins))
  totalDelay.value += mins

  const mealsShortened = notes.filter(n => n.kind === 'meal').length
  const fixedStart = Math.min(...allBlocks.value.filter(b => b.fixed).map(b => b.start))
  const parts = [`Running ${totalDelay.value} min behind from ${formatTime(now)}.`]
  if (mealsShortened) parts.push(`Meals shortened for ${mealsShortened} ${mealsShortened === 1 ? 'person' : 'people'}.`)
  if (Number.isFinite(fixedStart)) parts.push(`Fixed times still start on time (first at ${formatTime(fixedStart)}).`)
  parts.push('Notify the crew so they see the new times.')

  delayNotice.value = {
    summary: parts.join(' '),
    warnings: notes.filter(n => n.kind === 'cut').map(n => n.text)
  }
}

function publishToMobile() {
  if (blockedForGuest()) return
  showToast(`Updated run of show for ${event.value.name} sent to ${crew.value.length} crew on Telegram.`, 5000)
}

/* ================================================================== */
/* 9. ADD / EDIT AN EVENT (and pick which ExCos are on it)             */
/* ================================================================== */

const eventEditor = ref(null)
const eventEditorError = ref('')

function openNewEvent() {
  if (blockedForGuest()) return
  // Put the signed-in ExCo on the crew to start with
  const signedIn = excoPool.value.find(e => e.memberId === facilitySession.value.memberId || e.name === props.activePersona?.name)
  eventEditor.value = {
    mode: 'add',
    name: '',
    date: '',
    venue: '',
    mainStart: '',
    mainEnd: '',
    mainTitle: 'Performance',
    crewIds: signedIn ? [signedIn.memberId] : []
  }
  eventEditorError.value = ''
}

function openEditEvent() {
  if (blockedForGuest()) return
  eventEditor.value = {
    mode: 'edit',
    name: event.value.name,
    date: event.value.date,
    venue: event.value.venue,
    crewIds: crew.value.map(p => p.memberId)
  }
  eventEditorError.value = ''
}

// People being taken off the crew, and how many tasks they'd lose
const crewBeingRemoved = computed(() => {
  if (!eventEditor.value || eventEditor.value.mode !== 'edit') return []
  return crew.value.filter(p => !eventEditor.value.crewIds.includes(p.memberId) && p.blocks.length)
})

function saveEvent() {
  const e = eventEditor.value
  if (!e.name.trim()) return (eventEditorError.value = 'Give the event a name.')
  if (!e.date) return (eventEditorError.value = 'Pick a date.')
  if (!e.crewIds.length) return (eventEditorError.value = 'Pick at least one ExCo for the crew.')

  if (e.mode === 'add') {
    const hasMain = e.mainStart && e.mainEnd
    if (hasMain && toMinutes(e.mainEnd) <= toMinutes(e.mainStart)) {
      return (eventEditorError.value = 'The end time must be after the start time.')
    }
    // Everyone on the crew gets the main fixed block (e.g. the show)
    const newEvent = {
      id: newId(),
      name: e.name.trim(),
      date: e.date,
      venue: e.venue.trim(),
      crew: excoPool.value
        .filter(exco => e.crewIds.includes(exco.memberId))
        .map(exco => crewFromExco(exco, hasMain
          ? [block(e.mainStart, e.mainEnd, e.mainTitle.trim() || 'Performance', 'perform', e.venue.trim(), true)]
          : []))
    }
    events.value.push(newEvent)
    selectedEventId.value = newEvent.id
    showToast(`Created ${newEvent.name}. Add tasks for the crew with "+ Add task".`)
  } else {
    event.value.name = e.name.trim()
    event.value.date = e.date
    event.value.venue = e.venue.trim()
    const kept = event.value.crew.filter(p => e.crewIds.includes(p.memberId))
    const added = excoPool.value
      .filter(exco => e.crewIds.includes(exco.memberId) && !kept.some(p => p.memberId === exco.memberId))
      .map(exco => crewFromExco(exco))
    event.value.crew = [...kept, ...added]
    showToast(`Updated ${event.value.name}.`)
  }
  eventEditor.value = null
}

async function deleteEvent() {
  // Sample mode always keeps at least one event to look at
  if (dataMode.value === 'local' && events.value.length === 1) {
    eventEditorError.value = 'This is the only event. Create another one before deleting it.'
    return
  }
  if (!window.confirm(`Delete ${event.value.name} and its whole plan?`)) return
  const { id, name } = event.value
  if (dataMode.value === 'supabase' && lastSaved.has(id)) {
    try {
      await deleteEventFromDb(id)
    } catch (error) {
      eventEditorError.value = `Couldn't delete: ${error.message}`
      return
    }
    lastSaved.delete(id)
  }
  events.value = events.value.filter(ev => ev.id !== id)
  selectedEventId.value = events.value.length ? events.value[0].id : null
  eventEditor.value = null
  showToast(`Deleted ${name}.`)
}

/* ================================================================== */
/* 10. PLANNING: add, edit and remove tasks                            */
/* ================================================================== */

const editor = ref(null) // the task being added or edited
const editorError = ref('')

function roundToQuarter(minutes) {
  return Math.ceil(minutes / 15) * 15
}

function openAddTask() {
  if (blockedForGuest()) return
  const start = roundToQuarter(showClock.value)
  editor.value = {
    mode: 'add',
    names: [me.value.name],
    title: '',
    type: 'other',
    start: formatTime(start),
    end: formatTime(start + 60),
    venue: event.value.venue,
    fixed: false
  }
  editorError.value = ''
}

// Everyone with the same task (same name and times) is edited together
function sameTaskGroup(b) {
  return crew.value.flatMap(p => p.blocks
    .filter(x => x.title === b.title && x.start === b.start && x.end === b.end)
    .map(x => ({ name: p.name, blockId: x.id })))
}

function openEditTask(person, b) {
  if (props.readOnly) return
  const group = sameTaskGroup(b)
  editor.value = {
    mode: 'edit',
    group,
    names: group.map(g => g.name),
    title: b.title,
    type: b.type,
    start: formatTime(b.start),
    end: formatTime(b.end),
    venue: b.venue,
    fixed: b.fixed
  }
  editorError.value = ''
}

function saveTask() {
  const e = editor.value
  const start = toMinutes(e.start)
  const end = toMinutes(e.end)
  if (!e.title.trim()) return (editorError.value = 'Give the task a name.')
  if (!e.names.length) return (editorError.value = 'Pick at least one person.')
  if (end <= start) return (editorError.value = 'The end time must be after the start time.')

  // Nobody can be in two places at once (ignoring the task being edited)
  const editingIds = e.mode === 'edit' ? e.group.map(g => g.blockId) : []
  for (const name of e.names) {
    const person = crew.value.find(p => p.name === name)
    const clash = person.blocks.find(b => !editingIds.includes(b.id) && b.start < end && start < b.end)
    if (clash) {
      return (editorError.value = `${name} already has "${clash.title}" (${formatTime(clash.start)}–${formatTime(clash.end)}).`)
    }
  }

  const fields = { start, end, title: e.title.trim(), type: e.type, venue: e.venue.trim(), fixed: e.fixed }
  if (e.mode === 'edit') {
    // People who had it: update it, or take it off them if they were unticked
    for (const g of e.group) {
      const person = crew.value.find(p => p.name === g.name)
      if (e.names.includes(g.name)) {
        Object.assign(person.blocks.find(b => b.id === g.blockId), fields)
      } else {
        person.blocks = person.blocks.filter(b => b.id !== g.blockId)
      }
    }
    // Newly ticked people get their own copy
    for (const name of e.names.filter(n => !e.group.some(g => g.name === n))) {
      crew.value.find(p => p.name === name).blocks.push({ id: newId(), ...fields })
    }
  } else {
    for (const name of e.names) {
      crew.value.find(p => p.name === name).blocks.push({ id: newId(), ...fields })
    }
  }
  showToast(e.mode === 'edit' ? `Task updated for ${e.names.join(', ')}.` : `Task added for ${e.names.join(', ')}.`)
  editor.value = null
}

// Removes the task from everyone who had it
function deleteTask() {
  const e = editor.value
  for (const g of e.group) {
    const person = crew.value.find(p => p.name === g.name)
    person.blocks = person.blocks.filter(b => b.id !== g.blockId)
  }
  showToast(`Removed "${e.title}" for ${e.group.map(g => g.name).join(', ')}.`)
  editor.value = null
}

/* ================================================================== */
/* 11. CREW CHECK-IN (each person is due at their first task)          */
/* ================================================================== */

// When someone needs to be here: the start of their first task
function callTime(person) {
  return person.blocks.length ? Math.min(...person.blocks.map(b => b.start)) : null
}

// 'in' | 'late' | 'due' | 'missing', as at the clock. Before the event day nobody is missing yet.
function checkInStatus(p) {
  if (!isEventDay.value) return p.checkedInAt !== null ? 'in' : 'due'
  if (p.checkedInAt !== null && p.checkedInAt <= showClock.value) return 'in'
  if (p.late) return 'late'
  const call = callTime(p)
  if (call === null || showClock.value < call) return 'due'
  return 'missing'
}

const STATUS_ORDER = { missing: 0, late: 1, due: 2, in: 3 }
const needsAttention = computed(() =>
  crew.value
    .filter(p => checkInStatus(p) !== 'in')
    .sort((a, b) => STATUS_ORDER[checkInStatus(a)] - STATUS_ORDER[checkInStatus(b)])
)
const checkedIn = computed(() => crew.value.filter(p => checkInStatus(p) === 'in'))

function reportLateETA(person) {
  if (blockedForGuest()) return
  person.late = '+15 min late'
  showToast(`${person.name} marked as running late.`)
}

function checkInPerformer(person) {
  if (blockedForGuest()) return
  person.checkedInAt = showClock.value
  person.late = ''
  showToast(`${person.name} checked in at ${formatTime(showClock.value)}.`)
}

// 'Rachel Tan' -> 'Rachel T' (the grid's name column on phones)
function shortName(name) {
  const parts = name.trim().split(/\s+/)
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}` : parts[0]
}

// For a check-in pressed by mistake
function undoCheckIn(person) {
  if (blockedForGuest()) return
  person.checkedInAt = null
  showToast(`${person.name} is no longer checked in.`)
}

function clearLate(person) {
  if (blockedForGuest()) return
  person.late = ''
  showToast(`${person.name} is no longer marked late.`)
}

/* ================================================================== */
/* 12. STANDBY FINDER + NOTICE PARSER (under "More tools")             */
/* ================================================================== */

const showAiCopilotModal = ref(false)
const activeCopilotTab = ref('standby') // 'standby' or 'parser'
const targetAbsentPerformer = ref(null)
const isDispatchingStandby = ref(false)

function openTool(tab) {
  showMoreMenu.value = false
  activeCopilotTab.value = tab
  showAiCopilotModal.value = true
}

const standbyPool = ref([
  {
    id: 101,
    name: 'Jessica Ong',
    role: 'Lead Dancer (Act 2 Standby)',
    phone: '@jessicaong',
    status: 'On-Call',
    matchScore: 98,
    availability: 'Free in Heatmap (18:00 - 21:00)',
    distance: '4m walk from SMU Connexion',
    qualification: 'Mastered Act 2 choreography in Oct rehearsals'
  },
  {
    id: 102,
    name: 'Ryan Teo',
    role: 'Stage Crew & Props Standby',
    phone: '@ryanteo',
    status: 'On-Call',
    matchScore: 92,
    availability: 'Free in Heatmap (17:30 - 21:30)',
    distance: '2m walk from Li Ka Shing Library',
    qualification: 'Certified stagehand & props coordinator'
  },
  {
    id: 103,
    name: 'Chloe Lim',
    role: 'Ensemble Dancer Standby',
    phone: '@chloelim',
    status: 'On-Call',
    matchScore: 85,
    availability: 'Free in Heatmap (18:30 - 20:30)',
    distance: '6m walk from SOE Concourse',
    qualification: 'Ensemble dance backup'
  }
])

function triggerStandbyForPerformer(p) {
  if (blockedForGuest()) return
  targetAbsentPerformer.value = p
  activeCopilotTab.value = 'standby'
  showAiCopilotModal.value = true
}

function dispatchStandby(candidate) {
  if (blockedForGuest()) return
  isDispatchingStandby.value = true
  setTimeout(() => {
    isDispatchingStandby.value = false
    showAiCopilotModal.value = false

    // The standby takes over the absent person's row (and tasks) in the run of show
    const target = targetAbsentPerformer.value || crew.value.find(p => p.name === 'Darren Koh') || crew.value[0]
    const targetName = target.name
    target.name = candidate.name
    target.role = `${target.role} (standby for ${targetName})`
    target.phone = candidate.phone
    target.checkedInAt = null
    target.late = `On the way (${candidate.distance})`

    showToast(`Emergency Standby Activated: Telegram Bot pinged ${candidate.name} (${candidate.phone}). Reassigned to ${targetName}'s tasks in the run of show.`, 6000)
  }, 600)
}

// AI Telegram Notice & Shopping List Parser
const rawChatInput = ref('')
const isAiParsing = ref(false)
const parsedNoticeResult = ref(null)

const sampleChatNotice = `Hihi everyone, Ardiente will be giving away the following bookings:
8 Oct, Thursday, 15:00-18:00 @ Gym Studio. Pls pm if needed!
Also for rehearsal this Friday at Main Hall Stage:
- Please remember to bring knee pads and black practice tights
- Sound team needs 2 rolls of black gaffer tape and 4 extra AAA batteries
- Logistics team please buy 15 bottles of 100PLUS from Cheers
Poll below on who can make it!`

function loadSampleChat() {
  rawChatInput.value = sampleChatNotice
}

function parseNoticeWithAi() {
  if (!rawChatInput.value.trim()) return
  isAiParsing.value = true
  parsedNoticeResult.value = null
  setTimeout(() => {
    isAiParsing.value = false
    parsedNoticeResult.value = {
      facilityRelease: {
        venue: 'Gym Studio (Sports Court)',
        date: 'Thursday, 8 Oct',
        time: '15:00 - 18:00',
        action: 'Direct Peer Transfer to Marketplace'
      },
      rehearsalCues: {
        location: 'Main Hall Stage (Friday)',
        gearRequired: ['Knee pads', 'Black practice tights'],
        techNeeds: ['2 rolls black gaffer tape', '4x AAA batteries']
      },
      shoppingList: [
        { item: '15 bottles of 100PLUS', store: 'Cheers (Campus Basement)', owner: 'Logistics Leads' },
        { item: 'Black gaffer tape (2 rolls)', store: 'Stationery store', owner: 'Sound Team' },
        { item: '4x AAA batteries', store: 'Cheers', owner: 'Sound Team' }
      ],
      telegramSummary: `[PULSE AI SUMMARY FOR ARDIENTE]
1. Facility Swap: Gym Studio (Thu 8 Oct, 15:00-18:00) listed on Pulse Marketplace.
2. Friday Rehearsal: Main Hall Stage. Bring knee pads + tights.
3. Logistics Assigned: 15x 100PLUS + Gaffer tape claimed by Logistics Team.`
    }
  }, 750)
}
</script>

<template>
  <div class="py-2">

    <!-- Header: which event, plus the main actions -->
    <div class="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-3">
      <div>
        <div v-if="apiMode" class="d-flex align-items-center gap-2 mb-1">
          <span class="pulse-api-tag">OneMap Routing API</span>
          <span class="pulse-api-tag">Telegram Bot API</span>
        </div>
        <h3 class="fw-bold mb-2">Day-of Operations</h3>
        <div class="d-flex flex-wrap align-items-center gap-2">
          <label for="opsEvent" class="visually-hidden">Event</label>
          <select v-if="events.length" id="opsEvent" v-model="selectedEventId" class="form-select form-select-sm w-auto fw-semibold">
            <option v-for="ev in events" :key="ev.id" :value="ev.id">{{ ev.name }} • {{ formatDate(ev.date) }}</option>
          </select>
          <template v-if="!readOnly">
            <button v-if="event" type="button" class="btn btn-sm btn-light border" @click="openEditEvent">Edit event</button>
            <button type="button" class="btn btn-sm btn-outline-danger fw-semibold" @click="openNewEvent">+ New event</button>
          </template>
        </div>
        <p v-if="event" class="text-muted small mb-0 mt-2">
          {{ formatDate(event.date) }}<span v-if="event.venue"> • {{ event.venue }}</span> • {{ crew.length }} ExCo{{ crew.length === 1 ? '' : 's' }} on the crew
        </p>
        <!-- Where the plan is saved -->
        <div class="ops-small mt-1">
          <span v-if="dataMode === 'supabase'" class="text-success fw-semibold">
            ● Shared with your CCA's ExCos<span v-if="saveState === 'saving'" class="text-muted fw-normal"> • saving…</span><span v-else-if="saveState === 'saved'" class="text-muted fw-normal"> • saved</span><span v-else-if="saveState === 'error'" class="text-danger"> • not saved</span>
          </span>
          <span v-else class="text-muted">● Sample plan, saved in this browser only</span>
        </div>
      </div>

      <div v-if="event" class="d-flex flex-wrap gap-2">
        <div class="ops-delay position-relative">
          <button type="button" class="btn btn-sm btn-outline-warning text-dark fw-bold border-warning d-flex align-items-center gap-2" :disabled="!isEventDay" :aria-expanded="showDelayMenu" :title="isEventDay ? 'What\'s happening now runs over. Fixed times (like the performance) never move.' : 'Only on the day of the event'" @click="showDelayMenu = !showDelayMenu">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
            <span>Delay current tasks ▾</span>
          </button>
          <div v-if="showDelayMenu" class="ops-more-menu shadow-sm border rounded-3 py-1">
            <button v-for="mins in DELAY_OPTIONS" :key="mins" type="button" class="dropdown-item small py-2 px-3" @click="applyOneClickDelay(mins)">+{{ mins }} min</button>
          </div>
        </div>

        <button type="button" class="btn btn-sm btn-pulse-primary d-flex align-items-center gap-2" @click="publishToMobile">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
          <span>Notify crew</span>
        </button>

        <div class="ops-more position-relative">
          <button type="button" class="btn btn-sm btn-light border fw-semibold" :aria-expanded="showMoreMenu" @click="showMoreMenu = !showMoreMenu">
            More tools ▾
          </button>
          <div v-if="showMoreMenu" class="ops-more-menu shadow-sm border rounded-3 py-1">
            <button type="button" class="dropdown-item small py-2 px-3" @click="openTool('standby')">Find a standby</button>
            <button type="button" class="dropdown-item small py-2 px-3" @click="openTool('parser')">Turn a chat message into tasks</button>
            <button v-if="!readOnly && dataMode === 'local'" type="button" class="dropdown-item small py-2 px-3 text-danger" @click="showMoreMenu = false; resetPlan()">Reset to sample events</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Before / after the event day -->
    <div v-if="event && eventDay === 'upcoming'" class="alert alert-info border-0 shadow-sm mb-3 small" role="status">
      <strong>Planning ahead:</strong> {{ event.name }} is {{ daysAway === 1 ? 'tomorrow' : `in ${daysAway} days` }}.
      The time below is a preview. Check-in and delays start on the day.
    </div>
    <div v-else-if="event && eventDay === 'past'" class="alert alert-secondary border-0 shadow-sm mb-3 small" role="status">
      This event was on {{ formatDate(event.date) }}. The plan below is how it ran.
    </div>

    <!-- Delay + toast banners -->
    <div v-if="delayNotice" class="alert alert-warning border-0 shadow-sm mb-3 small" role="alert">
      <div>{{ delayNotice.summary }}</div>
      <ul v-if="delayNotice.warnings.length" class="mb-0 mt-2 ps-3 text-danger fw-semibold">
        <li v-for="w in delayNotice.warnings" :key="w">{{ w }}</li>
      </ul>
    </div>
    <div v-if="toastMsg" class="alert alert-success border-0 shadow-sm mb-3 small" role="alert">{{ toastMsg }}</div>

    <!-- Loading, or no events yet -->
    <div v-if="loadingEvents" class="text-center text-muted small py-5">
      <div class="spinner-border spinner-border-sm text-danger me-2" role="status"></div>Loading events…
    </div>
    <div v-else-if="!event" class="pulse-card ops-static-card p-4 text-center">
      <h5 class="fw-bold mb-1">No events yet</h5>
      <p class="text-muted small mb-3">Create your CCA's first event, pick the ExCos on the crew, then plan everyone's tasks.</p>
      <button type="button" class="btn btn-sm btn-pulse-primary px-3 mx-auto" @click="openNewEvent">+ New event</button>
    </div>

    <template v-else>
    <!-- Now / Next for whoever "My schedule" is showing -->
    <div class="card border-0 shadow-sm p-3 mb-3 ops-now-card">
      <div class="row g-3 align-items-center">
        <div class="col-12 col-md-auto">
          <div class="text-muted text-uppercase fw-bold ops-label">
            <span v-if="isEventDay && followLive" class="text-danger">● Now (live)</span>
            <span v-else-if="isEventDay">Looking at</span>
            <span v-else>Preview time</span>
          </div>
          <div class="d-flex align-items-center gap-2">
            <button type="button" class="btn btn-sm btn-light border px-2" aria-label="15 minutes earlier" @click="moveClock(-15)">◀</button>
            <span class="fw-bold fs-5 ops-clock">{{ formatTime(showClock) }}</span>
            <button type="button" class="btn btn-sm btn-light border px-2" aria-label="15 minutes later" @click="moveClock(15)">▶</button>
            <button v-if="isEventDay && !followLive" type="button" class="btn btn-link btn-sm p-0 ops-small" @click="resetClock">Back to now</button>
          </div>
        </div>
        <div class="col-12 col-md">
          <div class="text-muted text-uppercase fw-bold ops-label">
            {{ meIsSignedInUser ? 'You' : me.name }} • now
          </div>
          <div v-if="myNow" class="fw-bold">
            {{ myNow.title }}
            <span class="text-muted fw-normal small">{{ formatTime(myNow.start) }}–{{ formatTime(myNow.end) }}<span v-if="myNow.venue"> • {{ myNow.venue }}</span></span>
          </div>
          <div v-else class="fw-bold text-muted">Free</div>
        </div>
        <div class="col-12 col-md">
          <div class="text-muted text-uppercase fw-bold ops-label">Next</div>
          <div v-if="myNext" class="fw-semibold">
            {{ myNext.title }}
            <span class="text-muted fw-normal small">in {{ myNext.start - showClock }} min<span v-if="myNext.venue"> • {{ myNext.venue }}</span></span>
          </div>
          <div v-else class="text-muted">Nothing else today</div>
        </div>
        <div class="col-12 col-md-auto">
          <div class="text-muted text-uppercase fw-bold ops-label">Checked in</div>
          <div class="fw-bold" :class="checkedIn.length === crew.length ? 'text-success' : 'text-warning-emphasis'">
            {{ checkedIn.length }} / {{ crew.length }}
          </div>
        </div>
      </div>
    </div>

    <div class="row g-4">

      <!-- Run of show -->
      <div class="col-lg-8">
        <div class="pulse-card ops-static-card p-3 p-md-4 shadow-sm">
          <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
            <ul class="nav nav-pills ops-tabs gap-1 mb-0" role="tablist">
              <li class="nav-item"><button type="button" class="nav-link" :class="{ active: activeTab === 'me' }" @click="activeTab = 'me'">My schedule</button></li>
              <li class="nav-item"><button type="button" class="nav-link" :class="{ active: activeTab === 'now' }" @click="activeTab = 'now'">Everyone now</button></li>
              <li class="nav-item"><button type="button" class="nav-link" :class="{ active: activeTab === 'grid' }" @click="activeTab = 'grid'">Full grid</button></li>
            </ul>
            <button v-if="!readOnly" type="button" class="btn btn-sm btn-outline-danger fw-semibold" @click="openAddTask">+ Add task</button>
          </div>

          <!-- My schedule: one person's day as a list -->
          <div v-if="activeTab === 'me'">
            <div class="d-flex align-items-center gap-2 mb-3">
              <label for="opsPerson" class="small text-muted mb-0">Showing</label>
              <select id="opsPerson" v-model="selectedName" class="form-select form-select-sm w-auto ops-person-select">
                <option value="">{{ meIsSignedInUser && !selectedName ? `${me.name} (you)` : 'Choose a person' }}</option>
                <option v-for="p in crew" :key="p.name" :value="p.name">{{ p.name }} • {{ p.role }}</option>
              </select>
            </div>
            <div class="d-flex flex-column gap-2">
              <div
                v-for="b in sortedBlocks(me)"
                :key="b.id"
                class="ops-list-item d-flex gap-3 align-items-start p-2 rounded-3"
                :class="[BLOCK_TYPES[b.type].className, { 'ops-done': isDone(b), 'ops-current': myNow === b, 'ops-fixed': b.fixed }]"
              >
                <div class="ops-list-time fw-bold small">{{ formatTime(b.start) }}<br><span class="fw-normal text-muted">{{ formatTime(b.end) }}</span></div>
                <div class="flex-grow-1">
                  <div class="fw-semibold small">
                    {{ b.title }}
                    <span v-if="myNow === b" class="badge bg-danger ms-1">NOW</span>
                    <span v-else-if="myNext === b" class="badge bg-dark ms-1">NEXT</span>
                    <span v-if="b.fixed" class="badge bg-light text-dark border ms-1">Fixed time</span>
                  </div>
                  <div class="text-muted ops-small">{{ b.venue }}<span v-if="b.venue"> • </span>{{ BLOCK_TYPES[b.type].label }}</div>
                </div>
                <button v-if="!readOnly" type="button" class="btn btn-link btn-sm p-0 ops-small text-decoration-none" @click="openEditTask(me, b)">Edit</button>
              </div>
              <div v-if="!me.blocks.length" class="text-muted small">No tasks yet. Use "+ Add task" to plan {{ me.name }}'s day.</div>
            </div>
          </div>

          <!-- Everyone now: where each person should be at the show clock -->
          <div v-else-if="activeTab === 'now'">
            <div class="text-muted small mb-2">Where everyone should be at <strong>{{ formatTime(showClock) }}</strong>. Use ◀ ▶ above to change the time.</div>
            <div class="d-flex flex-column gap-2">
              <div v-for="p in crew" :key="p.name" class="d-flex align-items-center gap-2 p-2 rounded-3 border">
                <div class="ops-now-name">
                  <div class="fw-semibold small d-flex align-items-center gap-1">
                    <span class="ops-dot" :class="`ops-dot-${checkInStatus(p)}`"></span>
                    {{ p.name }}
                  </div>
                  <div class="text-muted ops-small">{{ p.role }}</div>
                </div>
                <div class="flex-grow-1">
                  <span v-if="currentBlock(p)" class="ops-chip small" :class="BLOCK_TYPES[currentBlock(p).type].className">
                    {{ currentBlock(p).title }}
                  </span>
                  <span v-else class="text-muted small">Free</span>
                  <div v-if="currentBlock(p)" class="text-muted ops-small mt-1">{{ currentBlock(p).venue }}<span v-if="currentBlock(p).venue"> • </span>until {{ formatTime(currentBlock(p).end) }}</div>
                </div>
              </div>
            </div>
          </div>

          <!-- Full grid: one row per person, time across (like the crew spreadsheet) -->
          <div v-else>
            <div class="ops-grid-scroll">
              <div class="ops-grid">
                <div class="ops-grid-row ops-grid-head">
                  <div class="ops-grid-name"></div>
                  <div class="ops-grid-track">
                    <span v-for="t in halfHours" :key="t" class="ops-tick" :style="{ left: `${percentAt(t)}%` }">{{ formatTime(t) }}</span>
                  </div>
                </div>

                <div v-for="p in crew" :key="p.name" class="ops-grid-row" :class="{ 'ops-grid-me': p.name === activePersona?.name }">
                  <div class="ops-grid-name">
                    <div class="fw-semibold small d-flex align-items-center gap-1">
                      <span class="ops-dot" :class="`ops-dot-${checkInStatus(p)}`"></span>
                      <span class="text-truncate ops-name-full">{{ p.name }}</span>
                      <span class="text-truncate ops-name-short">{{ shortName(p.name) }}</span>
                    </div>
                    <div class="text-muted ops-small text-truncate ops-grid-role">{{ p.role }}</div>
                  </div>
                  <div class="ops-grid-track">
                    <span v-for="t in halfHours" :key="t" class="ops-gridline" :style="{ left: `${percentAt(t)}%` }"></span>
                    <div
                      v-for="b in p.blocks"
                      :key="b.id"
                      class="ops-block"
                      :class="[BLOCK_TYPES[b.type].className, { 'ops-done': isDone(b), 'ops-fixed': b.fixed, 'ops-editable': !readOnly }]"
                      :style="blockStyle(b)"
                      :title="`${b.title}\n${formatTime(b.start)}–${formatTime(b.end)}${b.venue ? ' • ' + b.venue : ''}${b.fixed ? '\nFixed time' : ''}${readOnly ? '' : '\nClick to edit'}`"
                      @click="openEditTask(p, b)"
                    >
                      {{ b.title }}
                    </div>
                    <span class="ops-now-line" :style="{ left: `${percentAt(showClock)}%` }"></span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Legend -->
          <div class="d-flex flex-wrap gap-3 mt-3 pt-3 border-top">
            <span v-for="(type, key) in BLOCK_TYPES" :key="key" class="d-inline-flex align-items-center gap-1 ops-small text-muted">
              <span class="ops-swatch" :class="type.className"></span>{{ type.label }}
            </span>
            <span class="d-inline-flex align-items-center gap-1 ops-small text-muted">
              <span class="ops-swatch ops-swatch-fixed"></span>Fixed time (never moves)
            </span>
            <span class="d-inline-flex align-items-center gap-1 ops-small text-muted">
              <span class="ops-swatch ops-swatch-now"></span>Time shown above
            </span>
          </div>
        </div>
      </div>

      <!-- Crew check-in -->
      <div class="col-lg-4">
        <div class="pulse-card ops-static-card p-3 p-md-4 shadow-sm">
          <h5 class="fw-bold mb-1">Crew check-in</h5>
          <p v-if="isEventDay" class="text-muted small mb-3">Each person is due at their first task. Anyone missing or late shows first.</p>
          <p v-else class="text-muted small mb-3">Opens on {{ event ? formatDate(event.date) : 'the event day' }}. Each person will be due at their first task.</p>

          <div v-if="!needsAttention.length" class="alert alert-success py-2 small mb-3">All {{ crew.length }} checked in ✓</div>

          <div class="d-flex flex-column gap-2 mb-3">
            <div v-for="p in needsAttention" :key="p.name" class="p-3 rounded-3 border bg-light d-flex flex-column gap-1">
              <div class="d-flex justify-content-between align-items-center">
                <strong class="small">{{ p.name }}</strong>
                <span v-if="checkInStatus(p) === 'missing'" class="badge bg-danger" style="font-size: 0.65rem;">Missing</span>
                <span v-else-if="checkInStatus(p) === 'late'" class="badge bg-warning text-dark" style="font-size: 0.65rem;">Running late</span>
                <span v-else class="badge bg-light text-muted border" style="font-size: 0.65rem;">{{ callTime(p) === null ? 'No tasks yet' : `Due ${formatTime(callTime(p))}` }}</span>
              </div>
              <div class="text-muted ops-small">{{ p.role }}<template v-if="p.phone"> • {{ p.phone }}</template></div>
              <div v-if="checkInStatus(p) === 'late'" class="text-secondary ops-small fw-semibold d-flex align-items-center gap-2">
                {{ p.late }}
                <button type="button" class="btn btn-link p-0 text-muted text-decoration-none lh-1" :title="`${p.name} isn't late`" :aria-label="`Clear late for ${p.name}`" @click="clearLate(p)">✕</button>
              </div>
              <div v-else-if="checkInStatus(p) === 'missing'" class="text-danger ops-small fw-semibold">Was due at {{ formatTime(callTime(p)) }}, not checked in</div>

              <div v-if="checkInStatus(p) !== 'due'" class="d-flex gap-2 mt-1">
                <button type="button" class="btn btn-sm btn-outline-success flex-grow-1 py-1 ops-small fw-bold" @click="checkInPerformer(p)">Check in</button>
                <button v-if="checkInStatus(p) === 'missing'" type="button" class="btn btn-sm btn-outline-warning text-dark py-1 ops-small fw-bold" @click="reportLateETA(p)">Running late</button>
                <button type="button" class="btn btn-sm btn-outline-dark py-1 ops-small fw-bold" @click="triggerStandbyForPerformer(p)">Standby</button>
              </div>
            </div>
          </div>

          <div v-if="checkedIn.length" class="ops-small text-muted mb-3 d-flex flex-wrap align-items-center gap-1">
            <span class="fw-semibold text-success me-1">✓ Checked in:</span>
            <span v-for="p in checkedIn" :key="p.memberId" class="badge rounded-pill bg-light text-dark border fw-normal d-inline-flex align-items-center gap-1">
              {{ p.name }}
              <button type="button" class="btn btn-link p-0 text-muted text-decoration-none lh-1" :title="`Undo check-in for ${p.name}`" :aria-label="`Undo check-in for ${p.name}`" @click="undoCheckIn(p)">✕</button>
            </span>
          </div>

          <div class="ops-small text-muted text-center">
            Emergency: Campus Security <strong>+65 6828 0345</strong>
          </div>
        </div>
      </div>
    </div>

    </template>

    <!-- New / edit event -->
    <div v-if="eventEditor" class="modal-backdrop fade show" style="background: rgba(15, 23, 42, 0.6); z-index: 1065;" @click="eventEditor = null"></div>
    <div v-if="eventEditor" class="modal fade show d-block" tabindex="-1" style="z-index: 1070;" role="dialog" aria-modal="true">
      <div class="modal-dialog modal-dialog-centered">
        <form class="modal-content border-0 shadow-lg rounded-4" @submit.prevent="saveEvent">
          <div class="modal-header border-bottom px-4 py-3">
            <h5 class="modal-title fw-bold mb-0">{{ eventEditor.mode === 'edit' ? 'Edit event' : 'New event' }}</h5>
            <button type="button" class="btn-close" aria-label="Close" @click="eventEditor = null"></button>
          </div>
          <div class="modal-body px-4">
            <div v-if="eventEditorError" class="alert alert-danger py-2 small">{{ eventEditorError }}</div>

            <div class="mb-3">
              <label for="opsEventName" class="form-label small fw-bold text-muted mb-1">Event name</label>
              <input id="opsEventName" v-model="eventEditor.name" type="text" class="form-control form-control-sm" placeholder="e.g. Year-end concert" />
            </div>

            <div class="row g-2 mb-3">
              <div class="col-6">
                <label for="opsEventDate" class="form-label small fw-bold text-muted mb-1">Date</label>
                <input id="opsEventDate" v-model="eventEditor.date" type="date" class="form-control form-control-sm" />
              </div>
              <div class="col-6">
                <label for="opsEventVenue" class="form-label small fw-bold text-muted mb-1">Venue</label>
                <input id="opsEventVenue" v-model="eventEditor.venue" type="text" class="form-control form-control-sm" placeholder="e.g. Main Hall" />
              </div>
            </div>

            <!-- The fixed part of the day, added to everyone's plan (new events only) -->
            <div v-if="eventEditor.mode === 'add'" class="p-2 rounded-3 border mb-3">
              <div class="small fw-bold text-muted mb-1">Fixed time (optional)</div>
              <div class="row g-2">
                <div class="col-12 col-sm-5">
                  <input v-model="eventEditor.mainTitle" type="text" class="form-control form-control-sm" aria-label="Fixed block name" placeholder="Performance" />
                </div>
                <div class="col-6 col-sm-auto">
                  <input v-model="eventEditor.mainStart" type="time" step="900" class="form-control form-control-sm" aria-label="Fixed start" />
                </div>
                <div class="col-6 col-sm-auto">
                  <input v-model="eventEditor.mainEnd" type="time" step="900" class="form-control form-control-sm" aria-label="Fixed end" />
                </div>
              </div>
              <div class="text-muted ops-small mt-1">e.g. the show itself. Delays never move it.</div>
            </div>

            <div class="mb-1 small fw-bold text-muted">Which ExCos are on the crew?</div>
            <div class="d-flex flex-wrap gap-2 mb-2">
              <label v-for="exco in excoPool" :key="exco.memberId" class="ops-person-pill small" :class="{ active: eventEditor.crewIds.includes(exco.memberId) }" :title="exco.role">
                <input v-model="eventEditor.crewIds" type="checkbox" class="d-none" :value="exco.memberId" />
                {{ exco.name }}
              </label>
            </div>
            <div class="text-muted ops-small">{{ eventEditor.crewIds.length }} selected. Only crew can be given tasks for this event.</div>
            <div v-if="crewBeingRemoved.length" class="alert alert-warning py-2 small mt-2 mb-0">
              Removing {{ crewBeingRemoved.map(p => `${p.name} (${p.blocks.length} ${p.blocks.length === 1 ? 'task' : 'tasks'})`).join(', ') }} also deletes their tasks for this event.
            </div>
          </div>
          <div class="modal-footer border-top px-4 py-3 d-flex justify-content-between">
            <button v-if="eventEditor.mode === 'edit'" type="button" class="btn btn-sm btn-outline-danger" @click="deleteEvent">Delete event</button>
            <span v-else></span>
            <div class="d-flex gap-2">
              <button type="button" class="btn btn-sm btn-light border" @click="eventEditor = null">Cancel</button>
              <button type="submit" class="btn btn-sm btn-pulse-primary px-3">{{ eventEditor.mode === 'edit' ? 'Save' : 'Create event' }}</button>
            </div>
          </div>
        </form>
      </div>
    </div>

    <!-- Add / edit task -->
    <div v-if="editor" class="modal-backdrop fade show" style="background: rgba(15, 23, 42, 0.6); z-index: 1065;" @click="editor = null"></div>
    <div v-if="editor" class="modal fade show d-block" tabindex="-1" style="z-index: 1070;" role="dialog" aria-modal="true">
      <div class="modal-dialog modal-dialog-centered">
        <form class="modal-content border-0 shadow-lg rounded-4" @submit.prevent="saveTask">
          <div class="modal-header border-bottom px-4 py-3">
            <h5 class="modal-title fw-bold mb-0">{{ editor.mode === 'edit' ? 'Edit task' : 'Add a task' }}</h5>
            <button type="button" class="btn-close" aria-label="Close" @click="editor = null"></button>
          </div>
          <div class="modal-body px-4">
            <div v-if="editorError" class="alert alert-danger py-2 small">{{ editorError }}</div>

            <div class="mb-3">
              <label class="form-label small fw-bold text-muted mb-1">Who (pick one or more)</label>
              <div class="d-flex flex-wrap gap-2">
                <label v-for="p in crew" :key="p.name" class="ops-person-pill small" :class="{ active: editor.names.includes(p.name) }">
                  <input v-model="editor.names" type="checkbox" class="d-none" :value="p.name" />
                  {{ p.name }}
                </label>
              </div>
              <div v-if="editor.mode === 'edit'" class="text-muted ops-small mt-1">Changes apply to everyone ticked. Untick someone to take the task off them.</div>
            </div>

            <div class="mb-3">
              <label for="opsTaskTitle" class="form-label small fw-bold text-muted mb-1">Task</label>
              <input id="opsTaskTitle" v-model="editor.title" type="text" class="form-control form-control-sm" placeholder="e.g. Collect passes and give out" />
            </div>

            <div class="row g-2 mb-3">
              <div class="col-6">
                <label for="opsTaskStart" class="form-label small fw-bold text-muted mb-1">Start</label>
                <input id="opsTaskStart" v-model="editor.start" type="time" step="900" class="form-control form-control-sm" required />
              </div>
              <div class="col-6">
                <label for="opsTaskEnd" class="form-label small fw-bold text-muted mb-1">End</label>
                <input id="opsTaskEnd" v-model="editor.end" type="time" step="900" class="form-control form-control-sm" required />
              </div>
            </div>

            <div class="row g-2 mb-3">
              <div class="col-6">
                <label for="opsTaskType" class="form-label small fw-bold text-muted mb-1">Type</label>
                <select id="opsTaskType" v-model="editor.type" class="form-select form-select-sm">
                  <option v-for="(type, key) in BLOCK_TYPES" :key="key" :value="key">{{ type.label }}</option>
                </select>
              </div>
              <div class="col-6">
                <label for="opsTaskVenue" class="form-label small fw-bold text-muted mb-1">Where</label>
                <input id="opsTaskVenue" v-model="editor.venue" type="text" class="form-control form-control-sm" placeholder="e.g. Main Hall Stage" />
              </div>
            </div>

            <div class="form-check">
              <input id="opsTaskFixed" v-model="editor.fixed" type="checkbox" class="form-check-input" />
              <label for="opsTaskFixed" class="form-check-label small">Fixed time (delays never move it, e.g. the show itself)</label>
            </div>
          </div>
          <div class="modal-footer border-top px-4 py-3 d-flex justify-content-between">
            <button v-if="editor.mode === 'edit'" type="button" class="btn btn-sm btn-outline-danger" @click="deleteTask">{{ editor.group.length > 1 ? 'Delete for everyone' : 'Delete' }}</button>
            <span v-else></span>
            <div class="d-flex gap-2">
              <button type="button" class="btn btn-sm btn-light border" @click="editor = null">Cancel</button>
              <button type="submit" class="btn btn-sm btn-pulse-primary px-3">{{ editor.mode === 'edit' ? 'Save' : 'Add task' }}</button>
            </div>
          </div>
        </form>
      </div>
    </div>

    <!-- Pulse AI Copilot Modal: Standby Matcher & Notice Parser -->
    <div v-if="showAiCopilotModal" class="modal-backdrop fade show" style="background: rgba(15, 23, 42, 0.7); backdrop-filter: blur(4px); z-index: 1065;"></div>
    <div v-if="showAiCopilotModal" class="modal fade show d-block" tabindex="-1" style="z-index: 1070;">
      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content border-0 shadow-lg rounded-4 overflow-hidden" style="background-color: var(--pulse-card-bg); color: var(--pulse-ink);">
          
          <!-- Modal Header with Navigation Tabs -->
          <div class="modal-header border-bottom px-4 py-3 bg-light d-flex justify-content-between align-items-center">
            <div class="d-flex align-items-center gap-2">
              <div class="pulse-logo-badge" style="width: 2rem; height: 2rem; font-size: 0.95rem;">
                <span>AI</span>
              </div>
              <div>
                <h5 class="modal-title fw-bold mb-0">Pulse AI Operational Copilot</h5>
                <small class="text-muted" style="font-size: 0.725rem;">Intelligent On-Call Standby Matching & Telegram Notice Extraction</small>
              </div>
            </div>
            <button type="button" class="btn-close" @click="showAiCopilotModal = false"></button>
          </div>

          <!-- Tab Switcher -->
          <div class="px-4 pt-3 border-bottom pulse-copilot-tab-bar d-flex gap-2">
            <button 
              type="button" 
              class="btn btn-sm pb-2 px-3 border-0 rounded-0 fw-bold"
              :class="activeCopilotTab === 'standby' ? 'border-bottom border-danger border-2 text-danger' : 'text-muted'"
              @click="activeCopilotTab = 'standby'"
            >
              1. On-Call Standby Dispatch
            </button>
            <button 
              type="button" 
              class="btn btn-sm pb-2 px-3 border-0 rounded-0 fw-bold"
              :class="activeCopilotTab === 'parser' ? 'border-bottom border-danger border-2 text-danger' : 'text-muted'"
              @click="activeCopilotTab = 'parser'"
            >
              2. AI Notice & Shopping List Parser
            </button>
          </div>

          <div class="modal-body p-4" style="max-height: 70vh; overflow-y: auto;">
            
            <!-- TAB 1: On-Call Standby Matcher (Emergency Absence Resolution) -->
            <div v-if="activeCopilotTab === 'standby'">
              
              <!-- Problem Context Box -->
              <div class="card p-3 mb-3 border-0 rounded-3" style="background: rgba(239, 68, 68, 0.08); border-left: 4px solid #ef4444 !important;">
                <div class="d-flex justify-content-between align-items-center mb-1">
                  <span class="badge bg-danger rounded-pill px-2 py-0" style="font-size: 0.65rem;">PERFORMER ABSENCE DETECTED</span>
                  <span class="text-muted small" style="font-size: 0.7rem;">Heatmap Cross-Referenced</span>
                </div>
                <div class="fw-bold small text-dark">
                  Target Member: {{ targetAbsentPerformer ? targetAbsentPerformer.name : 'Darren Koh' }} 
                  ({{ targetAbsentPerformer ? targetAbsentPerformer.role : 'Performer & Props' }})
                </div>
                <p class="small text-muted mb-0" style="font-size: 0.75rem;">
                  Member reported emergency / delay for Act 2: Eurhythmix Tech Rehearsal. Pulse AI analyzed available members in the Weekly Availability Heatmap with matching skill tags and OneMap transit proximity.
                </p>
              </div>

              <!-- Standby Candidates List -->
              <h6 class="fw-bold text-dark mb-2" style="font-size: 0.85rem;">Top AI-Matched On-Call Replacements:</h6>
              <div class="d-flex flex-column gap-2 mb-3">
                
                <div 
                  v-for="candidate in standbyPool" 
                  :key="candidate.id"
                  class="p-3 rounded-3 border bg-light d-flex flex-column flex-sm-row justify-content-between align-items-sm-center gap-2"
                >
                  <div>
                    <div class="d-flex align-items-center gap-2 mb-1">
                      <strong class="text-dark small">{{ candidate.name }}</strong>
                      <span class="badge bg-success bg-opacity-10 text-success border border-success-subtle" style="font-size: 0.65rem;">
                        {{ candidate.matchScore }}% AI Match
                      </span>
                      <span class="badge bg-light text-muted border" style="font-size: 0.65rem;">{{ candidate.status }}</span>
                    </div>
                    <div class="text-muted small" style="font-size: 0.725rem;">
                      {{ candidate.role }} • {{ candidate.phone }}
                    </div>
                    <div class="text-secondary small mt-1" style="font-size: 0.725rem;">
                      <span>{{ candidate.availability }}</span>
                      <span class="mx-1">•</span>
                      <span class="text-primary fw-semibold">{{ candidate.distance }}</span>
                    </div>
                    <div class="text-muted small fst-italic" style="font-size: 0.7rem;">
                      {{ candidate.qualification }}
                    </div>
                  </div>

                  <button 
                    type="button" 
                    class="btn btn-sm btn-pulse-primary text-nowrap px-3 py-1 fw-bold"
                    style="font-size: 0.75rem;"
                    :disabled="isDispatchingStandby"
                    @click="dispatchStandby(candidate)"
                  >
                    <span v-if="isDispatchingStandby">Dispatching...</span>
                    <span v-else>Dispatch via Telegram</span>
                  </button>
                </div>

              </div>

              <div class="p-2 rounded-2 bg-light border text-muted small text-center" style="font-size: 0.725rem;">
                One-click dispatch sends a high-priority Telegram Bot alert and reassigns the cue card in the live production run-of-show.
              </div>
            </div>

            <!-- TAB 2: AI Telegram Notice & Shopping List Parser (Ardiente Real Problem) -->
            <div v-else>
              <div class="card p-3 mb-3 border-0 rounded-3" style="background: rgba(14, 165, 233, 0.08); border-left: 4px solid #0284c7 !important;">
                <div class="d-flex justify-content-between align-items-center mb-1">
                  <span class="badge bg-primary rounded-pill px-2 py-0" style="font-size: 0.65rem;">UNSTRUCTURED CHAT TO ACTIONABLE PULSE DATA</span>
                  <button 
                    type="button" 
                    class="btn btn-link btn-sm p-0 text-primary text-decoration-none small fw-bold"
                    style="font-size: 0.7rem;"
                    @click="loadSampleChat"
                  >
                    Load Real Ardiente Chat Sample
                  </button>
                </div>
                <p class="small text-muted mb-0" style="font-size: 0.75rem;">
                  In regular flat Telegram group chats, important notices, room give-aways, and shopping lists get buried. Paste any unorganized message below to extract facility handovers, checklists, and tasks automatically.
                </p>
              </div>

              <!-- Input Textarea -->
              <div class="mb-3">
                <label class="form-label small fw-bold text-dark mb-1">Paste Raw Telegram Message or Notice:</label>
                <textarea 
                  v-model="rawChatInput"
                  class="form-control form-control-sm"
                  rows="4"
                  placeholder="Paste unstructured announcement from Telegram group chat..."
                ></textarea>
              </div>

              <div class="d-flex justify-content-end mb-3">
                <button 
                  type="button" 
                  class="btn btn-sm btn-danger px-3 py-1 fw-bold d-flex align-items-center gap-2"
                  :disabled="isAiParsing || !rawChatInput.trim()"
                  @click="parseNoticeWithAi"
                >
                  <span v-if="isAiParsing" class="spinner-border spinner-border-sm" role="status"></span>
                  <span>{{ isAiParsing ? 'Analyzing with Pulse AI...' : 'Run Pulse AI Parser' }}</span>
                </button>
              </div>

              <!-- Structured Output Results -->
              <div v-if="parsedNoticeResult" class="p-3 border rounded-3 bg-light">
                <div class="d-flex align-items-center justify-content-between mb-2">
                  <h6 class="fw-bold text-dark mb-0" style="font-size: 0.825rem;">Extracted Structured Outputs:</h6>
                  <span class="badge bg-success rounded-pill px-2 py-0" style="font-size: 0.65rem;">Parsed via LLM Prompt Engine</span>
                </div>

                <div class="row g-2 mb-3">
                  <!-- Extracted Facility Release -->
                  <div class="col-md-6">
                    <div class="p-2 pulse-extracted-item rounded-2 border">
                      <div class="fw-bold text-danger small" style="font-size: 0.725rem;">Extracted Facility Giveaway:</div>
                      <div class="fw-bold text-dark" style="font-size: 0.8rem;">{{ parsedNoticeResult.facilityRelease.venue }}</div>
                      <div class="text-muted small" style="font-size: 0.7rem;">{{ parsedNoticeResult.facilityRelease.date }} • {{ parsedNoticeResult.facilityRelease.time }}</div>
                      <span class="badge bg-danger bg-opacity-10 text-danger border mt-1" style="font-size: 0.65rem;">
                        {{ parsedNoticeResult.facilityRelease.action }}
                      </span>
                    </div>
                  </div>

                  <!-- Extracted Gear & Cues -->
                  <div class="col-md-6">
                    <div class="p-2 pulse-extracted-item rounded-2 border">
                      <div class="fw-bold text-primary small" style="font-size: 0.725rem;">Rehearsal Gear Checklist:</div>
                      <div class="text-dark small fw-semibold" style="font-size: 0.75rem;">
                        {{ parsedNoticeResult.rehearsalCues.location }}
                      </div>
                      <ul class="mb-0 ps-3 small text-muted" style="font-size: 0.7rem;">
                        <li v-for="(gear, idx) in parsedNoticeResult.rehearsalCues.gearRequired" :key="idx">{{ gear }}</li>
                        <li v-for="(tech, idx) in parsedNoticeResult.rehearsalCues.techNeeds" :key="idx">{{ tech }}</li>
                      </ul>
                    </div>
                  </div>
                </div>

                <!-- Extracted Shopping List -->
                <div class="p-2 pulse-extracted-item rounded-2 border mb-2">
                  <div class="fw-bold text-success small mb-1" style="font-size: 0.725rem;">Logistics Shopping Checklist:</div>
                  <div class="d-flex flex-column gap-1">
                    <div 
                      v-for="(shop, idx) in parsedNoticeResult.shoppingList" 
                      :key="idx"
                      class="d-flex justify-content-between align-items-center py-1 px-2 rounded bg-light small"
                      style="font-size: 0.725rem;"
                    >
                      <span class="fw-semibold text-dark">{{ shop.item }}</span>
                      <div class="d-flex align-items-center gap-2">
                        <span class="text-muted">{{ shop.store }}</span>
                        <span class="badge bg-secondary-subtle text-dark border">{{ shop.owner }}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Clean Formatted Telegram Topic Message -->
                <div class="p-2 pulse-extracted-item rounded-2 border">
                  <div class="d-flex justify-content-between align-items-center mb-1">
                    <span class="fw-bold text-secondary small" style="font-size: 0.725rem;">Clean Formatted Telegram Broadcast:</span>
                    <button 
                      type="button" 
                      class="btn btn-link btn-sm p-0 text-decoration-none small text-primary fw-bold"
                      style="font-size: 0.7rem;"
                      @click="toastMsg = 'Copied clean formatted digest to clipboard!'; setTimeout(() => toastMsg = '', 3000)"
                    >
                      Copy to Clipboard
                    </button>
                  </div>
                  <pre class="mb-0 p-2 rounded bg-light text-dark small" style="font-size: 0.7rem; white-space: pre-wrap; font-family: inherit;">{{ parsedNoticeResult.telegramSummary }}</pre>
                </div>

              </div>

            </div>

          </div>

          <div class="modal-footer border-top px-4 py-3 bg-light d-flex justify-content-between align-items-center">
            <span class="text-muted small" style="font-size: 0.725rem;">Powered by Gemini API & SMU Availability Heatmap Engine</span>
            <button type="button" class="btn btn-pulse-primary btn-sm px-4 rounded-pill" @click="showAiCopilotModal = false">
              Close AI Assistant
            </button>
          </div>

        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
.ops-label { font-size: 0.65rem; letter-spacing: 0.04em; }
.ops-small { font-size: 0.72rem; }
.ops-clock { font-variant-numeric: tabular-nums; min-width: 3.5rem; text-align: center; }

/* Big cards here hold the timeline, so they shouldn't jump on hover */
.ops-static-card:hover { transform: none; }

.ops-tabs .nav-link { font-size: 0.8rem; font-weight: 600; padding: 0.35rem 0.8rem; color: var(--pulse-ink, #334155); }
.ops-tabs .nav-link.active { background-color: #dc3545; color: #fff; }

/* The delay menu opens to the right so it stays on screen on phones */
.ops-delay .ops-more-menu { left: 0; right: auto; min-width: 140px; }
/* On phones More tools wraps to the left edge, so open that one to the right too */
@media (max-width: 576px) {
  .ops-more .ops-more-menu { left: 0; right: auto; }
}

.ops-more-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  z-index: 20;
  min-width: 220px;
  background: #fff;
}

/* Block colours (same as the crew spreadsheet legend) */
.ops-block-setup { background-color: #f4d4d8; }
.ops-block-move { background-color: #e3dcf2; }
.ops-block-perform { background-color: #fbefc4; }
.ops-block-meal { background-color: #d6ead9; }
.ops-block-other { background-color: #d5e3f5; }
.ops-done { opacity: 0.45; }

.ops-swatch { width: 12px; height: 12px; border-radius: 3px; display: inline-block; border: 1px solid rgba(0, 0, 0, 0.08); }
.ops-swatch-now { background-color: #dc3545; width: 3px; border: 0; }

/* Check-in status dots next to names */
.ops-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; background-color: #cbd5e1; }
.ops-dot-in { background-color: #16a34a; }
.ops-dot-late { background-color: #f59e0b; }
.ops-dot-missing { background-color: #dc3545; }

/* Fixed-time blocks (never moved by a delay) get a dark left edge */
.ops-fixed { box-shadow: inset 3px 0 0 #1f2937; }
.ops-swatch-fixed { background-color: #fbefc4; box-shadow: inset 3px 0 0 #1f2937; }
.ops-editable { cursor: pointer; }
.ops-editable:hover { filter: brightness(0.96); }

/* People picker in the add-task form */
.ops-person-pill {
  border: 1px solid #d1d5db;
  border-radius: 9999px;
  padding: 0.25rem 0.75rem;
  cursor: pointer;
  user-select: none;
}
.ops-person-pill.active { background-color: #dc3545; border-color: #dc3545; color: #fff; }

/* My schedule list */
.ops-list-time { width: 3.2rem; flex-shrink: 0; font-variant-numeric: tabular-nums; }
.ops-current { outline: 2px solid #dc3545; }

/* Everyone now */
.ops-now-name { width: 9.5rem; flex-shrink: 0; }
.ops-chip { display: inline-block; padding: 0.2rem 0.55rem; border-radius: 0.5rem; font-weight: 600; }

/* Full grid: names on the left, time across; scrolls sideways on small screens */
.ops-grid-scroll { overflow-x: auto; }
.ops-grid { min-width: 1250px; }
.ops-grid-row { display: flex; align-items: stretch; border-bottom: 1px solid #eef0f3; }
.ops-grid-name {
  width: 150px;
  flex-shrink: 0;
  padding: 0.45rem 0.6rem 0.45rem 0;
  position: sticky;
  left: 0;
  z-index: 3;
  background: #fff;
}
.ops-grid-me .ops-grid-name { box-shadow: inset 3px 0 0 #dc3545; padding-left: 0.5rem; }
.ops-name-short { display: none; }
/* Long names + roles would push the picker past the card on phones */
.ops-person-select { min-width: 0; max-width: 100%; text-overflow: ellipsis; }

/* Phones only: thinner name column so more of the timeline fits */
@media (max-width: 576px) {
  .ops-grid-name { width: 84px; }
  .ops-name-full,
  .ops-grid-role { display: none; }
  .ops-name-short { display: inline; }
}
.ops-grid-track { position: relative; flex-grow: 1; min-height: 52px; }
.ops-grid-head .ops-grid-track { min-height: 22px; }
.ops-tick { position: absolute; top: 0; padding-left: 4px; font-size: 0.65rem; color: #64748b; font-variant-numeric: tabular-nums; }
.ops-gridline { position: absolute; top: 0; bottom: 0; border-left: 1px dashed #e5e7eb; }

.ops-block {
  position: absolute;
  top: 5px;
  bottom: 5px;
  border-radius: 6px;
  padding: 3px 6px;
  font-size: 0.68rem;
  font-weight: 600;
  line-height: 1.25;
  color: #1f2937;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  word-break: normal;
  border: 1px solid rgba(255, 255, 255, 0.9);
  z-index: 1;
}
.ops-now-line { position: absolute; top: 0; bottom: 0; width: 2px; background-color: #dc3545; z-index: 2; }
</style>
