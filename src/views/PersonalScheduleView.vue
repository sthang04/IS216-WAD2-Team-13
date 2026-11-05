<script setup>
import { ref, computed, watch, nextTick, onMounted } from 'vue';
import { getOpsTasksForMember, fetchMyOpsTasks, isMissingTableError } from '../services/opsService';
import { useRoute } from 'vue-router';
import SimulatorInvitationInbox from '../components/SimulatorInvitationInbox.vue';
import { getWalkTime } from '../services/onemap';
import { supabase } from '../supabase';
import { demoMemberId, session } from '../services/sessionState';

const props = defineProps({
  active: { type: Boolean, default: true },
  apiMode: { type: Boolean, default: false },
  readOnly: { type: Boolean, default: false },
  activePersona: {
    type: Object,
    default: () => ({
      name: 'Rachel Tan',
      cca: 'Eurhythmix',
      roleLabel: 'Eurhythmix ExCo',
      email: 'rachel.tan.2024@scis.smu.edu.sg'
    })
  }
});

// Simulator linked code
// App.vue keeps panes mounted with v-show. Scroll only after this member page
// becomes visible, including a deep link opened before session restoration.
const route=useRoute()
watch([()=>route.hash,()=>props.active],async([hash,active])=>{
 if(active && !props.readOnly && hash==='#simulator-invitation-inbox'){
  await nextTick()
  const inbox=document.getElementById('simulator-invitation-inbox')
  if(inbox)inbox.style.scrollMarginTop=((document.querySelector('header')?.getBoundingClientRect().height || 0)+16)+'px'
  inbox?.scrollIntoView({block:'start'})
  inbox?.focus({preventScroll:true})
 }
},{immediate:true,flush:'post'})
const isCheckedIn = ref(false);
const isLocating = ref(false);
const checkInMsg = ref('');
const toastMsg = ref('');

// Guests can look around but not make changes
function blockedForGuest() {
  if (!props.readOnly) return false
  toastMsg.value = 'Guest view is read-only. Sign in as a CCA ExCo to make changes.'
  return true
}

const selectedCategory = ref('All'); // 'All', 'CCA', 'Academic', 'Adhoc'
const showModal = ref(false);
const isEditing = ref(false);
const editingId = ref(null);
const formError = ref('');

// ---- Day being viewed (switch to a future day to prefill it in advance) ----
const selectedDate = ref('2026-10-23');

function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
function toISO(dt) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}
function shiftDay(n) {
  if (!selectedDate.value) return
  const dt = parseISO(selectedDate.value)
  dt.setDate(dt.getDate() + n)
  selectedDate.value = toISO(dt)
}
const selectedDateLabel = computed(() => {
  if (!selectedDate.value) return 'Pick a date'
  return parseISO(selectedDate.value).toLocaleDateString('en-SG', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  })
})

// 'Adhoc' is stored in the data, 'Ad hoc' is what people see
function categoryLabel(cat) {
  if (cat === 'Adhoc') return 'Ad hoc';
  if (cat === 'Day-of Ops') return 'Day-of Ops';
  return cat;
}

// Official SMU Buildings for OneMap API Geocoding
const SMU_BUILDINGS = [
  'SMU School of Computing and Information Systems 1',
  'SMU Li Ka Shing Library',
  'SMU Connexion',
  'SMU School of Economics & School of Social Sciences',
  'SMU Yong Pung How School of Law',
  'SMU Lee Kong Chian School of Business',
  'SMU Administration Building'
];

// Initial Schedule Events with structured building names & room details
const defaultEvents = [
  {
    id: 1,
    title: 'IS216 Web Application Development II (G1)',
    category: 'Academic',
    date: '2026-10-23',
    startTime: '15:30',
    endTime: '17:00',
    // Exact official OneMap building search string
    building: 'SMU SCHOOL OF COMPUTING AND INFORMATION SYSTEMS 1',
    room: 'Seminar Room 2.1',
    venue: 'Seminar Room 2.1, SCIS1',
    role: 'Undergraduate Student',
    status: 'Completed',
    notes: 'Sprint presentation dry-run and Vue component architecture lab.',
    isCustom: false
  },
  {
    id: 2,
    title: 'Act 2 Floor Positioning & Soundcheck',
    category: 'CCA',
    date: '2026-10-23',
    startTime: '18:30',
    endTime: '19:15',
    building: 'LI KA SHING LIBRARY',
    room: 'Main Hall Stage B1',
    venue: 'Main Hall Stage B1, Li Ka Shing Library',
    role: 'Floor Positioning Lead',
    status: 'In Progress',
    notes: 'Verify wireless stage monitor feeds and tape marks for hip-hop ensemble.',
    isCustom: false
  },
  {
    id: 3,
    title: 'Act 2 Audio & Lighting Programming',
    category: 'Adhoc',
    date: '2026-10-23',
    startTime: '19:30',
    endTime: '20:10',
    building: 'LI KA SHING LIBRARY',
    room: 'Audio & Lighting Booth B1',
    venue: 'Audio & Lighting Booth B1, Li Ka Shing Library',
    role: 'Stage Crew Coordinator',
    status: 'Not Started',
    notes: 'Coordinate cue triggers with SoundFoundry live band technicians.',
    isCustom: false
  },
  {
    id: 4,
    title: 'Opening Night Live Production (Curtain Call)',
    category: 'CCA',
    date: '2026-10-23',
    startTime: '20:15',
    endTime: '21:45',
    building: 'LI KA SHING LIBRARY',
    room: 'Main Hall Stage B1',
    venue: 'Main Hall Stage B1, Li Ka Shing Library',
    role: 'Full Cast Floor Runner',
    status: 'Not Started',
    notes: 'All cast members to standby at wings by 20:00.',
    isCustom: false
  },
  {
    id: 5,
    title: 'Eurhythmix ExCo Debrief & Safety Check',
    category: 'Adhoc',
    date: '2026-10-23',
    startTime: '22:00',
    endTime: '22:30',
    building: 'SMU CONNEXION',
    room: 'Studio L7.2 (Dance)',
    venue: 'Studio L7.2 (Dance), Connexion',
    role: 'Honorary General Secretary',
    status: 'Not Started',
    notes: 'Verify studio equipment inventory and lock up keys per SSU Clause 9.2(c).',
    isCustom: false
  }
];

// ---- Saving: events are stored in this browser (localStorage) so they survive a page refresh ----
const storageKey = computed(() => `pulse-schedule-${props.activePersona.email || props.activePersona.name}`)

function loadSavedEvents() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey.value))
    if (Array.isArray(saved)) return saved
  } catch (e) { /* ignore corrupted or blocked storage */ }
  return null
}

function sampleEvents() {
  const events = JSON.parse(JSON.stringify(defaultEvents))
  const clubName = props.activePersona?.cca || 'CCA'
  if (events[4]) {
    events[4].title = `${clubName} ExCo Debrief & Safety Check`
    events[4].role = `${clubName} ExCo`
  }
  return events
}

// Start from the saved schedule if there is one, otherwise the sample data
const scheduleEvents = ref(loadSavedEvents() ?? sampleEvents())

// Save whenever anything changes (add, edit, delete, status toggle)
watch(scheduleEvents, (events) => {
  try { localStorage.setItem(storageKey.value, JSON.stringify(events)) } catch (e) { /* storage full or blocked */ }
}, { deep: true })

// If the logged-in persona changes, load that persona's own saved schedule and resync ops
watch(storageKey, () => {
  scheduleEvents.value = loadSavedEvents() ?? sampleEvents();
  syncOpsTasks(false);
});

// ---- Live Cross-Sync with Day-of Operations ----
const opsSyncInfo = ref(null);

let opsSyncVersion = 0;

// Signed in: the events saved in Operations. Otherwise: this browser's copy, or the sample.
async function readOpsTasks() {
  const { authUserId, activeClubId, memberId } = session.value;
  if (supabase && authUserId && activeClubId && !props.readOnly) {
    try {
      return await fetchMyOpsTasks(activeClubId, memberId);
    } catch (error) {
      if (!isMissingTableError(error)) throw error;
    }
  }
  return getOpsTasksForMember(props.activePersona?.name || 'Rachel Tan', props.activePersona?.cca || 'Eurhythmix');
}

async function syncOpsTasks(forceToast = false) {
  const version = ++opsSyncVersion;
  let result;
  try {
    result = await readOpsTasks();
  } catch (error) {
    // Keep what is on screen rather than showing tasks that may be wrong
    console.log('Day-of Ops tasks not loaded:', error.message);
    return;
  }
  if (version !== opsSyncVersion) return;
  const { tasks, eventName, eventDate, tasksCount, eventsCount = 1 } = result;

  // Saved schedules can hold tasks from events that have since changed, so always replace them
  const customAndAcademic = scheduleEvents.value.filter(e => !e.isOpsTask && !String(e.id).startsWith('ops-'));
  scheduleEvents.value = [...customAndAcademic, ...tasks];

  if (tasksCount > 0) {
    opsSyncInfo.value = { eventName, eventDate, eventCount: tasksCount, otherEvents: eventsCount - 1 };

    // Jump to the ops event date if viewing default placeholder date
    if (selectedDate.value === '2026-10-23' && eventDate) {
      selectedDate.value = eventDate;
    }

    if (forceToast) {
      toastMsg.value = `⚡ Synced ${tasksCount} Day-of Ops tasks from "${eventName}".`;
      setTimeout(() => { toastMsg.value = ''; }, 4000);
    }
  } else {
    opsSyncInfo.value = null;
  }
}

onMounted(() => {
  syncOpsTasks(false);
});

// The session may finish loading after this page, or switch to another CCA
watch(() => [session.value.ready, session.value.authUserId, session.value.activeClubId, session.value.memberId], () => {
  syncOpsTasks(false);
});



// All events, in order of date then start time
const sortedEvents = computed(() =>
  [...scheduleEvents.value].sort((a, b) =>
    (a.date + a.startTime).localeCompare(b.date + b.startTime))
)

// Only the events on the day being viewed
const dayEvents = computed(() =>
  sortedEvents.value.filter(e => e.date === selectedDate.value)
)

// ---- OneMap walking time calculation using official building names ----
function minutesBetween(end, start) {
  const toMin = t => parseInt(t.slice(0, 2)) * 60 + parseInt(t.slice(3))
  return toMin(start) - toMin(end)
}

const walkInfo = ref({})            // eventId -> { minutes, metres, gapMinutes, prevVenue, sameVenue?, unavailable? }
const isLoadingWalk = ref(false)
let loadCounter = 0

async function loadWalkTimes() {
  const thisLoad = ++loadCounter
  isLoadingWalk.value = true
  const list = sortedEvents.value

  const entries = await Promise.all(list.slice(1).map(async (cur, i) => {
    const prev = list[i]
    if (prev.date !== cur.date) return null
    const gapMinutes = minutesBetween(prev.endTime, cur.startTime)

    // Use .building for OneMap resolution, fall back to .venue
    const prevBuilding = prev.building || prev.venue
    const curBuilding = cur.building || cur.venue

    const base = { gapMinutes, prevVenue: prev.venue }

    // If both events are in the same building, no walking needed
    if (prevBuilding === curBuilding) {
      return [cur.id, { ...base, sameVenue: true, minutes: 0, metres: 0 }]
    }

    const walk = await getWalkTime(prevBuilding, curBuilding)
    if (!walk) return [cur.id, { ...base, unavailable: true }]
    if (walk.metres === 0) return [cur.id, { ...base, sameVenue: true, minutes: 0, metres: 0 }]
    return [cur.id, { ...base, ...walk }]
  }))

  if (thisLoad !== loadCounter) return
  walkInfo.value = Object.fromEntries(entries.filter(Boolean))
  isLoadingWalk.value = false
}

const routeKey = computed(() =>
  sortedEvents.value.map(e => `${e.id}|${e.date}|${e.startTime}|${e.endTime}|${e.building || e.venue}`).join(';')
)
watch(routeKey, loadWalkTimes, { immediate: true })

function transitText(event) {
  const i = walkInfo.value[event.id]
  if (!i) return ''
  if (i.sameVenue) return 'Same building as your previous event, no walking needed'
  if (i.unavailable) return `Walk time unavailable from ${i.prevVenue}`
  return `~${i.minutes} min walk (${i.metres}m) from ${i.prevVenue}`
}

function transitTight(event) {
  const i = walkInfo.value[event.id]
  return !!i && !i.sameVenue && !i.unavailable && i.minutes > i.gapMinutes
}

// Modal Form State
const eventForm = ref({
  title: '',
  category: 'CCA',
  date: selectedDate.value,
  startTime: '17:15',
  endTime: '18:15',
  building: 'SMU Connexion',
  room: 'Studio L7.2 (Dance)',
  role: 'Participant',
  notes: ''
});

// Events shown in the list: the viewed day, filtered by category
const filteredEvents = computed(() => {
  if (selectedCategory.value === 'All') return dayEvents.value;
  return dayEvents.value.filter(e => e.category === selectedCategory.value);
});

// Conflict Detection: academic classes that overlap with CCA slots on the same day
const conflictingEventIds = computed(() => {
  const conflicts = new Set();
  const academics = scheduleEvents.value.filter(e => e.category === 'Academic');
  const ccas = scheduleEvents.value.filter(e => e.category === 'CCA' || e.category === 'Day-of Ops');

  for (const acad of academics) {
    for (const cca of ccas) {
      if (acad.date === cca.date) {
        if (
          (cca.startTime >= acad.startTime && cca.startTime < acad.endTime) ||
          (cca.endTime > acad.startTime && cca.endTime <= acad.endTime) ||
          (cca.startTime <= acad.startTime && cca.endTime >= acad.endTime)
        ) {
          conflicts.add(acad.id);
          conflicts.add(cca.id);
        }
      }
    }
  }
  return conflicts;
});

// Only show the clash banner if the viewed day has a clash
const dayHasConflict = computed(() =>
  dayEvents.value.some(e => conflictingEventIds.value.has(e.id))
)

// Active assignment highlight (for the viewed day)
const activeAssignment = computed(() => {
  return dayEvents.value.find(e => e.status === 'In Progress')
    || dayEvents.value.find(e => e.status === 'Not Started')
    || dayEvents.value[0];
});

function toggleEventStatus(event) {
  if (blockedForGuest()) return
  if (event.status === 'Not Started') {
    event.status = 'In Progress';
    toastMsg.value = `Started: "${event.title}" is now active.`;
  } else if (event.status === 'In Progress') {
    event.status = 'Completed';
    toastMsg.value = `Completed: "${event.title}" marked as finished.`;
  } else {
    event.status = 'Not Started';
    toastMsg.value = `Status reset for "${event.title}".`;
  }
  setTimeout(() => { toastMsg.value = ''; }, 3500);
}
// Asks Supabase to queue a Telegram alert about a schedule change.
// action is 'added', 'updated' or 'removed'. The bot token stays on the server;
// the Edge Function send-telegram-notifications does the actual sending.
// It never throws: if the alert can't be sent, the schedule change still works.
async function sendScheduleAlert(action, ev) {
  if (props.readOnly || !supabase) return;
  try {
    const { error } = await supabase.rpc('rpc_notify_schedule_change', {
      p_action: action,
      p_title: ev.title,
      p_date: ev.date,
      p_start_time: ev.startTime,
      p_end_time: ev.endTime,
      p_venue: ev.venue,
      p_demo_member_id: demoMemberId()
    });
    if (error) throw error;
  } catch (err) {
    console.log('Telegram schedule alert not queued:', err.message);
    toastMsg.value += ' Telegram alert could not be queued: ' + err.message;
  }
}

// Modal Form Actions
function openAddModal() {
  if (blockedForGuest()) return;
  isEditing.value = false;
  editingId.value = null;
  formError.value = ''; // Reset error
  eventForm.value = {
    title: '',
    category: 'CCA',
    date: selectedDate.value,
    startTime: '17:15',
    endTime: '18:15',
    building: 'SMU Connexion',
    room: 'Studio L7.2 (Dance)',
    role: `${props.activePersona.cca || 'Eurhythmix'} Member`,
    notes: ''
  };
  showModal.value = true;
}

function openEditModal(event) {
  if (blockedForGuest()) return;
  isEditing.value = true;
  editingId.value = event.id;
  formError.value = ''; // Reset error
  eventForm.value = {
    title: event.title,
    category: event.category,
    date: event.date,
    startTime: event.startTime,
    endTime: event.endTime,
    building: event.building || 'SMU Connexion',
    room: event.room || event.venue,
    role: event.role,
    notes: event.notes || ''
  };
  showModal.value = true;
}

function closeModal() {
  formError.value = '';
  showModal.value = false;
}

function saveEvent() {
  if (blockedForGuest() || !eventForm.value.title.trim()) return;

  // Validate start and end times
  if (eventForm.value.endTime <= eventForm.value.startTime) {
    formError.value = 'End time must be after start time.';
    return;
  }

  formError.value = '';

  const combinedVenue = eventForm.value.room.trim()
    ? `${eventForm.value.room}, ${eventForm.value.building.replace('SMU ', '')}`
    : eventForm.value.building;

  if (isEditing.value && editingId.value) {
    const idx = scheduleEvents.value.findIndex(e => e.id === editingId.value);
    if (idx !== -1) {
      Object.assign(scheduleEvents.value[idx], {
        ...eventForm.value,
        building: eventForm.value.building,
        venue: combinedVenue
      });
      toastMsg.value = `Updated: "${eventForm.value.title}" successfully modified.`;
      sendScheduleAlert('updated', scheduleEvents.value[idx]);
    }
  } else {
    const newEvent = {
      id: Date.now(),
      ...eventForm.value,
      building: eventForm.value.building,
      venue: combinedVenue,
      status: 'Not Started',
      isCustom: true
    };
    scheduleEvents.value.push(newEvent);
    toastMsg.value = `Added: "${eventForm.value.title}" scheduled on your calendar.`;
    sendScheduleAlert('added', newEvent);
  }

  // If the event was saved on a different day, jump to that day so you can see it
  if (eventForm.value.date && eventForm.value.date !== selectedDate.value) {
    selectedDate.value = eventForm.value.date;
  }

  closeModal();
  setTimeout(() => { toastMsg.value = ''; }, 4000);
}

  // If the event was saved on a different day, jump to that day so you can see it
  if (eventForm.value.date && eventForm.value.date !== selectedDate.value) {
    selectedDate.value = eventForm.value.date;
  }

  closeModal();
  setTimeout(() => { toastMsg.value = ''; }, 4000);


function deleteEvent(id) {
  if (blockedForGuest()) return
  const item = scheduleEvents.value.find(e => e.id === id);
  if (!item) return;
  scheduleEvents.value = scheduleEvents.value.filter(e => e.id !== id);
  toastMsg.value = `"${item.title}" was removed from your schedule.`;
  sendScheduleAlert('removed', item);
  setTimeout(() => { toastMsg.value = ''; }, 4000);
}

// Escape commas, semicolons and new lines so they don't break the .ics file
function icsEscape(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// Singapore time -> UTC, e.g. '2026-10-23' + '18:30' -> '20261023T103000Z'
function toIcsUtc(date, time) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d, hh - 8, mm));
  return utc.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function exportCalendarICS() {
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SMU Pulse//Personal Schedule//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH'
  ];

  for (const ev of scheduleEvents.value) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:pulse-sched-${ev.id}@smu.edu.sg`);
    lines.push(`DTSTAMP:${now}`);
    lines.push(`DTSTART:${toIcsUtc(ev.date, ev.startTime)}`);
    lines.push(`DTEND:${toIcsUtc(ev.date, ev.endTime)}`);
    lines.push(`SUMMARY:${icsEscape(ev.title)}`);
    lines.push(`LOCATION:${icsEscape(ev.venue)}`);
    lines.push(`DESCRIPTION:${icsEscape(`Role: ${ev.role} | Category: ${categoryLabel ? categoryLabel(ev.category) : ev.category} | Notes: ${ev.notes || 'None'}`)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');

  // Calendar files must use Windows-style line endings (\r\n)
  const blob = new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${props.activePersona.name.replace(/\s+/g, '_')}_SMU_Schedule.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  toastMsg.value = `Exported ${scheduleEvents.value.length} events. Open the file for Apple Calendar, or import it in Google Calendar (Settings > Import & export).`;
  setTimeout(() => { toastMsg.value = ''; }, 6000);
}
</script>

<template>
  <div class="py-2">
    <SimulatorInvitationInbox v-if="!readOnly" />
    

    <!-- Top Header & Actions -->
    <div class="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-4">
      <div>
        <div class="d-flex align-items-center gap-2 mb-1">
          <span class="badge bg-danger rounded-pill px-2 py-1" style="font-size: 0.65rem; font-weight: 800;">
            PERSONAL SCHEDULE
          </span>
          <span v-if="apiMode" class="pulse-api-tag">OneMap Transit Guide</span>
          <span v-if="apiMode" class="pulse-api-tag">iCal OASIS Sync</span>
        </div>
        <h3 class="fw-bold mb-1">Hi {{ (activePersona.name || '').split(' ')[0] }}, here are your schedule and assignments for today.</h3>
        <p class="text-muted small mb-0">
          {{ activePersona.cca }} • Academic Timetable & Rehearsal Schedule • {{ selectedDateLabel }}
        </p>
      </div>

      <div class="d-flex flex-wrap gap-2">
        <button
          type="button"
          class="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1"
          @click="exportCalendarICS"
          title="Download .ics file compatible with OASIS, Apple Calendar, and Google Calendar"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          <span>Export calendar (.ics)</span>
        </button>

        <button
          type="button"
          class="btn btn-sm btn-danger fw-bold d-flex align-items-center gap-1"
          @click="openAddModal"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          <span>Add Event / Class</span>
        </button>
      </div>
    </div>

    <!-- Alert / Toast Banner -->
    <div
      v-if="toastMsg"
      class="alert alert-success border-0 shadow-sm mb-4 d-flex align-items-center justify-content-between"
      role="alert"
      style="border-radius: 0.75rem; background-color: #ecfdf5; color: #065f46;"
    >
      <div class="d-flex align-items-center gap-2">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <span class="small fw-semibold">{{ toastMsg }}</span>
      </div>
      <button type="button" class="btn-close" aria-label="Close message" @click="toastMsg = ''"></button>
      </div>

    <!-- Day Navigation: switch days to view or prefill them in advance -->
    <div class="card border-0 shadow-sm p-2 mb-4" style="border-radius: 0.75rem; background-color: var(--pulse-card-bg);">
      <div class="d-flex flex-wrap justify-content-between align-items-center gap-2">
        <div class="d-flex align-items-center gap-2">
          <button type="button" class="btn btn-sm btn-outline-secondary px-2 py-0" aria-label="Previous day" @click="shiftDay(-1)">‹</button>
          <div class="fw-bold small text-center" style="min-width: 140px;">{{ selectedDateLabel }}</div>
          <button type="button" class="btn btn-sm btn-outline-secondary px-2 py-0" aria-label="Next day" @click="shiftDay(1)">›</button>
        </div>
        <div class="d-flex align-items-center gap-2">
          <span class="text-muted d-none d-md-inline" style="font-size: 0.7rem;">
            Switch to a future day, then use Add Event to prefill it.
          </span>
          <input v-model="selectedDate" aria-label="Schedule date" type="date" class="form-control form-control-sm" style="width: auto;" />
        </div>
      </div>
    </div>

    <div class="row g-4">

      <!-- Left: Active Assignment Card -->
      <div class="col-lg-5">

        <div v-if="activeAssignment" class="pulse-hero-banner p-4 text-white shadow-lg mb-4">

          <div class="d-flex justify-content-between align-items-center mb-3">
            <span class="badge bg-danger rounded-pill px-3 py-1 fw-bold" style="font-size: 0.7rem;">
              {{ activeAssignment.status === 'In Progress' ? 'ACTIVE NOW' : 'PRIORITY ASSIGNMENT' }}
            </span>
            <span class="badge bg-white bg-opacity-25 text-white" style="font-size: 0.75rem;">
              {{ activeAssignment.status }}
            </span>
          </div>

          <h4 class="fw-bold mb-2">{{ activeAssignment.title }}</h4>

          <div class="d-flex flex-column gap-2 text-white-50 small mb-4">
            <div class="d-flex align-items-center gap-2 text-white">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
              <strong>{{ activeAssignment.startTime }} – {{ activeAssignment.endTime }}</strong>
            </div>
            <div class="d-flex align-items-center gap-2 text-white">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                <circle cx="12" cy="10" r="3"></circle>
              </svg>
              <span>{{ activeAssignment.venue }}</span>
            </div>
            <div class="d-flex align-items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
              </svg>
              <span>Role: {{ activeAssignment.role }}</span>
            </div>
          </div>

          <!-- OneMap Transit Buffer -->
          <div class="p-3 rounded-3 mb-4 bg-white bg-opacity-10 border border-white border-opacity-10">
            <div class="d-flex align-items-center gap-2 mb-1 fw-bold text-white small">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"></polygon>
                <line x1="8" y1="2" x2="8" y2="18"></line>
                <line x1="16" y1="6" x2="16" y2="22"></line>
              </svg>
              <span>OneMap Campus Transit Guide</span>
              <span v-if="apiMode" class="badge bg-white text-dark small" style="font-size: 0.6rem;">OneMap API</span>
            </div>
            <div class="text-white-50 small">
              Walking time:
              <span class="text-white fw-bold">
                <template v-if="transitText(activeAssignment)">{{ transitText(activeAssignment) }}</template>
                <template v-else-if="isLoadingWalk">Calculating…</template>
                <template v-else>No earlier event today to walk from</template>
              </span>
              <span v-if="transitTight(activeAssignment)" class="badge bg-warning text-dark ms-1">⚠ Tight</span>
            </div>
          </div>

          <!-- Action: Status Toggle -->
          <div class="d-flex flex-wrap gap-2 mb-2">
            <button
              type="button"
              class="btn btn-outline-light py-2 px-3 fw-bold w-100"
              @click="toggleEventStatus(activeAssignment)"
            >
              <span v-if="activeAssignment.status === 'Not Started'">Start Task</span>
              <span v-else-if="activeAssignment.status === 'In Progress'">Mark Done ✓</span>
              <span v-else>Reset Status</span>
            </button>
          </div>

        </div>

        <!-- Shown when the viewed day has no events yet -->
        <div v-else class="pulse-card p-4 shadow-sm mb-4 text-center">
          <h6 class="fw-bold mb-1">Nothing scheduled yet</h6>
          <p class="text-muted small mb-3">
            There are no events on {{ selectedDateLabel }}. Add some now to prefill the day.
          </p>
          <button type="button" class="btn btn-sm btn-danger fw-bold" @click="openAddModal">
            Add Event / Class
          </button>
        </div>

        <!-- Academic & Rehearsal Clash Detector (only if the viewed day has a clash) -->
        <div v-if="dayHasConflict" class="card border-0 shadow-sm p-3 mb-4" style="background-color: #fffbeb; border-left: 4px solid #f59e0b !important; border-radius: 0.75rem;">
          <div class="d-flex align-items-start gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2" class="flex-shrink-0 mt-1">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
              <line x1="12" y1="9" x2="12" y2="13"></line>
              <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
            <div>
              <div class="fw-bold text-dark small">Academic Timetable Conflict Detected</div>
              <p class="text-muted small mb-0" style="font-size: 0.725rem; line-height: 1.4;">
                An academic lecture overlaps with an allocated CCA rehearsal slot. Pulse has flagged this to the ExCo for an excused late arrival buffer.
              </p>
            </div>
          </div>
        </div>

      </div>

      <!-- Right: Interactive Personal Schedule Manager -->
      <div class="col-lg-7">

        <!-- Filter Tabs & Stats -->
        <div class="card border-0 shadow-sm p-2 mb-3" style="border-radius: 0.75rem; background-color: var(--pulse-card-bg);">
          <div class="d-flex flex-wrap justify-content-between align-items-center gap-2">

            <div class="d-flex flex-wrap gap-1">
              <button
                type="button"
                class="btn btn-sm py-1 px-3 rounded-pill"
                :class="selectedCategory === 'All' ? 'btn-danger text-white fw-bold' : 'btn-light text-muted'"
                @click="selectedCategory = 'All'"
              >
                All Events ({{ dayEvents.length }})
              </button>
              <button
                type="button"
                class="btn btn-sm py-1 px-3 rounded-pill"
                :class="selectedCategory === 'CCA' ? 'btn-danger text-white fw-bold' : 'btn-light text-muted'"
                @click="selectedCategory = 'CCA'"
              >
                CCA
              </button>
              <button
                type="button"
                class="btn btn-sm py-1 px-3 rounded-pill"
                :class="selectedCategory === 'Academic' ? 'btn-danger text-white fw-bold' : 'btn-light text-muted'"
                @click="selectedCategory = 'Academic'"
              >
                Academic
              </button>
              <button
                type="button"
                class="btn btn-sm py-1 px-3 rounded-pill"
                :class="selectedCategory === 'Day-of Ops' ? 'btn-danger text-white fw-bold' : 'btn-light text-muted'"
                @click="selectedCategory = 'Day-of Ops'"
              >
                Day-of Ops
              </button>
              <button
                type="button"
                class="btn btn-sm py-1 px-3 rounded-pill"
                :class="selectedCategory === 'Adhoc' ? 'btn-danger text-white fw-bold' : 'btn-light text-muted'"
                @click="selectedCategory = 'Adhoc'"
              >
                Ad hoc
              </button>
            </div>

            <span class="text-muted small px-2">
              {{ dayEvents.filter(e => e.status === 'Completed').length }}/{{ dayEvents.length }} Done
            </span>

          </div>
        </div>

        <!-- Day-of Operations Live Sync Banner -->
        <div v-if="opsSyncInfo" class="alert alert-light border shadow-xs py-2 px-3 mb-3 d-flex flex-wrap align-items-center justify-content-between gap-2" style="border-radius: 0.75rem;">
          <div class="d-flex align-items-center gap-2">
            <span class="badge bg-warning bg-opacity-25 text-dark border border-warning-subtle px-2 py-1" style="font-size: 0.7rem; font-weight: 700;">
              ⚡ DAY-OF OPS SYNCED
            </span>
            <span class="small text-dark fw-semibold" style="font-size: 0.8rem;">
              {{ opsSyncInfo.eventCount }} Day-of Ops task{{ opsSyncInfo.eventCount === 1 ? '' : 's' }} linked from <strong>{{ opsSyncInfo.eventName }}</strong> ({{ opsSyncInfo.eventDate }}){{ opsSyncInfo.otherEvents ? ` and ${opsSyncInfo.otherEvents} other event${opsSyncInfo.otherEvents === 1 ? '' : 's'}` : '' }}
            </span>
          </div>
          <div class="d-flex align-items-center gap-2">
            <button 
              v-if="selectedDate !== opsSyncInfo.eventDate"
              type="button" 
              class="btn btn-sm btn-outline-danger py-1 px-2.5 rounded-pill fw-bold"
              style="font-size: 0.72rem;"
              @click="selectedDate = opsSyncInfo.eventDate"
            >
              Jump to {{ opsSyncInfo.eventName }} Day →
            </button>
            <button 
              type="button" 
              class="btn btn-sm btn-light border py-1 px-2 rounded-pill text-muted"
              style="font-size: 0.72rem;"
              title="Refresh tasks from Day-of Operations"
              @click="syncOpsTasks(true)"
            >
              ↻ Refresh Sync
            </button>
          </div>
        </div>

        <!-- Schedule Items List -->
        <div class="d-flex flex-column gap-3">

          <div v-if="filteredEvents.length === 0" class="pulse-card p-4 shadow-sm text-center text-muted small">
            No events to show for this day{{ selectedCategory !== 'All' ? ' in this category' : '' }}.
            <span v-if="!readOnly">Use "Add Event / Class" to plan something.</span>
          </div>

          <div
            v-for="event in filteredEvents"
            :key="event.id"
            class="pulse-card p-3 shadow-sm border position-relative"
            :style="{
              borderLeft: event.category === 'Academic'
                ? '4px solid #3b82f6 !important'
                : event.category === 'Day-of Ops'
                  ? '4px solid #f59e0b !important'
                  : event.category === 'CCA'
                    ? '4px solid #ef4444 !important'
                    : '4px solid #10b981 !important'
            }"
          >
            <!-- Keep complete status words readable; let the header stack when space runs out. -->
            <div class="schedule-entry-header d-flex flex-wrap justify-content-between align-items-start gap-2 mb-2">
              <div class="schedule-entry-details">
                <div class="schedule-entry-title d-flex flex-wrap align-items-center gap-2 mb-1">
                  <h6 class="fw-bold mb-0" :class="{ 'text-decoration-line-through text-muted': event.status === 'Completed' }">
                    {{ event.title }}
                  </h6>
                  <span class="badge" :class="{
                    'bg-primary': event.category === 'Academic',
                    'bg-danger': event.category === 'CCA',
                    'bg-warning text-dark': event.category === 'Day-of Ops',
                    'bg-success': event.category === 'Adhoc'
                  }" style="font-size: 0.65rem;">
                    {{ categoryLabel(event.category) }}
                  </span>
                  <span v-if="event.isOpsTask" class="badge text-white px-2 py-0.5 rounded-pill" style="background-color: var(--pulse-purple-transit); font-size: 0.65rem;">
                    ⚡ Production Duty
                  </span>
                  <span v-if="conflictingEventIds.has(event.id)" class="badge bg-warning text-dark border border-warning" style="font-size: 0.65rem;">
                    Clash Detected
                  </span>
                </div>

                <div class="text-muted small d-flex flex-wrap align-items-center gap-2">
                  <span class="fw-bold text-dark font-monospace">{{ event.startTime }} – {{ event.endTime }}</span>
                  <span>•</span>
                  <span>{{ event.venue }}</span>
                  <span>•</span>
                  <span class="fst-italic">{{ event.role }}</span>
                </div>
              </div>

              <!-- Status Badge / Toggle Button -->
              <button
                type="button"
                class="schedule-entry-status btn btn-sm py-1 px-2 rounded-pill fw-bold border"
                :class="{
                  'btn-success text-white': event.status === 'Completed',
                  'btn-warning text-dark': event.status === 'In Progress',
                  'btn-light text-muted': event.status === 'Not Started'
                }"
                style="font-size: 0.7rem;"
                @click="toggleEventStatus(event)"
                :title="'Click to toggle: ' + event.status"
              >
                {{ event.status }}
              </button>
            </div>

            <!-- Transit (calculated by OneMap) & Notes -->
            <div v-if="walkInfo[event.id] || event.notes" class="p-2 rounded bg-light border small text-muted mb-2" style="font-size: 0.725rem;">
              <div v-if="walkInfo[event.id]" class="mb-1" :class="{ 'text-danger fw-bold': transitTight(event) }">
                <strong class="text-secondary">Transit:</strong>
                {{ transitText(event) }}
                <span v-if="!walkInfo[event.id].sameVenue"> • {{ walkInfo[event.id].gapMinutes }} min gap</span>
                <span v-if="transitTight(event)"> ⚠ Not enough time</span>
              </div>
              <div v-if="event.notes">
                <strong class="text-secondary">Notes:</strong> {{ event.notes }}
              </div>
            </div>

            <!-- Action Buttons: Edit & Delete -->
            <div class="d-flex justify-content-end gap-2 border-top pt-2">
              <button
                type="button"
                class="btn btn-sm btn-outline-secondary py-0 px-2"
                style="font-size: 0.7rem;"
                @click="openEditModal(event)"
              >
                Edit
              </button>
              <button
                type="button"
                class="btn btn-sm btn-outline-danger py-0 px-2"
                style="font-size: 0.7rem;"
                @click="deleteEvent(event.id)"
              >
                Delete
              </button>
            </div>

          </div>

        </div>

      </div>

    </div>

    <!-- MODAL: Add / Edit Event with SMU Building Selector -->
    <div
      v-if="showModal"
      class="modal fade show d-block"
      tabindex="-1"
      style="background-color: rgba(15, 23, 42, 0.65); z-index: 1055;"
    >
      <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
        <div class="modal-content border-0 shadow-lg" style="border-radius: 1rem;">

          <div class="modal-header border-bottom py-3 px-4 bg-light">
            <h6 class="modal-title fw-bold text-dark mb-0">
              {{ isEditing ? 'Edit Schedule Event' : 'Add Custom Event / Class' }}
            </h6>
            <button type="button" class="btn-close" aria-label="Close" @click="closeModal"></button>
          </div>

          <!-- Keep this nested form shrinkable so its body scrolls and the save footer stays visible. -->
          <form class="pulse-scrollable-modal-form" @submit.prevent="saveEvent">
            <div class="modal-body p-4">

    <!-- Modal Error Banner -->
    <div
      v-if="formError"
      class="alert alert-danger py-2 px-3 small border-0 mb-3 d-flex align-items-center gap-2"
      role="alert"
      style="border-radius: 0.5rem; background-color: #fef2f2; color: #991b1b;"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>
      <span>{{ formError }}</span>
    </div>
              
              <div class="mb-3">
                <label class="form-label small fw-bold text-dark">Event or Class Title:</label>
                <input
                  v-model="eventForm.title"
                  type="text"
                  class="form-control form-control-sm"
                  placeholder="e.g. IS216 Lab, Rehearsal Warmup, Team Debrief"
                  required
                />
              </div>

              <div class="row g-2 mb-3">
                <div class="col-6">
                  <label class="form-label small fw-bold text-dark">Category:</label>
                  <select v-model="eventForm.category" class="form-select form-select-sm" required>
                    <option value="CCA">CCA</option>
                    <option value="Academic">Academic</option>
                    <option value="Adhoc">Ad hoc</option>
                  </select>
                </div>
                <div class="col-6">
                  <label class="form-label small fw-bold text-dark">Date:</label>
                  <input v-model="eventForm.date" type="date" class="form-control form-control-sm" required />
                </div>
              </div>

              <div class="row g-2 mb-3">
                <div class="col-6">
                  <label class="form-label small fw-bold text-dark">Start Time:</label>
                  <input v-model="eventForm.startTime" type="time" class="form-control form-control-sm" required />
                </div>
                <div class="col-6">
                  <label class="form-label small fw-bold text-dark">End Time:</label>
                  <input v-model="eventForm.endTime" type="time" class="form-control form-control-sm" required />
                </div>
              </div>

              <!-- SMU Building Selection for OneMap Route Calculation -->
              <div class="mb-3">
                <label class="form-label small fw-bold text-dark">SMU building:</label>
                <select v-model="eventForm.building" class="form-select form-select-sm fw-bold text-primary" required>
                  <option v-for="b in SMU_BUILDINGS" :key="b" :value="b">
                    {{ b }}
                  </option>
                </select>
                <small class="text-muted" style="font-size: 0.675rem;">
                  We use this location to estimate walking time between events.
                </small>
              </div>

              <div class="row g-2 mb-3">
                <div class="col-6">
                  <label class="form-label small fw-bold text-dark">Room / Floor Details:</label>
                  <input
                    v-model="eventForm.room"
                    type="text"
                    class="form-control form-control-sm"
                    placeholder="e.g. SR 2.1, Studio L7.2, B1 Stage"
                    required
                  />
                </div>
                <div class="col-6">
                  <label class="form-label small fw-bold text-dark">Role / Responsibility:</label>
                  <input
                    v-model="eventForm.role"
                    type="text"
                    class="form-control form-control-sm"
                    placeholder="e.g. Lead Dancer, Student"
                  />
                </div>
              </div>

              <div class="mb-2">
                <label class="form-label small fw-bold text-dark">Preparation Notes:</label>
                <textarea
                  v-model="eventForm.notes"
                  class="form-control form-control-sm"
                  rows="2"
                  placeholder="e.g. Bring dance sneakers, project slide deck ready."
                ></textarea>
              </div>

            </div>

            <div class="modal-footer border-top py-3 px-4 d-flex justify-content-between">
              <button type="button" class="btn btn-outline-secondary btn-sm" @click="closeModal">Cancel</button>
              <button type="submit" class="btn btn-danger btn-sm fw-bold px-3">
                {{ isEditing ? 'Save Changes' : 'Add to Schedule' }}
              </button>
            </div>
          </form>

        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
/* Long titles may wrap naturally; status/category labels retain whole words. */
.schedule-entry-details { flex: 1 1 14rem; min-width: 0; }
.schedule-entry-title h6 { min-width: 0; overflow-wrap: anywhere; }
.schedule-entry-title .badge, .schedule-entry-status { flex-shrink: 0; white-space: nowrap; word-break: normal; overflow-wrap: normal; }
.schedule-entry-status { margin-left: auto; }
.pulse-api-tag {
  font-size: 0.6rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.15rem 0.45rem;
  border-radius: 9999px;
  background-color: rgba(59, 130, 246, 0.12);
  color: #2563eb;
  border: 1px solid rgba(59, 130, 246, 0.25);
}

@media (max-width: 575.98px) {
  h3 {
    font-size: 1.25rem !important;
    line-height: 1.25 !important;
  }
}
</style>