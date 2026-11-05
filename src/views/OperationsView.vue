<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { supabase } from '../supabase';
import { session as facilitySession, demoMemberId } from '../services/sessionState';
import { loadClubExcos, loadEvents as fetchEvents, saveEvent as saveEventToDb, deleteEvent as deleteEventFromDb, isMissingTableError, loadClubBookings } from '../services/opsService';

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

const excoPool = ref(SAMPLE_EXCOS)

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
      date: todayIso(),
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

const dataMode = ref('local')
const loadingEvents = ref(true)
const saveState = ref('')
const activeClubId = computed(() => facilitySession.value.activeClubId)

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
  } catch { }
  events.value = sampleEvents()
  selectedEventId.value = events.value[0].id
}

function saveLocalEvents() {
  try {
    localStorage.setItem(storageKey.value, JSON.stringify({ events: events.value, selectedEventId: selectedEventId.value }))
  } catch { }
}

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

watch(
  () => [facilitySession.value.ready, facilitySession.value.authUserId, activeClubId.value, props.readOnly],
  ([ready]) => {
    if (ready || !supabase) loadEventsForPage()
  },
  { immediate: true }
)

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

const allBlocks = computed(() => crew.value.flatMap(p => p.blocks))
const dayStart = computed(() => {
  const starts = allBlocks.value.map(b => b.start)
  if (event.value?.start != null) starts.push(event.value.start)
  return starts.length ? Math.floor(Math.min(...starts) / 30) * 30 : toMinutes('09:00')
})
const dayEnd = computed(() => {
  const ends = allBlocks.value.map(b => b.end)
  if (event.value?.end != null) ends.push(event.value.end)
  return ends.length ? Math.ceil(Math.max(...ends) / 30) * 30 : toMinutes('18:00')
})
const halfHours = computed(() => {
  const ticks = []
  for (let t = dayStart.value; t < dayEnd.value; t += 30) ticks.push(t)
  return ticks
})

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
/* 5. CLOCK & SLIDER TIME CONTROL & AUTO-SCROLLING                     */
/* ================================================================== */

const showClock = ref(toMinutes('17:00'))
const today = ref(todayIso())
const followLive = ref(true)
const gridScrollContainer = ref(null)

function checkAutoScrollGrid() {
  nextTick(() => {
    const container = gridScrollContainer.value
    if (!container) return
    const gridEl = container.querySelector('.ops-grid')
    if (!gridEl) return

    const gridWidth = gridEl.offsetWidth
    const redLineX = (percentAt(showClock.value) / 100) * gridWidth
    
    const nameColWidth = 150
    const scrollLeft = container.scrollLeft
    const visibleWidth = container.clientWidth
    const visibleRight = scrollLeft + visibleWidth
    const visibleLeft = scrollLeft + nameColWidth

    if (redLineX > visibleRight - 60) {
      container.scrollTo({
        left: redLineX - visibleWidth + 120,
        behavior: 'smooth'
      })
    } else if (redLineX < visibleLeft + 60) {
      container.scrollTo({
        left: Math.max(0, redLineX - nameColWidth - 60),
        behavior: 'smooth'
      })
    }
  })
}

function onSliderInput(e) {
  followLive.value = false
  showClock.value = Number(e.target.value)
  checkAutoScrollGrid()
}

const eventDay = computed(() => {
  if (!event.value) return 'upcoming'
  if (event.value.date === today.value) return 'today'
  return event.value.date > today.value ? 'upcoming' : 'past'
})
const isEventDay = computed(() => eventDay.value === 'today')

const daysAway = computed(() => {
  if (!event.value || !event.value.date) return 0
  const rawDate = event.value.date.includes('T') ? event.value.date.split('T')[0] : event.value.date
  const [y, m, d] = rawDate.split('-').map(Number)
  const [ty, tm, td] = (today.value || todayIso()).split('-').map(Number)
  if (!y || !m || !d || !ty || !tm || !td) return 0
  const diff = Math.round((new Date(y, m - 1, d) - new Date(ty, tm - 1, td)) / 86400000)
  return isNaN(diff) ? 0 : Math.max(0, diff)
})

function resetClock() {
  followLive.value = true
  if (isEventDay.value) {
    showClock.value = minutesNow()
  } else {
    showClock.value = dayStart.value + Math.min(120, Math.floor((dayEnd.value - dayStart.value) / 2 / 15) * 15)
  }
  checkAutoScrollGrid()
}

let clockTimer = null
function tickClock() {
  const dateNow = todayIso()
  if (dateNow !== today.value) {
    today.value = dateNow
    resetClock()
  } else if (isEventDay.value && followLive.value) {
    showClock.value = minutesNow()
    checkAutoScrollGrid()
  }
}

function currentBlock(person, time = showClock.value) {
  return person.blocks.find(b => b.start <= time && time < b.end) || null
}

function nextBlock(person, time = showClock.value) {
  return sortedBlocks(person).find(b => b.start > time) || null
}

function isDone(b) {
  if (eventDay.value === 'past') return true
  return isEventDay.value && b.end <= showClock.value
}

/* ================================================================== */
/* 6. WHOSE SCHEDULE "MY SCHEDULE" SHOWS                               */
/* ================================================================== */

const selectedName = ref('')

const me = computed(() => {
  const wanted = selectedName.value || props.activePersona?.name
  return crew.value.find(p => p.name === wanted) || crew.value[0] || null
})
const meIsSignedInUser = computed(() => !!me.value && me.value.name === props.activePersona?.name)

const myNow = computed(() => (me.value ? currentBlock(me.value) : null))
const myNext = computed(() => (me.value ? nextBlock(me.value) : null))

/* ================================================================== */
/* 7. TABS                                                             */
/* ================================================================== */

const activeTab = ref('grid')
const showDelayMenu = ref(false)

function closeDelayMenu(e) {
  if (!e.target.closest('.ops-delay')) showDelayMenu.value = false
}

onMounted(() => {
  if (window.innerWidth < 768) activeTab.value = 'me'
  document.addEventListener('click', closeDelayMenu)
  clockTimer = setInterval(tickClock, 30000)
  checkAutoScrollGrid()
})
onBeforeUnmount(() => {
  document.removeEventListener('click', closeDelayMenu)
  clearInterval(clockTimer)
})

/* ================================================================== */
/* 8. SHOW RUNNING LATE                                               */
/* ================================================================== */

const MIN_MEAL_MINUTES = 15
const DELAY_OPTIONS = [5, 10, 15, 30, 45, 60]
const customDelayMinutes = ref('')

function handleCustomDelay() {
  const mins = parseInt(customDelayMinutes.value, 10)
  if (!mins || isNaN(mins) || mins <= 0) {
    showToast('Please enter a valid number of minutes to delay.')
    return
  }
  applyOneClickDelay(mins)
  customDelayMinutes.value = ''
  showDelayMenu.value = false
}

const delayNotice = ref(null)
const totalDelay = ref(0)

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
    if (overlap <= 0) break

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

const isNotifyingCrew = ref(false)

async function applyOneClickDelay(mins) {
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

  try {
    const result = await queueCrewAlert('delayed', mins)
    showToast('Delay saved. Telegram alerts queued for ' + result.queued + ' crew members.')
  } catch (error) {
    showToast('Delay applied, but Telegram alerts could not be queued: ' + error.message, 6000)
  }
}

async function queueCrewAlert(action, delayMinutes = null) {
  if (!supabase || !event.value || !facilitySession.value.authUserId) throw new Error('Sign in to queue crew alerts.')
  if (dataMode.value === 'supabase') {
    clearTimeout(saveTimer)
    await saveChangedEvents()
    if (saveState.value === 'error') throw new Error('Save the event changes before notifying crew.')
  }
  const { data, error } = await supabase.rpc('rpc_notify_ops_schedule_change', {
    p_club_id: activeClubId.value,
    p_event_id: dataMode.value === 'supabase' ? event.value.id : null,
    p_member_names: dataMode.value === 'local' ? crew.value.map(person => person.name) : null,
    p_action: action,
    p_delay_minutes: delayMinutes,
    p_event_name: event.value.name,
    p_event_date: event.value.date,
    p_venue: event.value.venue || null
  })
  if (error) throw error
  if (!data || !Number.isInteger(data.queued) || data.queued < 1) throw new Error('No active crew alerts were queued.')
  return data
}

async function publishToMobile() {
  if (blockedForGuest() || isNotifyingCrew.value) return
  isNotifyingCrew.value = true
  try {
    const result = await queueCrewAlert('updated')
    showToast('Updated run of show for ' + event.value.name + ': Telegram alerts queued for ' + result.queued + ' crew members.', 5000)
  } catch (error) {
    showToast('Telegram alerts could not be queued: ' + error.message, 6000)
  } finally {
    isNotifyingCrew.value = false
  }
}

/* ================================================================== */
/* 9. ADD / EDIT AN EVENT & DELETE EVENT                               */
/* ================================================================== */

const eventEditor = ref(null)
const eventEditorError = ref('')

function openNewEvent() {
  if (blockedForGuest()) return
  const signedIn = excoPool.value.find(e => e.memberId === facilitySession.value.memberId || e.name === props.activePersona?.name)
  eventEditor.value = {
    mode: 'add',
    name: '',
    date: '',
    venue: '',
    facilityBookingId: null,
    start: '',
    end: '',
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
    facilityBookingId: event.value.facilityBookingId ?? null,
    start: formatTime(event.value.start ?? dayStart.value),
    end: formatTime(event.value.end ?? dayEnd.value),
    crewIds: crew.value.map(p => p.memberId)
  }
  eventEditorError.value = ''
}

const bookingOptions = ref([])
const bookingOptionsNote = ref('')
watch(() => eventEditor.value?.date, async (date) => {
  bookingOptions.value = []
  bookingOptionsNote.value = ''
  if (!date || dataMode.value !== 'supabase' || !activeClubId.value) return
  try {
    const bookings = await loadClubBookings(activeClubId.value, date)
    if (eventEditor.value?.date !== date) return
    bookingOptions.value = bookings
    if (!bookings.some(b => b.id === eventEditor.value.facilityBookingId)) eventEditor.value.facilityBookingId = null
  } catch {
    bookingOptionsNote.value = 'Could not load your bookings. Try again later.'
  }
})

function pickBooking() {
  const e = eventEditor.value
  const booking = bookingOptions.value.find(b => b.id === e.facilityBookingId)
  if (booking && !e.venue.trim()) e.venue = booking.facility
}

const crewBeingRemoved = computed(() => {
  if (!eventEditor.value || eventEditor.value.mode !== 'edit') return []
  return crew.value.filter(p => !eventEditor.value.crewIds.includes(p.memberId) && p.blocks.length)
})

function saveEvent() {
  const e = eventEditor.value
  if (!e.name.trim()) return (eventEditorError.value = 'Give the event a name.')
  if (!e.date) return (eventEditorError.value = 'Pick a date.')
  if (!e.crewIds.length) return (eventEditorError.value = 'Pick at least one ExCo for the crew.')
  if (!e.start || !e.end) return (eventEditorError.value = 'Give the event a start and end time (from set-up to teardown).')
  const start = toMinutes(e.start)
  const end = toMinutes(e.end)
  if (end <= start) return (eventEditorError.value = 'The event must end after it starts.')

  if (e.mode === 'add') {
    const hasMain = e.mainStart && e.mainEnd
    if (hasMain && toMinutes(e.mainEnd) <= toMinutes(e.mainStart)) {
      return (eventEditorError.value = 'The fixed time must end after it starts.')
    }
    if (hasMain && (toMinutes(e.mainStart) < start || toMinutes(e.mainEnd) > end)) {
      return (eventEditorError.value = `The fixed time has to be within the event (${e.start}–${e.end}).`)
    }
    const newEvent = {
      id: newId(),
      name: e.name.trim(),
      date: e.date,
      venue: e.venue.trim(),
      facilityBookingId: e.facilityBookingId ?? null,
      start,
      end,
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
    event.value.facilityBookingId = e.facilityBookingId ?? null
    event.value.start = start
    event.value.end = end
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
  if (blockedForGuest()) return
  if (!event.value) return

  if (dataMode.value === 'local' && events.value.length === 1) {
    if (eventEditor.value) {
      eventEditorError.value = 'This is the only event. Create another one before deleting it.'
    } else {
      showToast('This is the only event. Create another one before deleting it.')
    }
    return
  }

  if (!window.confirm(`Delete ${event.value.name} and its whole operations plan?`)) return
  const { id, name } = event.value
  if (dataMode.value === 'supabase' && lastSaved.has(id)) {
    try {
      await deleteEventFromDb(id)
    } catch (error) {
      if (eventEditor.value) {
        eventEditorError.value = `Couldn't delete: ${error.message}`
      } else {
        showToast(`Couldn't delete event: ${error.message}`, 6000)
      }
      return
    }
    lastSaved.delete(id)
  }
  events.value = events.value.filter(ev => ev.id !== id)
  selectedEventId.value = events.value.length ? events.value[0].id : null
  eventEditor.value = null
  showToast(`Deleted event: "${name}".`)
}

/* ================================================================== */
/* 10. PLANNING: add, edit and remove tasks                            */
/* ================================================================== */

const editor = ref(null)
const editorError = ref('')

function roundToQuarter(minutes) {
  return Math.ceil(minutes / 15) * 15
}

function openAddTask(prefill = null) {
  if (blockedForGuest()) return
  const start = prefill ? prefill.start : roundToQuarter(showClock.value)
  const end = prefill ? prefill.end : start + 60
  editor.value = {
    mode: 'add',
    names: prefill ? prefill.names : [me.value.name],
    title: '',
    type: 'other',
    start: formatTime(start),
    end: formatTime(end),
    venue: event.value.venue,
    fixed: false
  }
  editorError.value = ''
}

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
    for (const g of e.group) {
      const person = crew.value.find(p => p.name === g.name)
      if (e.names.includes(g.name)) {
        Object.assign(person.blocks.find(b => b.id === g.blockId), fields)
      } else {
        person.blocks = person.blocks.filter(b => b.id !== g.blockId)
      }
    }
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

function deleteTask() {
  const e = editor.value
  for (const g of e.group) {
    const person = crew.value.find(p => p.name === g.name)
    person.blocks = person.blocks.filter(b => b.id !== g.blockId)
  }
  showToast(`Removed "${e.title}" for ${e.group.map(g => g.name).join(', ')}.`)
  editor.value = null
}

/* ---------------- Drag on grid to add task ---------------- */

const drag = ref(null)

function minuteAtPointer(e, track) {
  const rect = track.getBoundingClientRect()
  const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
  return Math.round((dayStart.value + ratio * (dayEnd.value - dayStart.value)) / 15) * 15
}

const dragSelection = computed(() => {
  if (!drag.value) return null
  const d = drag.value
  return {
    fromRow: Math.min(d.fromRow, d.toRow),
    toRow: Math.max(d.fromRow, d.toRow),
    start: Math.min(d.anchor, d.current),
    end: Math.max(d.anchor, d.current)
  }
})

function inDragSelection(rowIndex) {
  const s = dragSelection.value
  return !!s && s.end > s.start && rowIndex >= s.fromRow && rowIndex <= s.toRow
}

function dragClashes(person) {
  const s = dragSelection.value
  return person.blocks.some(b => b.start < s.end && s.start < b.end)
}

function startDrag(e, rowIndex) {
  if (props.readOnly || e.pointerType !== 'mouse' || e.button !== 0) return
  if (e.target.closest('.ops-block')) return
  e.preventDefault()
  const track = e.currentTarget
  const minute = minuteAtPointer(e, track)
  drag.value = { track, fromRow: rowIndex, toRow: rowIndex, anchor: minute, current: minute }
  window.addEventListener('pointermove', moveDrag)
  window.addEventListener('pointerup', endDrag)
}

function moveDrag(e) {
  if (!drag.value) return
  drag.value.current = minuteAtPointer(e, drag.value.track)
  const row = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-ops-row]')
  if (row) drag.value.toRow = Number(row.dataset.opsRow)
}

function endDrag() {
  window.removeEventListener('pointermove', moveDrag)
  window.removeEventListener('pointerup', endDrag)
  const s = dragSelection.value
  drag.value = null
  if (!s || s.end - s.start < 15) return
  openAddTask({
    names: crew.value.slice(s.fromRow, s.toRow + 1).map(p => p.name),
    start: s.start,
    end: s.end
  })
}

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', moveDrag)
  window.removeEventListener('pointerup', endDrag)
})

/* ================================================================== */
/* 11. CREW CHECK-IN                                                  */
/* ================================================================== */

function callTime(person) {
  return person.blocks.length ? Math.min(...person.blocks.map(b => b.start)) : null
}

function checkInStatus(p) {
  if (eventDay.value === 'upcoming') return 'due'
  if (eventDay.value === 'past') return p.checkedInAt !== null ? 'in' : 'due'
  if (p.checkedInAt !== null && p.checkedInAt <= showClock.value) return 'in'
  if (p.late) return 'late'
  const call = callTime(p)
  if (call === null || showClock.value < call) return 'due'
  return 'missing'
}

const STATUS_ORDER = { missing: 0, late: 1, due: 2, in: 3 }

const sortedCrewForCheckIn = computed(() => {
  return [...crew.value].sort((a, b) => STATUS_ORDER[checkInStatus(a)] - STATUS_ORDER[checkInStatus(b)])
})

const checkedIn = computed(() => crew.value.filter(p => checkInStatus(p) === 'in'))

function blockedBeforeEventDay() {
  if (isEventDay.value) return false
  showToast('Check-in opens on the day of the event.')
  return true
}

const LATE_OPTIONS = [5, 10, 15, 30]
const lateChoiceFor = ref(null)

function reportLateETA(person, mins) {
  lateChoiceFor.value = null
  if (blockedForGuest() || blockedBeforeEventDay()) return
  person.late = `+${mins} min late`
  showToast(`${person.name} marked as running ${mins} min late.`)
}

function checkInPerformer(person) {
  if (blockedForGuest() || blockedBeforeEventDay()) return
  person.checkedInAt = showClock.value
  person.late = ''
  showToast(`${person.name} checked in at ${formatTime(showClock.value)}.`)
}

function initials(name) {
  const parts = name.trim().split(/\s+/)
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

function shortName(name) {
  const parts = name.trim().split(/\s+/)
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}` : parts[0]
}

function undoCheckIn(person) {
  if (blockedForGuest() || blockedBeforeEventDay()) return
  person.checkedInAt = null
  showToast(`${person.name} is no longer checked in.`)
}

function clearLate(person) {
  if (blockedForGuest() || blockedBeforeEventDay()) return
  person.late = ''
  showToast(`${person.name} is no longer marked late.`)
}
</script>

<template>
  <div class="py-2">
    <p class="text-muted small">Saved events and tasks automatically remind assigned crew on Telegram 15 minutes before they start. Sample plans do not send reminders.</p>

    <!-- Header: which event, plus the main actions -->
    <div class="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-3">
      <div class="ops-event-heading">
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
            <button v-if="event" type="button" class="btn btn-sm btn-outline-danger border" @click="deleteEvent">Delete event</button>
            <button type="button" class="btn btn-sm btn-outline-danger fw-semibold" @click="openNewEvent">+ New event</button>
          </template>
        </div>
        <p v-if="event" class="text-muted small mb-0 mt-2">
          {{ formatDate(event.date) }}<span v-if="event.venue"> • {{ event.venue }}</span> • {{ crew.length }} ExCo{{ crew.length === 1 ? '' : 's' }} on the crew
        </p>
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
          <div v-if="showDelayMenu" class="ops-more-menu shadow-lg border rounded-3 py-1 overflow-hidden" style="min-width: 220px; z-index: 1050;">
            <div class="px-3 py-1.5 text-uppercase fw-bold text-muted border-bottom" style="font-size: 0.65rem; letter-spacing: 0.04em;">
              Quick Presets
            </div>
            <div class="py-1">
              <button v-for="mins in DELAY_OPTIONS" :key="mins" type="button" class="dropdown-item small py-1.5 px-3 d-flex justify-content-between align-items-center" @click="applyOneClickDelay(mins)">
                <span class="fw-semibold">+{{ mins }} min</span>
                <span class="text-muted" style="font-size: 0.68rem;">Delay</span>
              </button>
            </div>
            <div class="p-2.5 border-top bg-light">
              <label for="customDelayInput" class="small fw-bold text-dark d-block mb-1" style="font-size: 0.72rem;">
                Custom Delay:
              </label>
              <div class="input-group input-group-sm mb-1">
                <input 
                  id="customDelayInput"
                  v-model.number="customDelayMinutes" 
                  type="number" 
                  min="1" 
                  max="300" 
                  placeholder="Minutes" 
                  class="form-control form-control-sm px-2"
                  style="font-size: 0.78rem;"
                  @keyup.enter="handleCustomDelay"
                />
                <button 
                  type="button" 
                  class="btn btn-sm btn-warning text-dark fw-bold px-2.5" 
                  :disabled="!customDelayMinutes || customDelayMinutes <= 0"
                  style="font-size: 0.75rem;"
                  @click="handleCustomDelay"
                >
                  Apply
                </button>
              </div>
              <div class="d-flex justify-content-between align-items-center">
                <small class="text-muted" style="font-size: 0.66rem;">e.g. 45, 90 mins</small>
                <button type="button" class="btn btn-link p-0 text-muted ops-small text-decoration-none" style="font-size: 0.68rem;" @click="showDelayMenu = false">Close</button>
              </div>
            </div>
          </div>
        </div>

        <button 
          type="button" 
          class="btn btn-sm btn-pulse-primary d-flex align-items-center gap-2 shadow-2xs" 
          :disabled="isNotifyingCrew"
          @click="publishToMobile"
        >
          <span v-if="isNotifyingCrew" class="spinner-border spinner-border-sm" role="status"></span>
          <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
          <span>Notify crew</span>
          <span class="badge bg-white text-danger px-1.5 py-0.5 rounded-pill" style="font-size: 0.65rem; font-weight: 700;">
            Telegram
          </span>
        </button>

        <button v-if="!readOnly && dataMode === 'local'" type="button" class="btn btn-sm btn-light border text-danger" @click="resetPlan">Reset sample</button>
      </div>
    </div>

    <!-- Before / after the event day -->
    <div v-if="event && eventDay === 'upcoming'" class="alert alert-info border-0 shadow-sm mb-3 small" role="status">
      <strong>Planning ahead:</strong> {{ event.name }} is {{ daysAway === 1 ? 'tomorrow' : `in ${daysAway || 1} days` }}.
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
              <span class="fw-bold fs-5 ops-clock">{{ formatTime(showClock) }}</span>
              <input
                type="range"
                class="form-range flex-grow-1 ops-slider"
                aria-label="Time shown"
                :min="dayStart"
                :max="dayEnd"
                step="15"
                :value="showClock"
                @input="onSliderInput"
              />
              <button v-if="isEventDay && !followLive" type="button" class="btn btn-danger text-white btn-sm py-0.5 px-2.5 ops-small fw-bold text-nowrap rounded-pill shadow-xs" @click="resetClock">
                Live
              </button>
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
            <button v-if="!readOnly" type="button" class="btn btn-sm btn-outline-danger fw-semibold" @click="openAddTask()">+ Add task</button>
          </div>

          <!-- My schedule -->
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
                <button v-if="!readOnly" type="button" class="btn btn-link btn-sm p-0 ops-small text-decoration-none text-nowrap flex-shrink-0" @click="openEditTask(me, b)">Edit</button>
              </div>
              <div v-if="!me.blocks.length" class="text-muted small">No tasks yet. Use "+ Add task" to plan {{ me.name }}'s day.</div>
            </div>
          </div>

          <!-- Everyone now -->
          <div v-else-if="activeTab === 'now'">
            <div class="text-muted small mb-2">Where everyone should be at <strong>{{ formatTime(showClock) }}</strong>. Drag the time slider above to change it.</div>
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

          <!-- Full grid -->
          <div v-else>
            <div v-if="!readOnly" class="text-muted ops-small mb-2 d-none d-md-block">Tip: drag across empty space in someone's row to add a task. Drag up or down to include more people.</div>
            <div ref="gridScrollContainer" class="ops-grid-scroll" :class="{ 'ops-dragging': drag }">
              <div class="ops-grid">
                <div class="ops-grid-row ops-grid-head">
                  <div class="ops-grid-name"></div>
                  <div class="ops-grid-track">
                    <span v-for="t in halfHours" :key="t" class="ops-tick" :style="{ left: `${percentAt(t)}%` }">{{ formatTime(t) }}</span>
                  </div>
                </div>

                <div v-for="(p, rowIndex) in crew" :key="p.name" class="ops-grid-row" :class="{ 'ops-grid-me': p.name === activePersona?.name }" :data-ops-row="rowIndex">
                  <div class="ops-grid-name">
                    <div class="fw-semibold small d-flex align-items-center gap-1">
                      <span class="ops-dot" :class="`ops-dot-${checkInStatus(p)}`"></span>
                      <span class="text-truncate ops-name-full">{{ p.name }}</span>
                      <span class="text-truncate ops-name-short">{{ shortName(p.name) }}</span>
                    </div>
                    <div class="text-muted ops-small text-truncate ops-grid-role">{{ p.role }}</div>
                  </div>
                  <div class="ops-grid-track" :class="{ 'ops-drag-target': !readOnly }" @pointerdown="startDrag($event, rowIndex)">
                    <span v-for="t in halfHours" :key="t" class="ops-gridline" :style="{ left: `${percentAt(t)}%` }"></span>
                    <div
                      v-if="inDragSelection(rowIndex)"
                      class="ops-drag-sel"
                      :class="{ 'ops-drag-clash': dragClashes(p) }"
                      :style="blockStyle(dragSelection)"
                    >
                      <span v-if="rowIndex === dragSelection.fromRow">{{ formatTime(dragSelection.start) }}–{{ formatTime(dragSelection.end) }}</span>
                      <span v-if="dragClashes(p)" class="d-block">Clashes</span>
                    </div>
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
          <div class="d-flex justify-content-between align-items-center mb-2">
            <h5 class="fw-bold mb-0">Crew check-in</h5>
            <span class="badge bg-success rounded-pill px-2 py-1" style="font-size: 0.7rem;">
              {{ checkedIn.length }} / {{ crew.length }} Checked In
            </span>
          </div>
          <p v-if="isEventDay" class="text-muted small mb-3">Green cards indicate checked-in ExCos. Missing or late members stay pinned at the top.</p>
          <p v-else-if="eventDay === 'upcoming'" class="text-muted small mb-3">Opens on {{ formatDate(event.date) }}. Each person will be due at their first task.</p>
          <p v-else class="text-muted small mb-3">Check-ins from {{ formatDate(event.date) }}.</p>

          <div class="d-flex flex-column gap-2 mb-3">
            <div
              v-for="p in sortedCrewForCheckIn"
              :key="p.name"
              class="p-3 rounded-3 border transition-all"
              :class="checkInStatus(p) === 'in' ? 'bg-success bg-opacity-10 border-success' : 'bg-light'"
            >
              <div class="d-flex justify-content-between align-items-center">
                <strong class="small" :class="checkInStatus(p) === 'in' ? 'text-success fw-bold' : ''">
                  {{ p.name }}
                </strong>

                <span v-if="checkInStatus(p) === 'in'" class="badge bg-success rounded-pill" style="font-size: 0.65rem;">
                  ✓ Checked In {{ p.checkedInAt ? `@ ${formatTime(p.checkedInAt)}` : '' }}
                </span>
                <span v-else-if="checkInStatus(p) === 'missing'" class="badge bg-danger" style="font-size: 0.65rem;">Missing</span>
                <span v-else-if="checkInStatus(p) === 'late'" class="badge bg-warning text-dark" style="font-size: 0.65rem;">Running late</span>
                <span v-else class="badge bg-light text-muted border" style="font-size: 0.65rem;">
                  {{ callTime(p) === null ? 'No tasks yet' : `Due ${formatTime(callTime(p))}` }}
                </span>
              </div>

              <div class="text-muted ops-small mt-1">{{ p.role }}<template v-if="p.phone"> • {{ p.phone }}</template></div>

              <div v-if="checkInStatus(p) === 'late'" class="text-secondary ops-small fw-semibold d-flex align-items-center gap-2 mt-1">
                {{ p.late }}
                <button type="button" class="btn btn-link p-0 text-muted text-decoration-none lh-1" :aria-label="`Clear late for ${p.name}`" @click="clearLate(p)">✕</button>
              </div>
              <div v-else-if="checkInStatus(p) === 'missing'" class="text-danger ops-small fw-semibold mt-1">
                Was due at {{ formatTime(callTime(p)) }}, not checked in
              </div>

              <template v-if="isEventDay">
              <div v-if="checkInStatus(p) !== 'in' && lateChoiceFor === p.memberId" class="d-flex flex-wrap align-items-center gap-1 mt-2">
                <span class="ops-small text-muted me-1">How late?</span>
                <button v-for="mins in LATE_OPTIONS" :key="mins" type="button" class="btn btn-sm btn-outline-warning text-dark py-0 px-2 ops-small fw-bold" @click="reportLateETA(p, mins)">{{ mins }} min</button>
                <button type="button" class="btn btn-sm btn-light border py-0 px-2 ops-small text-muted rounded-pill" @click="lateChoiceFor = null">Cancel</button>
              </div>
              <div v-else-if="checkInStatus(p) !== 'in'" class="d-flex gap-2 mt-2">
                <button type="button" class="btn btn-sm btn-outline-success flex-grow-1 py-1 ops-small fw-bold" @click="checkInPerformer(p)">Check in</button>
                <button v-if="checkInStatus(p) === 'missing'" type="button" class="btn btn-sm btn-outline-warning text-dark py-1 ops-small fw-bold" @click="lateChoiceFor = p.memberId">Running late</button>
              </div>
              <div v-else class="d-flex justify-content-end mt-2">
                <button type="button" class="btn btn-link btn-sm p-0 text-muted ops-small text-decoration-none" @click="undoCheckIn(p)">
                  Undo check-in
                </button>
              </div>
              </template>
            </div>
          </div>

          <div class="ops-small text-muted text-center border-top pt-2">
            Emergency: Campus Security <strong>+65 6828 0345</strong>
          </div>
        </div>
      </div>
    </div>

    </template>

    <!-- New / edit event -->
    <div v-if="eventEditor" class="modal-backdrop fade show" style="background: rgba(15, 23, 42, 0.6); z-index: 1065;" @click="eventEditor = null"></div>
    <div v-if="eventEditor" class="modal fade show d-block" tabindex="-1" style="z-index: 1070;" role="dialog" aria-modal="true">
      <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable modal-lg">
        <form class="modal-content border-0 shadow-lg rounded-4" @submit.prevent="saveEvent">
          <div class="modal-header border-bottom px-4 py-3">
            <h5 class="modal-title fw-bold mb-0">{{ eventEditor.mode === 'edit' ? 'Edit event' : 'New event' }}</h5>
            <button type="button" class="btn-close" aria-label="Close" @click="eventEditor = null"></button>
          </div>
          <div class="modal-body px-4">
            <div v-if="eventEditorError" class="alert alert-danger py-2 small">{{ eventEditorError }}</div>
            <div class="text-muted ops-small mb-2"><span class="text-danger">*</span> Required</div>

            <div class="mb-3">
              <label for="opsEventName" class="form-label small fw-bold text-muted mb-1">Event name <span class="text-danger" aria-hidden="true">*</span></label>
              <input id="opsEventName" v-model="eventEditor.name" type="text" class="form-control form-control-sm" placeholder="e.g. Year-end concert" aria-required="true" />
            </div>

            <div class="row g-2 mb-3">
              <div class="col-6">
                <label for="opsEventDate" class="form-label small fw-bold text-muted mb-1">Date <span class="text-danger" aria-hidden="true">*</span></label>
                <input id="opsEventDate" v-model="eventEditor.date" type="date" class="form-control form-control-sm" aria-required="true" />
              </div>
              <div class="col-6">
                <label for="opsEventVenue" class="form-label small fw-bold text-muted mb-1">Venue</label>
                <input id="opsEventVenue" v-model="eventEditor.venue" type="text" class="form-control form-control-sm" placeholder="e.g. Main Hall" />
              </div>
            </div>

            <div v-if="dataMode === 'supabase'" class="mb-3">
              <label for="opsEventBooking" class="form-label small fw-bold text-muted mb-1">Facility booking</label>
              <select id="opsEventBooking" v-model="eventEditor.facilityBookingId" class="form-select form-select-sm" :disabled="!eventEditor.date" @change="pickBooking">
                <option :value="null">{{ !eventEditor.date ? 'Pick a date first' : bookingOptions.length ? 'Not linked' : 'No bookings for your CCA on this date' }}</option>
                <option v-for="b in bookingOptions" :key="b.id" :value="b.id">{{ b.facility }} · {{ b.start }}–{{ b.end }} ({{ b.status }})</option>
              </select>
              <div class="text-muted ops-small mt-1">{{ bookingOptionsNote || 'From the Master Facility Calendar. Lets Event Risk test "what if this room is unavailable".' }}</div>
            </div>

            <div class="row g-2 mb-1">
              <div class="col-6">
                <label for="opsEventStart" class="form-label small fw-bold text-muted mb-1">Starts <span class="text-danger" aria-hidden="true">*</span></label>
                <input id="opsEventStart" v-model="eventEditor.start" type="time" step="900" class="form-control form-control-sm" aria-required="true" />
              </div>
              <div class="col-6">
                <label for="opsEventEnd" class="form-label small fw-bold text-muted mb-1">Ends <span class="text-danger" aria-hidden="true">*</span></label>
                <input id="opsEventEnd" v-model="eventEditor.end" type="time" step="900" class="form-control form-control-sm" aria-required="true" />
              </div>
            </div>
            <div class="text-muted ops-small mb-3">From reporting time to teardown, e.g. 3:00 PM – 11:00 PM</div>

            <div v-if="eventEditor.mode === 'add'" class="p-2 ps-3 rounded-3 mb-3 ops-fixed-box">
              <div class="d-flex justify-content-between align-items-center mb-1">
                <span class="small fw-bold">Fixed time <span class="fw-normal text-muted">(optional)</span></span>
                <span class="badge rounded-pill bg-dark ops-small">🔒 Never moves</span>
              </div>
              <div class="row g-2">
                <div class="col-12">
                  <input v-model="eventEditor.mainTitle" type="text" class="form-control form-control-sm" aria-label="Fixed block name" placeholder="Performance" />
                </div>
                <div class="col-6">
                  <label for="opsFixedStart" class="form-label ops-small fw-bold text-muted mb-1">Start</label>
                  <input id="opsFixedStart" v-model="eventEditor.mainStart" type="time" step="900" class="form-control form-control-sm" aria-label="Fixed start" />
                </div>
                <div class="col-6">
                  <label for="opsFixedEnd" class="form-label ops-small fw-bold text-muted mb-1">End</label>
                  <input id="opsFixedEnd" v-model="eventEditor.mainEnd" type="time" step="900" class="form-control form-control-sm" aria-label="Fixed end" />
                </div>
              </div>
              <div class="text-muted ops-small mt-1">e.g. the show, 8:00 PM – 10:00 PM</div>
            </div>

            <div class="d-flex justify-content-between align-items-center mb-1">
              <span class="small fw-bold text-muted">Which ExCos are on the crew? <span class="text-danger" aria-hidden="true">*</span></span>
              <button v-if="eventEditor.crewIds.length < excoPool.length" type="button" class="btn btn-link btn-sm p-0 ops-small text-decoration-none" @click="eventEditor.crewIds = excoPool.map(e => e.memberId)">Select all</button>
              <button v-else type="button" class="btn btn-link btn-sm p-0 ops-small text-decoration-none" @click="eventEditor.crewIds = []">Clear</button>
            </div>
            <div class="ops-crew-grid mb-2">
              <label v-for="exco in excoPool" :key="exco.memberId" class="ops-crew-option" :class="{ active: eventEditor.crewIds.includes(exco.memberId) }" :title="exco.role">
                <input v-model="eventEditor.crewIds" type="checkbox" class="visually-hidden" :value="exco.memberId" />
                <span class="ops-avatar">{{ initials(exco.name) }}</span>
                <span class="text-truncate">
                  <span class="d-block small fw-semibold text-truncate">{{ exco.name }}</span>
                  <span class="d-block ops-small text-muted text-truncate ops-crew-role">{{ exco.role }}</span>
                </span>
                <span v-if="eventEditor.crewIds.includes(exco.memberId)" class="ms-auto ops-check" aria-hidden="true">✓</span>
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
      <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
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

  </div>
</template>

<style scoped>
.ops-event-heading { min-width: 0; max-width: 100%; }
#opsEvent { min-width: 0; max-width: 100%; }
.ops-label { font-size: 0.65rem; letter-spacing: 0.04em; }
.ops-small { font-size: 0.72rem; }
.ops-clock { font-variant-numeric: tabular-nums; white-space: nowrap; flex-shrink: 0; }
.ops-slider { min-width: 90px; }

.ops-static-card:hover { transform: none; }

.ops-tabs .nav-link { font-size: 0.8rem; font-weight: 600; padding: 0.35rem 0.8rem; color: var(--pulse-ink, #334155); }
.ops-tabs .nav-link.active { background-color: #dc3545; color: #fff; }

.ops-more-menu {
  position: absolute;
  left: 0;
  top: calc(100% + 4px);
  z-index: 1050;
  min-width: 220px;
  max-width: calc(100vw - 2rem);
  background: #fff;
}

.ops-block-setup { background-color: #f4d4d8; }
.ops-block-move { background-color: #e3dcf2; }
.ops-block-perform { background-color: #fbefc4; }
.ops-block-meal { background-color: #d6ead9; }
.ops-block-other { background-color: #d5e3f5; }
.ops-done { opacity: 0.45; }

.ops-swatch { width: 12px; height: 12px; border-radius: 3px; display: inline-block; border: 1px solid rgba(0, 0, 0, 0.08); }
.ops-swatch-now { background-color: #dc3545; width: 3px; border: 0; }

.ops-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; background-color: #cbd5e1; }
.ops-dot-in { background-color: #16a34a; }
.ops-dot-late { background-color: #f59e0b; }
.ops-dot-missing { background-color: #dc3545; }

.ops-fixed { box-shadow: inset 3px 0 0 #1f2937; }
.ops-swatch-fixed { background-color: #fbefc4; box-shadow: inset 3px 0 0 #1f2937; }
.ops-editable { cursor: pointer; }
.ops-editable:hover { filter: brightness(0.96); }

.ops-person-pill {
  border: 1px solid #d1d5db;
  border-radius: 9999px;
  padding: 0.25rem 0.75rem;
  cursor: pointer;
  user-select: none;
}
.ops-person-pill.active { background-color: #dc3545; border-color: #dc3545; color: #fff; }

.ops-fixed-box { background-color: #fdf6dc; border: 1px solid #f3e3a3; box-shadow: inset 3px 0 0 #1f2937; }

.ops-crew-option {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.45rem 0.6rem;
  border: 1px solid #e5e7eb;
  border-radius: 0.75rem;
  cursor: pointer;
  user-select: none;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}
.ops-crew-option:hover { border-color: #f1aeb5; }
.ops-crew-option.active { border-color: #dc3545; background-color: #fdf2f3; }
.ops-crew-option:has(input:focus-visible) { outline: 2px solid #dc3545; outline-offset: 2px; }
.ops-avatar {
  width: 2rem;
  height: 2rem;
  flex-shrink: 0;
  border-radius: 9999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  font-weight: 800;
  background-color: #f1f5f9;
  color: #475569;
}
.ops-crew-option.active .ops-avatar { background: linear-gradient(135deg, #dc3545, #b02a37); color: #fff; }
.ops-check { color: #dc3545; font-weight: 800; }
.ops-crew-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.5rem; }
@media (min-width: 992px) {
  .ops-crew-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

@media (max-width: 576px) {
  .ops-crew-grid { display: flex; flex-wrap: wrap; }
  .ops-crew-option { padding: 0.25rem 0.75rem; border-radius: 9999px; border-color: #d1d5db; }
  .ops-crew-option .ops-avatar,
  .ops-crew-option .ops-crew-role,
  .ops-crew-option .ops-check { display: none !important; }
  .ops-crew-option.active { background-color: #dc3545; border-color: #dc3545; color: #fff; }
}

.ops-list-time { width: 3.2rem; flex-shrink: 0; font-variant-numeric: tabular-nums; }
.ops-current { outline: 2px solid #dc3545; }

.ops-now-name { width: 9.5rem; flex-shrink: 0; }
.ops-chip { display: inline-block; padding: 0.2rem 0.55rem; border-radius: 0.5rem; font-weight: 600; }

.ops-grid-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; max-width: 100%; scroll-behavior: smooth; }
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
.ops-person-select { min-width: 0; max-width: 100%; text-overflow: ellipsis; }

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

@media (pointer: fine) {
  .ops-drag-target { cursor: crosshair; }
  .ops-grid { user-select: none; }
}
.ops-dragging { user-select: none; }
.ops-dragging .ops-block { pointer-events: none; }
.ops-drag-sel {
  position: absolute;
  top: 5px;
  bottom: 5px;
  z-index: 2;
  padding: 2px 6px;
  border: 2px dashed #dc3545;
  border-radius: 0.5rem;
  background: rgba(220, 53, 69, 0.08);
  font-size: 0.68rem;
  font-weight: 700;
  color: #b02a37;
  pointer-events: none;
  overflow: hidden;
  white-space: nowrap;
}
.ops-drag-clash { border-style: solid; background: rgba(220, 53, 69, 0.22); }

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
.ops-now-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 3px;
  background-color: #dc3545;
  z-index: 2;
  box-shadow: 0 0 6px rgba(220, 53, 69, 0.5);
}
</style>