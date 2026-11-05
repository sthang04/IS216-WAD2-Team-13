<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { useRoute } from 'vue-router';
import { session, activeClubName, setActiveClub } from '../services/sessionState';
import { parseIcs, icsEventAt } from '../services/icsBaseline';
import {
  fetchMeetingSnapshot, fetchClubRoster, createMeeting, setAvailability, submitNoAvailability, clearMeetingResponse,
  nudgeParticipants, confirmMeeting, cancelMeeting, updateParticipants, updateAgenda,
  fetchMyBaseline, fetchClubBaselines, saveMyBaseline, clearMyBaseline, listenForMeetings
} from '../services/meetingService';

const props = defineProps({
  apiMode: { type: Boolean, default: true },
  readOnly: { type: Boolean, default: false }
});

const route = useRoute();

/* ================================================================== */
/* 1. BASICS: toast message + guest check                              */
/* ================================================================== */
const toastMsg = ref('')
const toastType = ref('success')
let toastTimer = null

function showToast(msg, type = 'success', ms = 4000) {
  toastMsg.value = msg
  toastType.value = type
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toastMsg.value = '' }, ms)
}

function blockedForGuest() {
  if (!props.readOnly) return false
  showToast('Guest view is read-only. Sign in as a CCA ExCo to make changes.', 'warning')
  return true
}

/* ================================================================== */
/* 2. DATE HELPERS (Singapore time; the grid runs 08:00 to 22:00)      */
/* ================================================================== */
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]

function pad(n) { return String(n).padStart(2, '0') }
function toISO(dt) { return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}` }
function parseISO(s) {
  if (!s) return null
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
function addDays(dt, n) { return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + n) }
function mondayOf(dt) { return addDays(dt, -((dt.getDay() + 6) % 7)) }
function hourLabel(h) { return `${pad(h)}:00` }
function shortLabel(dt) { return `${WEEKDAYS_SHORT[dt.getDay()]} ${dt.getDate()} ${MONTHS_SHORT[dt.getMonth()]}` }
function longLabel(dt) { return `${WEEKDAYS_LONG[dt.getDay()]}, ${dt.getDate()} ${MONTHS_SHORT[dt.getMonth()]} ${dt.getFullYear()}` }
function weekLabel(monday) {
  const sun = addDays(monday, 6)
  return `${monday.getDate()} ${MONTHS_SHORT[monday.getMonth()]} – ${sun.getDate()} ${MONTHS_SHORT[sun.getMonth()]} ${sun.getFullYear()}`
}
function deadlineLabel(iso) {
  const dt = new Date(iso)
  return `${shortLabel(dt)}, ${pad(dt.getHours())}:${pad(dt.getMinutes())}`
}
// <input type="datetime-local"> wants "YYYY-MM-DDTHH:MM" in local time
function toLocalInput(dt) { return `${toISO(dt)}T${pad(dt.getHours())}:${pad(dt.getMinutes())}` }

/* ================================================================== */
/* 3. WEEK NAVIGATION                                                  */
/* ================================================================== */
const THIS_WEEK = mondayOf(new Date())
const weekStart = ref(THIS_WEEK)
const weekKey = computed(() => toISO(weekStart.value))
const weekDates = computed(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart.value, i)))

function shiftWeek(n) { weekStart.value = addDays(weekStart.value, n * 7) }

/* ================================================================== */
/* 4. WHO IS LOOKING, AND THE CCA'S DATA                               */
/* ================================================================== */
const clubId = computed(() => session.value.activeClubId)
const myId = computed(() => session.value.memberId)
const canUse = computed(() => !!(session.value.ready && myId.value && clubId.value))

const roster = ref([])                         // everyone in the CCA
const myBaseline = ref({ fileName: '', events: [] })
const clubBaselines = ref({})                  // { memberId: [busy events] } for everyone else
const snapshot = ref({ meeting: null, participants: [], availability: [], weekMeetings: [] })
const isLoading = ref(false)
const clockOffset = ref(0)                     // server time minus browser time, for the countdown

const nameOf = computed(() => Object.fromEntries(roster.value.map((m) => [m.member_id, m.full_name])))

let clubSeq = 0
async function loadClubData() {
  const seq = ++clubSeq
  if (!canUse.value) {
    roster.value = []
    myBaseline.value = { fileName: '', events: [] }
    clubBaselines.value = {}
    return
  }
  try {
    const [r, mine, others] = await Promise.all([
      fetchClubRoster(clubId.value), fetchMyBaseline(), fetchClubBaselines(clubId.value)
    ])
    if (seq !== clubSeq) return // switched CCA or persona meanwhile
    roster.value = r
    myBaseline.value = mine
    clubBaselines.value = others
  } catch (err) {
    console.error('Could not load the CCA timetables:', err.message)
  }
}

// A week can have several meetings; this is the one shown in the sidebar (null = the server picks)
const selectedMeetingId = ref(null)

let loadSeq = 0
async function loadMeeting(meetingId = selectedMeetingId.value) {
  if (!canUse.value) {
    snapshot.value = { meeting: null, participants: [], availability: [], weekMeetings: [] }
    return
  }
  const seq = ++loadSeq
  isLoading.value = true
  try {
    const data = await fetchMeetingSnapshot({ clubId: clubId.value, weekStart: weekKey.value, meetingId })
    if (seq !== loadSeq) return // a newer load started meanwhile
    // A picked meeting from another week or since cancelled (e.g. a stale id) falls back to this week's
    if (data.meeting && (data.meeting.week_start !== weekKey.value || data.meeting.status === 'CANCELLED')) {
      selectedMeetingId.value = null
      return loadMeeting(null)
    }
    snapshot.value = {
      meeting: data.meeting,
      participants: data.participants || [],
      availability: data.availability || [],
      weekMeetings: data.week_meetings || []
    }
    if (data.meeting) {
      clockOffset.value = new Date(data.meeting.server_now).getTime() - Date.now()
    }
  } catch (err) {
    console.error('Could not load the meeting:', err.message)
  } finally {
    if (seq === loadSeq) isLoading.value = false
  }
}

const meeting = computed(() => snapshot.value.meeting)
const isOpenRequest = computed(() => meeting.value && ['COLLECTING', 'EXPIRED'].includes(meeting.value.status))
const isConfirmed = computed(() => meeting.value?.status === 'CONFIRMED')

const weekMeetings = computed(() => snapshot.value.weekMeetings || [])
const hasConfirmedThisWeek = computed(() => weekMeetings.value.some((w) => w.status === 'CONFIRMED'))

function statusBadge(w) {
  if (w.status === 'CONFIRMED') return { cls: 'pulse-badge-confirmed', label: 'Confirmed' }
  if (w.status === 'EXPIRED') return { cls: 'pulse-badge-rejected', label: 'Voting closed' }
  // Everyone answered, so the server keeps it COLLECTING after the deadline
  if (new Date(w.vote_deadline).getTime() <= now.value + clockOffset.value) return { cls: 'pulse-badge-rejected', label: 'Voting closed' }
  return { cls: 'pulse-badge-pending', label: 'Collecting' }
}

function selectMeeting(id) {
  showCreateForm.value = false
  showConfirmForm.value = false
  selectedMeetingId.value = id
  return loadMeeting(id)
}

/* ================================================================== */
/* 5. LIVE UPDATES                                                     */
/* ================================================================== */
let stopListening = null
let refreshTimer = null

function scheduleRefresh() {
  // Several rows change at once (e.g. a vote + "responded"), so wait a moment and reload once
  clearTimeout(refreshTimer)
  // While votes are saving, a reload would hide the newest clicks; the last vote reloads instead
  refreshTimer = setTimeout(() => { if (!votesSaving) loadMeeting() }, 300)
}

function listen() {
  if (stopListening) stopListening()
  stopListening = null
  if (canUse.value) {
    stopListening = listenForMeetings(clubId.value, meeting.value?.id || null, scheduleRefresh)
  }
}

// A meeting picked in the old CCA or persona must not carry over (keep this before the loading watcher)
watch([clubId, myId], () => {
  selectedMeetingId.value = null
  showCreateForm.value = false
  showConfirmForm.value = false
})
watch([clubId, myId, () => session.value.ready], () => { loadClubData(); loadMeeting() }, { immediate: true })
watch(weekKey, () => {
  selectedMeetingId.value = null
  showConfirmForm.value = false
  loadMeeting()
})
watch([clubId, () => meeting.value?.id], listen, { immediate: true })

// Telegram / bell links open /availability?meeting=ID: jump to that meeting's CCA and week
async function openLinkedMeeting() {
  const id = Number(route.query.meeting)
  if (!id || !canUse.value) return
  try {
    const data = await fetchMeetingSnapshot({ clubId: clubId.value, weekStart: weekKey.value, meetingId: id })
    if (!data.meeting) return
    if (data.meeting.club_id !== clubId.value) setActiveClub(data.meeting.club_id)
    weekStart.value = parseISO(data.meeting.week_start)
    await nextTick() // let the week change reset the selection first
    selectMeeting(id)
  } catch (err) {
    console.error('Could not open the meeting link:', err.message)
  }
}
watch([() => route.query.meeting, canUse], openLinkedMeeting, { immediate: true })

/* ================================================================== */
/* 6. COUNTDOWN TO THE VOTING DEADLINE                                 */
/* ================================================================== */
const now = ref(Date.now())
let clock = null

const secondsLeft = computed(() => {
  if (!meeting.value) return 0
  const ms = new Date(meeting.value.vote_deadline).getTime() - (now.value + clockOffset.value)
  return Math.max(0, Math.floor(ms / 1000))
})
const votingOpen = computed(() => meeting.value?.status === 'COLLECTING' && secondsLeft.value > 0)

const countdownText = computed(() => {
  const s = secondsLeft.value
  const days = Math.floor(s / 86400)
  const hms = `${pad(Math.floor((s % 86400) / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
  return days > 0 ? `${days}d ${hms}` : hms
})

function closeMenuOnEscape(event) {
  if (event.key === 'Escape') closeMenu()
}

onMounted(() => {
  clock = setInterval(() => {
    const wasOpen = votingOpen.value
    now.value = Date.now()
    // The deadline just passed: the server closes voting, so reload to show it
    if (wasOpen && !votingOpen.value) loadMeeting()
  }, 1000)
  window.addEventListener('click', closeMenu)
  window.addEventListener('scroll', closeMenu, true)
  window.addEventListener('resize', closeMenu)
  window.addEventListener('keydown', closeMenuOnEscape)
})

onBeforeUnmount(() => {
  clearInterval(clock)
  clearTimeout(refreshTimer)
  clearTimeout(toastTimer)
  if (stopListening) stopListening()
  window.removeEventListener('click', closeMenu)
  window.removeEventListener('scroll', closeMenu, true)
  window.removeEventListener('resize', closeMenu)
  window.removeEventListener('keydown', closeMenuOnEscape)
})

/* ================================================================== */
/* 6b. RIGHT-CLICK A MEETING: edit participants / agenda (organiser)   */
/* ================================================================== */
const menu = ref({ open: false, x: 0, y: 0, meeting: null })

// Same rules as the server: people while voting is open, agenda until the meeting starts
function editRules(w) {
  const serverNow = now.value + clockOffset.value
  const startsAt = w.status === 'CONFIRMED'
    ? new Date(`${w.confirmed_date}T${hourLabel(w.confirmed_start_hour)}:00+08:00`).getTime()
    : weekEnd(weekKey.value).getTime()
  return {
    people: !!w.is_organiser && w.status === 'COLLECTING' && new Date(w.vote_deadline).getTime() > serverNow,
    peopleWhy: !w.is_organiser ? 'Only the organiser can edit' : w.status === 'CONFIRMED' ? 'Meeting already confirmed' : 'Voting has closed',
    agenda: !!w.is_organiser && startsAt > serverNow,
    agendaWhy: !w.is_organiser ? 'Only the organiser can edit' : 'The meeting has started'
  }
}

function openMenu(event, w) {
  if (props.readOnly) return
  const width = 230
  const height = 130
  menu.value = {
    open: true,
    x: Math.min(event.clientX, window.innerWidth - width - 8),
    y: Math.min(event.clientY, window.innerHeight - height - 8),
    meeting: w
  }
}

function closeMenu() {
  if (menu.value.open) menu.value = { ...menu.value, open: false }
}

const menuRules = computed(() => (menu.value.meeting ? editRules(menu.value.meeting) : {}))

// Edit dialogs
const editing = ref(null) // 'people' | 'agenda' | null
const editMeeting = ref(null)
const editMemberIds = ref([])
const editAgenda = ref('')
const isSaving = ref(false)

async function startEdit(kind) {
  const w = menu.value.meeting
  closeMenu()
  if (!w || blockedForGuest()) return
  // Load that meeting so we know who is in it right now
  if (meeting.value?.id !== w.id) await selectMeeting(w.id)
  editMeeting.value = meeting.value
  editMemberIds.value = snapshot.value.participants.map((p) => p.member_id)
  editAgenda.value = meeting.value?.agenda || ''
  editing.value = kind
}

function closeEdit() {
  editing.value = null
  editMeeting.value = null
}

function toggleEditMember(id) {
  if (id === myId.value) return // the organiser always takes part
  editMemberIds.value = editMemberIds.value.includes(id)
    ? editMemberIds.value.filter((x) => x !== id)
    : [...editMemberIds.value, id]
}

function editSelectSubcommittee(name) {
  const ids = roster.value.filter((m) => m.subcommittee === name).map((m) => m.member_id)
  editMemberIds.value = [...new Set([...ids, myId.value])]
}

const editSelectedCount = computed(() => new Set([...editMemberIds.value, myId.value]).size)

async function saveEdit() {
  if (blockedForGuest() || !editMeeting.value) return
  isSaving.value = true
  try {
    if (editing.value === 'people') {
      if (editSelectedCount.value < 2) {
        showToast('Pick at least one other participant.', 'warning')
        return
      }
      const result = await updateParticipants(editMeeting.value.id, editMemberIds.value)
      const parts = []
      if (result.added) parts.push(`${result.added} added (sent the request on Telegram)`)
      if (result.removed) parts.push(`${result.removed} removed`)
      showToast(parts.length ? `Participants updated: ${parts.join(', ')}.` : 'No changes to the participants.')
    } else {
      await updateAgenda(editMeeting.value.id, editAgenda.value.trim())
      showToast('Agenda updated. Participants were notified.')
    }
    const id = editMeeting.value.id
    closeEdit()
    await selectMeeting(id)
  } catch (err) {
    showToast(err.message, 'danger')
  } finally {
    isSaving.value = false
  }
}

/* ================================================================== */
/* 7. THE CALENDAR GRID                                                */
/* ================================================================== */
const participantIds = computed(() => snapshot.value.participants.map((p) => p.member_id))
const amParticipant = computed(() => !!meeting.value?.is_participant)

// "YYYY-MM-DD|hour" -> member ids free then
const freeBySlot = computed(() => {
  const map = {}
  snapshot.value.availability.forEach((a) => {
    const key = `${a.slot_date}|${a.hour}`
    if (!map[key]) map[key] = []
    map[key].push(a.member_id)
  })
  return map
})

// Whose timetables to show: the meeting's participants, or the whole CCA when there is no request
const baselineMemberIds = computed(() => {
  const ids = meeting.value && !isConfirmed.value ? participantIds.value : roster.value.map((m) => m.member_id)
  return ids.filter((id) => id !== myId.value)
})

// The confirmed meeting this week at that hour, or null
function confirmedAt(iso, hour) {
  return (snapshot.value.weekMeetings || []).find((w) => w.status === 'CONFIRMED' && w.confirmed_date === iso &&
    hour >= w.confirmed_start_hour && hour < w.confirmed_end_hour) || null
}

// Start of the current hour, so the grid below updates hourly and not with every countdown tick
const HOUR_MS = 60 * 60 * 1000
const currentHourStart = computed(() => Math.floor((now.value + clockOffset.value) / HOUR_MS) * HOUR_MS)

// Everything one cell needs, worked out once per change
const grid = computed(() => HOURS.map((hour) => weekDates.value.map((day) => {
  const iso = toISO(day)
  const free = freeBySlot.value[`${iso}|${hour}`] || []
  const othersInClass = baselineMemberIds.value.filter((id) => icsEventAt(clubBaselines.value[id] || [], day, hour))
  const slotTimestamp = new Date(`${iso}T${pad(hour)}:00:00+08:00`).getTime()
  const isPast = slotTimestamp <= currentHourStart.value
  return {
    key: `${iso}|${hour}`,
    iso,
    hour,
    isPast,
    myClass: icsEventAt(myBaseline.value.events, day, hour),
    othersInClass,
    free,
    mine: free.includes(myId.value),
    confirmed: confirmedAt(iso, hour)
  }
})))

const totalParticipants = computed(() => snapshot.value.participants.length)

// Share of participants free: red below 50%, amber 50-75%, green above 75%, deep green when everyone is.
// Nobody free yet: no colour (white, or grey if someone has class then).
function heatClass(cell) {
  if (!isOpenRequest.value || cell.free.length === 0 || totalParticipants.value === 0) return ''
  const share = cell.free.length / totalParticipants.value
  if (share >= 1) return 'avail-all'
  if (share > 0.75) return 'avail-green'
  if (share >= 0.5) return 'avail-amber'
  return 'avail-red'
}

const canVote = computed(() => !props.readOnly && amParticipant.value && votingOpen.value)

function cellTitle(cell) {
  const parts = [`${shortLabel(parseISO(cell.iso))} ${hourLabel(cell.hour)}`]
  if (cell.isPast) parts.push('(Past slot — voting closed)')
  if (isOpenRequest.value) parts.push(`${cell.free.length}/${totalParticipants.value} free`)
  if (cell.free.length) parts.push('Free: ' + cell.free.map((id) => nameOf.value[id] || 'Member').join(', '))
  if (cell.othersInClass.length) parts.push('In class: ' + cell.othersInClass.map((id) => nameOf.value[id] || 'Member').join(', '))
  return parts.join('\n')
}

// Votes are saved in click order, so two quick clicks on one block can't finish the wrong way round
let voteQueue = Promise.resolve()
let votesSaving = 0

function toggleCell(cell) {
  if (!canVote.value || responseSaving.value) return
  if (cell.isPast) {
    showToast('Cannot vote on past time slots.', 'warning')
    return
  }
  const meetingId = meeting.value.id
  const nowFree = !cell.mine
  // Show the change straight away; the reload after the last vote confirms it
  const before = snapshot.value.availability
  snapshot.value.availability = nowFree
    ? [...before, { member_id: myId.value, slot_date: cell.iso, hour: cell.hour }]
    : before.filter((a) => !(a.member_id === myId.value && a.slot_date === cell.iso && a.hour === cell.hour))
  loadSeq++ // a load already running started before this click, so ignore its result
  votesSaving++
  voteQueue = voteQueue
    .then(() => setAvailability(meetingId, cell.iso, cell.hour, nowFree))
    .catch((err) => showToast(err.message, 'danger'))
    .finally(() => {
      votesSaving--
      if (!votesSaving) scheduleRefresh() // also puts back a block whose vote failed
    })
}

/* ================================================================== */
/* 8. TIMETABLE IMPORT (.ics) — saved to Supabase                      */
/* ================================================================== */
const icsInput = ref(null)
const isImporting = ref(false)

function pickIcsFile() {
  if (blockedForGuest()) return
  if (!canUse.value) {
    showToast('Sign in as an ExCo to import your timetable.', 'warning')
    return
  }
  icsInput.value.click()
}

async function handleIcsFile(event) {
  const file = event.target.files[0]
  event.target.value = '' // so picking the same file again still triggers a change
  if (!file) return
  isImporting.value = true
  try {
    const events = parseIcs(await file.text())
    if (events.length === 0) {
      showToast(`No timed events found in ${file.name}. Export your timetable as an .ics calendar file.`, 'warning')
      return
    }
    const saved = await saveMyBaseline(events, file.name)
    myBaseline.value = { fileName: file.name, events }
    showToast(`Imported ${saved} events from ${file.name}.`)
  } catch (err) {
    showToast(`Could not import ${file.name}: ${err.message}`, 'danger')
  } finally {
    isImporting.value = false
  }
}

async function removeTimetable() {
  if (blockedForGuest()) return
  try {
    await clearMyBaseline()
    myBaseline.value = { fileName: '', events: [] }
    showToast('Timetable removed.')
  } catch (err) {
    showToast(err.message, 'danger')
  }
}

/* ================================================================== */
/* 9. SCHEDULE MEETING (create a request)                              */
/* ================================================================== */
const showCreateForm = ref(false)
const isSubmitting = ref(false)
const form = ref({ title: '', agenda: '', week: '', deadline: '', memberIds: [] })

// This week and the next 7
const weekOptions = computed(() => Array.from({ length: 8 }, (_, i) => {
  const monday = addDays(THIS_WEEK, i * 7)
  return { value: toISO(monday), label: weekLabel(monday) }
}))

const subcommittees = computed(() =>
  [...new Set(roster.value.map((m) => m.subcommittee).filter(Boolean))].sort()
)

function weekEnd(weekIso) { return addDays(parseISO(weekIso), 7) } // next Monday 00:00

// Default deadline: two days from now at 23:59, but before the meeting week ends
function defaultDeadline(weekIso) {
  const inTwoDays = addDays(new Date(), 2)
  inTwoDays.setHours(23, 59, 0, 0)
  const latest = new Date(weekEnd(weekIso).getTime() - 60 * 60 * 1000)
  return toLocalInput(inTwoDays < latest ? inTwoDays : latest)
}

const deadlineMin = computed(() => toLocalInput(new Date()))
const deadlineMax = computed(() => form.value.week ? toLocalInput(new Date(weekEnd(form.value.week).getTime() - 60 * 1000)) : '')

function openCreateForm() {
  if (blockedForGuest()) return
  const week = weekStart.value >= THIS_WEEK ? weekKey.value : toISO(THIS_WEEK)
  form.value = {
    title: `${activeClubName.value || 'ExCo'} Meeting`,
    agenda: '',
    week,
    deadline: defaultDeadline(week),
    memberIds: roster.value.map((m) => m.member_id)
  }
  showCreateForm.value = true
}

watch(() => form.value.week, (week, oldWeek) => {
  if (oldWeek && week) form.value.deadline = defaultDeadline(week)
})

function isSelected(id) { return form.value.memberIds.includes(id) }

function toggleMember(id) {
  if (id === myId.value) return // the organiser always takes part
  form.value.memberIds = isSelected(id)
    ? form.value.memberIds.filter((x) => x !== id)
    : [...form.value.memberIds, id]
}

function selectEveryone() { form.value.memberIds = roster.value.map((m) => m.member_id) }

function selectSubcommittee(name) {
  const ids = roster.value.filter((m) => m.subcommittee === name).map((m) => m.member_id)
  form.value.memberIds = [...new Set([...ids, myId.value])]
}

const selectedCount = computed(() => new Set([...form.value.memberIds, myId.value]).size)

async function submitCreate() {
  if (blockedForGuest()) return
  const deadline = new Date(form.value.deadline)
  if (!form.value.title.trim()) return showToast('Give the meeting a title.', 'warning')
  if (Number.isNaN(deadline.getTime()) || deadline <= new Date()) return showToast('The voting deadline must be in the future.', 'warning')
  if (deadline >= weekEnd(form.value.week)) return showToast('The voting deadline must be before the end of the meeting week.', 'warning')
  if (selectedCount.value < 2) return showToast('Pick at least one other participant.', 'warning')

  isSubmitting.value = true
  try {
    const newId = await createMeeting({
      clubId: clubId.value,
      title: form.value.title.trim(),
      agenda: form.value.agenda.trim(),
      weekStart: form.value.week,
      voteDeadline: deadline.toISOString(),
      memberIds: form.value.memberIds
    })
    showCreateForm.value = false
    weekStart.value = parseISO(form.value.week)
    await nextTick() // let the week change reset the selection first
    selectMeeting(newId)
    showToast(`Meeting request sent to ${selectedCount.value - 1} participant${selectedCount.value === 2 ? '' : 's'} on Telegram.`)
  } catch (err) {
    showToast(err.message, 'danger')
  } finally {
    isSubmitting.value = false
  }
}

/* ================================================================== */
/* 10. COLLECTING: responses, nudges                                   */
/* ================================================================== */
const pending = computed(() => snapshot.value.participants.filter((p) => !p.responded_at))
const myResponse = computed(() => snapshot.value.participants.find((p) => p.member_id === myId.value))
const mySlotCount = computed(() => snapshot.value.availability.filter((a) => a.member_id === myId.value).length)
const isOrganiser = computed(() => !!meeting.value?.is_organiser)

const responseSaving = ref(false)

async function answerNoneWork() {
  if (blockedForGuest()) return
  try {
    if (responseSaving.value || !canVote.value) return
    responseSaving.value = true
    await voteQueue
    await submitNoAvailability(meeting.value.id)
    await loadMeeting()
    showToast('Response saved: none of these days work for you.')
  } catch (err) {
    showToast(err.message, 'danger')
  } finally {
    responseSaving.value = false
  }
}

async function undoResponse() {
  if (blockedForGuest() || responseSaving.value || !canVote.value) return
  responseSaving.value = true
  const meetingId = meeting.value.id
  try {
    await voteQueue
    await clearMeetingResponse(meetingId)
    await loadMeeting()
    showToast('Response cleared. You can select your available times again.')
  } catch (err) {
    showToast(err.message, 'danger')
  } finally {
    responseSaving.value = false
  }
}

const nudging = ref(null) // member id being nudged, or 'all'

const NUDGE_GAP_MS = 15 * 60 * 1000 // the server allows one nudge per person every 15 minutes

function recentlyNudged(p) {
  return p.last_nudged_at && (now.value + clockOffset.value) - new Date(p.last_nudged_at).getTime() < NUDGE_GAP_MS
}

// "Nudged 3 min ago · again in 12 min"
function nudgedText(p) {
  const ago = Math.max(0, Math.floor(((now.value + clockOffset.value) - new Date(p.last_nudged_at).getTime()) / 60000))
  const wait = Math.max(1, Math.ceil(NUDGE_GAP_MS / 60000) - ago)
  return `Nudged ${ago === 0 ? 'just now' : `${ago} min ago`} · again in ${wait} min`
}

const nudgeablePending = computed(() => pending.value.filter((p) => p.member_id !== myId.value && p.telegram_linked === true))
const allPendingNudged = computed(() => {
  const others = nudgeablePending.value
  return others.length > 0 && others.every((p) => recentlyNudged(p))
})

async function nudge(memberId = null) {
  if (blockedForGuest()) return
  nudging.value = memberId || 'all'
  try {
    const count = await nudgeParticipants(meeting.value.id, memberId)
    await loadMeeting()
    showToast(count
      ? `Telegram reminder sent to ${count === 1 && memberId ? nameOf.value[memberId] || 'them' : `${count} participants`}.`
      : 'Everyone pending was nudged in the last 15 minutes.', count ? 'success' : 'warning')
  } catch (err) {
    showToast(err.message, 'danger')
  } finally {
    nudging.value = null
  }
}

/* ================================================================== */
/* 11. CHOOSE THE DAY & CONFIRM                                        */
/* ================================================================== */
const showConfirmForm = ref(false)
const pick = ref({ date: '', start: 16, end: 18, venue: '' })

// Longest runs of hours where the most participants are free
const bestTimes = computed(() => {
  if (!isOpenRequest.value) return []
  // The server refuses times already passed or taken by another confirmed meeting
  const bookable = (c) => !c.isPast && !c.confirmed
  let best = 0
  grid.value.forEach((row) => row.forEach((c) => { if (bookable(c)) best = Math.max(best, c.free.length) }))
  if (best === 0) return []

  const isBest = (c) => bookable(c) && c.free.length === best
  const windows = []
  weekDates.value.forEach((day, d) => {
    let h = 0
    while (h < HOURS.length) {
      if (isBest(grid.value[h][d])) {
        const start = h
        while (h < HOURS.length && isBest(grid.value[h][d])) h++
        windows.push({ date: toISO(day), label: longLabel(day), start: HOURS[start], end: HOURS[h - 1] + 1, free: best })
      } else {
        h++
      }
    }
  })
  return windows.sort((a, b) => (b.end - b.start) - (a.end - a.start)).slice(0, 5)
})

const confirmBlockedReason = computed(() => {
  if (!meeting.value || meeting.value.can_confirm) return ''
  const n = pending.value.length
  return `Waiting for ${n} response${n === 1 ? '' : 's'} or the voting deadline.`
})

function openConfirmForm() {
  if (blockedForGuest()) return
  const top = bestTimes.value[0]
  // Nobody free anywhere: start from the first day that isn't over
  const firstDay = weekDates.value.findIndex((_, d) => !grid.value[HOURS.length - 1][d].isPast)
  pick.value = top
    ? { date: top.date, start: top.start, end: top.end, venue: '' }
    : { date: toISO(weekDates.value[Math.max(firstDay, 0)]), start: 16, end: 18, venue: '' }
  showConfirmForm.value = true
}

function usePick(w) { pick.value = { ...pick.value, date: w.date, start: w.start, end: w.end } }
function isPicked(w) { return pick.value.date === w.date && pick.value.start === w.start && pick.value.end === w.end }

const endHourOptions = computed(() => [...HOURS.map((h) => h + 1)].filter((h) => h > pick.value.start))
watch(() => pick.value.start, () => {
  if (pick.value.end <= pick.value.start) pick.value.end = pick.value.start + 1
})

const pickFreeCount = computed(() => {
  // People free for the whole chosen window
  const ids = participantIds.value.filter((id) => {
    for (let h = pick.value.start; h < pick.value.end; h++) {
      if (!(freeBySlot.value[`${pick.value.date}|${h}`] || []).includes(id)) return false
    }
    return true
  })
  return ids.length
})

async function submitConfirm() {
  if (blockedForGuest()) return
  isSubmitting.value = true
  try {
    await confirmMeeting(meeting.value.id, {
      date: pick.value.date, startHour: pick.value.start, endHour: pick.value.end, venue: pick.value.venue
    })
    showConfirmForm.value = false
    await loadMeeting()
    showToast('Meeting confirmed. Participants are being notified on Telegram.')
  } catch (err) {
    showToast(err.message, 'danger')
    loadMeeting()
  } finally {
    isSubmitting.value = false
  }
}

async function cancelRequest() {
  if (blockedForGuest()) return
  if (!window.confirm(`Cancel "${meeting.value.title}"? Participants will be told on Telegram.`)) return
  try {
    await cancelMeeting(meeting.value.id)
    showConfirmForm.value = false
    selectMeeting(null)
    showToast('Meeting request cancelled.')
  } catch (err) {
    showToast(err.message, 'danger')
  }
}

/* ================================================================== */
/* 12. EXPORT THE CONFIRMED MEETING (.ics)                             */
/* ================================================================== */
function toUtcStamp(iso, hour) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, hour - 8)).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

// Calendar files treat \ , ; and line breaks as special, so a title like "Budget, costumes" must be escaped
function icsText(text) {
  return text.replace(/\\/g, '\\\\').replace(/[,;]/g, '\\$&').replace(/\r?\n/g, '\\n')
}

function exportConfirmed() {
  const m = meeting.value
  if (!m || m.status !== 'CONFIRMED') return
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SMU Pulse//Meeting Scheduler//EN',
    'BEGIN:VEVENT',
    `UID:pulse-meeting-${m.id}@smu.edu.sg`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,
    `DTSTART:${toUtcStamp(m.confirmed_date, m.confirmed_start_hour)}`,
    `DTEND:${toUtcStamp(m.confirmed_date, m.confirmed_end_hour)}`,
    `SUMMARY:${icsText(m.title)}`,
    m.agenda ? `DESCRIPTION:${icsText(m.agenda)}` : '',
    m.venue ? `LOCATION:${icsText(m.venue)}` : '',
    'END:VEVENT',
    'END:VCALENDAR'
  ].filter(Boolean).join('\r\n')

  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }))
  link.download = `pulse-meeting-${m.confirmed_date}.ics`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}
</script>

<template>
  <div class="py-2">

    <!-- Header -->
    <div class="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-4">
      <div>
        <h3 class="fw-bold mb-1">Weekly Meeting Scheduler</h3>
        <p class="text-muted small mb-0">{{ activeClubName || 'Your CCA' }}</p>
      </div>

      <div class="d-flex flex-wrap align-items-center gap-2">
        <span v-if="myBaseline.fileName" class="small text-muted" :title="myBaseline.fileName">
          Timetable imported
        </span>
        <input ref="icsInput" type="file" accept=".ics,text/calendar" class="d-none" @change="handleIcsFile" />
        <button type="button" class="btn btn-sm btn-outline-secondary" :disabled="isImporting" @click="pickIcsFile">
          <span v-if="isImporting" class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>
          {{ myBaseline.fileName ? 'Replace Timetable (.ics)' : 'Import Timetable (.ics)' }}
        </button>
        <button v-if="myBaseline.fileName" type="button" class="btn btn-sm btn-outline-secondary" @click="removeTimetable">
          Remove
        </button>
      </div>
    </div>

    <div v-if="toastMsg" class="alert border-0 shadow-sm mb-4 small" :class="`alert-${toastType}`" role="alert">
      {{ toastMsg }}
    </div>

    <div class="row g-4">

      <!-- Left: the week -->
      <div class="col-lg-8">
        <div class="pulse-card p-3 shadow-sm">

          <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3 px-1">
            <div class="d-flex align-items-center gap-2">
              <button type="button" class="btn btn-sm btn-outline-secondary px-2 py-0" aria-label="Previous week" @click="shiftWeek(-1)">‹</button>
              <div class="fw-bold small text-center" style="min-width: 130px;">{{ weekLabel(weekStart) }}</div>
              <button type="button" class="btn btn-sm btn-outline-secondary px-2 py-0" aria-label="Next week" @click="shiftWeek(1)">›</button>
              <button
                v-if="weekStart.getTime() !== THIS_WEEK.getTime()"
                type="button"
                class="btn btn-sm btn-link text-decoration-none py-0"
                style="font-size: 0.7rem;"
                @click="weekStart = THIS_WEEK"
              >
                This week
              </button>
              <span v-if="isLoading" class="spinner-border spinner-border-sm text-muted" role="status" aria-label="Loading"></span>
            </div>

            <!-- Legend -->
            <div class="d-flex flex-wrap align-items-center gap-3 legend">
              <span><span class="legend-swatch swatch-own-class"></span>Your class</span>
              <span><span class="legend-swatch swatch-class"></span>Others in class (not you)</span>
              <template v-if="isOpenRequest">
                <span><span class="legend-swatch avail-red"></span>Below 50% free</span>
                <span><span class="legend-swatch avail-amber"></span>50–75%</span>
                <span><span class="legend-swatch avail-green"></span>Above 75%</span>
                <span><span class="legend-swatch avail-all"></span>Everyone free</span>
              </template>
              <span v-if="hasConfirmedThisWeek"><span class="legend-swatch swatch-meeting"></span>Meeting</span>
            </div>
          </div>

          <div class="table-responsive">
            <table class="table table-borderless align-middle mb-0 text-center scheduler-grid">
              <thead>
                <tr class="border-bottom">
                  <th class="text-muted text-uppercase time-col">Time</th>
                  <th v-for="day in weekDates" :key="toISO(day)" class="fw-bold day-col">
                    {{ WEEKDAYS_SHORT[day.getDay()] }}<br /><span class="fw-normal text-muted">{{ day.getDate() }} {{ MONTHS_SHORT[day.getMonth()] }}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, hIdx) in grid" :key="HOURS[hIdx]">
                  <td class="text-muted fw-semibold time-col py-1">{{ hourLabel(HOURS[hIdx]) }}</td>

                  <td v-for="cell in row" :key="cell.key" class="p-1">
                    <!-- Confirmed meeting -->
                    <div
                      v-if="cell.confirmed"
                      class="slot slot-meeting rounded-2"
                      :title="`${cell.confirmed.title}${cell.confirmed.is_organiser ? ' (right-click to edit)' : ''}`"
                      @contextmenu.prevent="openMenu($event, cell.confirmed)"
                    >
                      <span class="slot-name">{{ cell.confirmed.title }}</span>
                    </div>

                    <!-- Your own class (from your timetable) -->
                    <div
                      v-else-if="cell.myClass"
                      class="pulse-class-pill rounded-2"
                      :title="`${cellTitle(cell)}\nYou're in class, so you can't mark this hour`"
                      aria-disabled="true"
                    >
                      <span class="pulse-class-name">{{ cell.myClass }}</span>
                      <!-- Others in class at the same time would otherwise be hidden under your own class -->
                      <span v-if="cell.othersInClass.length" class="slot-class-extra">+{{ cell.othersInClass.length }} in class</span>
                    </div>

                    <!-- Everyone else: coloured by how many are free; otherwise white, or grey when others have class -->
                    <div
                      v-else
                      class="slot rounded-2 position-relative"
                      :class="[
                        heatClass(cell) || (cell.othersInClass.length ? 'slot-baseline' : ''),
                        { 'slot-mine': cell.mine, 'slot-clickable': canVote && !cell.isPast, 'slot-past opacity-50': cell.isPast }
                      ]"
                      :title="cellTitle(cell)"
                      :role="canVote && !cell.isPast ? 'button' : null"
                      :aria-pressed="canVote && !cell.isPast ? cell.mine : null"
                      :aria-disabled="cell.isPast ? 'true' : null"
                      :tabindex="canVote && !cell.isPast ? 0 : null"
                      @click="toggleCell(cell)"
                      @keydown.enter.prevent="toggleCell(cell)"
                      @keydown.space.prevent="toggleCell(cell)"
                    >
                      <span v-if="heatClass(cell)" class="slot-count">{{ cell.free.length }}/{{ totalParticipants }}</span>
                      <span v-else-if="cell.othersInClass.length" class="slot-baseline-text">
                        {{ cell.othersInClass.length === 1 ? '1 Class' : `${cell.othersInClass.length} Classes` }}
                      </span>
                      <span v-if="cell.mine" class="slot-you">You</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Right: sidebar -->
      <div class="col-lg-4">

        <!-- Not signed in as an ExCo -->
        <div v-if="!canUse" class="pulse-card p-4 shadow-sm">
          <h6 class="fw-bold mb-1">Schedule Meeting</h6>
          <p class="text-muted small mb-0">Sign in as a CCA ExCo to schedule meetings.</p>
        </div>

        <template v-else>

        <!-- ============ This week's meetings (a week can have several) ============ -->
        <div v-if="weekMeetings.length" class="pulse-card p-3 shadow-sm mb-4">
          <div class="small fw-bold text-muted text-uppercase mb-2">This week</div>
          <div class="d-flex flex-column gap-2">
            <button
              v-for="w in weekMeetings"
              :key="w.id"
              type="button"
              class="match-card text-start d-flex justify-content-between align-items-center gap-2"
              :class="{ selected: !showCreateForm && meeting && meeting.id === w.id }"
              :title="w.is_organiser ? 'Right-click to edit' : null"
              @click="selectMeeting(w.id)"
              @contextmenu.prevent="openMenu($event, w)"
            >
              <span class="small">
                <strong class="d-block">{{ w.title }}</strong>
                <span v-if="w.agenda" class="d-block agenda-preview">{{ w.agenda }}</span>
                <span v-if="w.status === 'CONFIRMED'" class="text-muted member-meta">
                  {{ shortLabel(parseISO(w.confirmed_date)) }}, {{ hourLabel(w.confirmed_start_hour) }} – {{ hourLabel(w.confirmed_end_hour) }}
                </span>
                <span v-else class="text-muted member-meta">Organised by {{ w.organiser_name }}</span>
              </span>
              <span class="pulse-badge" :class="statusBadge(w).cls">{{ statusBadge(w).label }}</span>
            </button>
          </div>
          <button
            v-if="!showCreateForm"
            type="button"
            class="btn btn-sm btn-pulse-outline w-100 mt-2 fw-bold"
            @click="openCreateForm"
          >
            + Schedule another meeting
          </button>
        </div>

        <!-- ============ Schedule a meeting ============ -->
        <div v-if="showCreateForm || !meeting" class="pulse-card p-4 shadow-sm">
          <template v-if="!showCreateForm">
            <h6 class="fw-bold mb-3">Schedule Meeting</h6>
            <button type="button" class="btn btn-pulse-primary w-100 py-2 fw-bold" @click="openCreateForm">
              Schedule Meeting
            </button>
          </template>

          <form v-else @submit.prevent="submitCreate">
            <div class="d-flex justify-content-between align-items-center mb-3">
              <h6 class="fw-bold mb-0">Schedule Meeting</h6>
              <button type="button" class="btn-close btn-sm" aria-label="Close" @click="showCreateForm = false"></button>
            </div>

            <label class="form-label small fw-bold text-muted mb-1" for="meetingTitle">Title</label>
            <input id="meetingTitle" v-model="form.title" type="text" maxlength="120" class="form-control form-control-sm mb-3" />

            <label class="form-label small fw-bold text-muted mb-1" for="meetingAgenda">Agenda (optional)</label>
            <textarea
              id="meetingAgenda"
              v-model="form.agenda"
              rows="3"
              maxlength="1000"
              class="form-control form-control-sm mb-3"
              placeholder="e.g. 1. Arts Fest run-of-show  2. Costume fittings  3. Budget"
            ></textarea>

            <label class="form-label small fw-bold text-muted mb-1" for="meetingWeek">Meeting week</label>
            <select id="meetingWeek" v-model="form.week" class="form-select form-select-sm mb-3">
              <option v-for="w in weekOptions" :key="w.value" :value="w.value">{{ w.label }}</option>
            </select>

            <div class="d-flex justify-content-between align-items-center mb-1">
              <span class="form-label small fw-bold text-muted mb-0">Participants</span>
              <span class="small text-muted">{{ selectedCount }} selected</span>
            </div>
            <div class="d-flex flex-wrap gap-1 mb-2">
              <button type="button" class="pulse-chip pulse-chip-sm border-0" @click="selectEveryone">Everyone</button>
              <button
                v-for="s in subcommittees"
                :key="s"
                type="button"
                class="pulse-chip pulse-chip-sm border-0"
                @click="selectSubcommittee(s)"
              >
                {{ s }}
              </button>
            </div>
            <div class="member-list border rounded-3 mb-3">
              <label
                v-for="m in roster"
                :key="m.member_id"
                class="d-flex align-items-center gap-2 px-2 py-1 member-row"
                :class="{ 'text-muted': m.is_me }"
              >
                <input
                  type="checkbox"
                  class="form-check-input mt-0"
                  :checked="m.is_me || isSelected(m.member_id)"
                  :disabled="m.is_me"
                  @change="toggleMember(m.member_id)"
                />
                <span class="small flex-grow-1">
                  <strong>{{ m.full_name }}</strong>{{ m.is_me ? ' (you)' : '' }}
                  <span class="d-block text-muted member-meta">{{ m.role_name }}{{ m.subcommittee ? ` · ${m.subcommittee}` : '' }}</span>
                </span>
              </label>
            </div>

            <label class="form-label small fw-bold text-muted mb-1" for="meetingDeadline">Voting deadline</label>
            <input
              id="meetingDeadline"
              v-model="form.deadline"
              type="datetime-local"
              class="form-control form-control-sm mb-3"
              :min="deadlineMin"
              :max="deadlineMax"
              required
            />

            <button type="submit" class="btn btn-pulse-primary w-100 py-2 fw-bold" :disabled="isSubmitting">
              <span v-if="isSubmitting" class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>
              Send Meeting Request
            </button>
          </form>
        </div>

        <!-- ============ Collecting availability / expired ============ -->
        <template v-else-if="isOpenRequest">
          <div class="pulse-card p-4 shadow-sm mb-4">
            <div class="d-flex justify-content-between align-items-start gap-2 mb-1">
              <h6 class="fw-bold mb-0">{{ meeting.title }}</h6>
              <span class="pulse-badge flex-shrink-0 text-nowrap" :class="votingOpen ? 'pulse-badge-pending' : 'pulse-badge-rejected'">
                {{ votingOpen ? 'Collecting' : 'Voting closed' }}
              </span>
            </div>
            <div class="text-muted small" :class="meeting.agenda ? 'mb-2' : 'mb-3'">Organised by {{ meeting.organiser_name }}</div>
            <div v-if="meeting.agenda" class="agenda-box rounded-3 p-2 mb-3">
              <div class="small fw-bold text-muted text-uppercase mb-1">Agenda</div>
              <div class="small agenda-text">{{ meeting.agenda }}</div>
            </div>

            <div class="deadline-box rounded-3 p-3 mb-3" :class="{ urgent: votingOpen && secondsLeft < 3600 }">
              <div class="small fw-bold text-muted text-uppercase">{{ votingOpen ? 'Voting closes in' : 'Voting closed' }}</div>
              <div v-if="votingOpen" class="countdown">{{ countdownText }}</div>
              <div class="small text-muted">{{ deadlineLabel(meeting.vote_deadline) }}</div>
              <p class="small mb-0 mt-2" role="status">
                {{ votingOpen ? 'Submit your availability before the deadline. Responses cannot be added or changed afterward.' : 'Voting has closed. Responses can no longer be added or changed. The organiser can still confirm the meeting.' }}
              </p>
            </div>

            <template v-if="amParticipant">
              <p v-if="canVote" class="small text-muted mb-3">Click to mark all days as unavailable. Use Undo to clear this response and choose available times.</p>
              <div class="d-flex justify-content-between align-items-center gap-3 small">
                <span class="text-muted">Your response</span>
                <strong :class="myResponse?.responded_at ? 'text-success' : 'text-muted'">
                  {{ myResponse?.responded_at ? (mySlotCount ? `${mySlotCount} hour${mySlotCount === 1 ? '' : 's'} free` : 'None of these days work') : 'No response yet' }}
                </strong>
              </div>
              <button
                v-if="canVote && myResponse?.responded_at"
                type="button"
                class="btn btn-outline-secondary bg-white text-secondary w-100 py-2 fw-bold mt-2"
                :disabled="responseSaving"
                @click="undoResponse()"
              >
                {{ responseSaving ? 'Saving...' : 'Undo' }}
              </button>
            </template>
          </div>

          <!-- Unconfirmed participants -->
          <div class="pulse-card p-4 shadow-sm mb-4">
            <div class="d-flex justify-content-between align-items-center mb-2">
              <h6 class="fw-bold mb-0">{{ votingOpen ? 'Unconfirmed' : 'No response' }}</h6>
              <span class="pulse-badge" :class="pending.length ? 'pulse-badge-pending' : 'pulse-badge-confirmed'">
                {{ pending.length }} of {{ totalParticipants }} {{ votingOpen ? 'pending' : 'didn’t respond' }}
              </span>
            </div>

            <p v-if="!pending.length" class="small text-success fw-semibold mb-0">Everyone has responded.</p>

            <div v-else class="d-flex flex-column gap-2">
              <div
                v-for="p in pending"
                :key="p.member_id"
                class="d-flex justify-content-between align-items-center gap-2 p-2 rounded-3 bg-light border"
              >
                <div class="small">
                  <strong class="d-block">{{ p.full_name }}{{ p.member_id === myId ? ' (you)' : '' }}</strong>
                  <span v-if="p.telegram_linked === true && recentlyNudged(p)" class="d-block text-success fw-semibold member-meta">{{ nudgedText(p) }}</span>
                  <span v-if="p.telegram_linked === false" class="member-meta member-warning">
                    <svg class="member-warning-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M10.3 3.9 2.1 18.1a2 2 0 0 0 1.7 3h16.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
                      <path d="M12 9v4" />
                      <path d="M12 17h.01" />
                    </svg>
                    <span>This member has not verified their Telegram account.</span>
                  </span>
                  <span v-if="recentlyNudged(p)" class="d-block text-success fw-semibold member-meta">{{ nudgedText(p) }}</span>
                  <!-- Only matters to the person who can nudge them, and only while voting is open -->
                  <span v-if="isOrganiser && votingOpen && !p.telegram_linked" class="d-block text-muted member-meta">Telegram not linked</span>
                </div>
                <button
                  v-if="isOrganiser && votingOpen && p.member_id !== myId && p.telegram_linked === true"
                  type="button"
                  class="btn btn-sm btn-pulse-outline py-1 px-2 fw-bold nudge-btn"
                  :disabled="nudging !== null || recentlyNudged(p)"
                  @click="nudge(p.member_id)"
                >
                  <span v-if="nudging === p.member_id" class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>
                  {{ recentlyNudged(p) ? 'Nudged ✓' : 'Nudge via Telegram' }}
                </button>
              </div>

              <button
                v-if="isOrganiser && votingOpen"
                type="button"
                class="btn btn-outline-secondary btn-sm w-100 py-2 fw-bold mt-1"
                :disabled="nudging !== null || !nudgeablePending.length || allPendingNudged"
                @click="nudge(null)"
              >
                <span v-if="nudging === 'all'" class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>
                {{ allPendingNudged ? 'All pending participants nudged ✓' : 'Nudge Pending Participants' }}
              </button>
            </div>
          </div>

          <!-- Choose the day & confirm -->
          <div class="pulse-card p-4 shadow-sm">
            <template v-if="isOrganiser">
              <template v-if="!showConfirmForm">
                <button
                  type="button"
                  class="btn btn-pulse-primary w-100 py-2 fw-bold"
                  :disabled="!meeting.can_confirm || readOnly"
                  @click="openConfirmForm"
                >
                  Choose Meeting Day &amp; Confirm
                </button>
                <p v-if="confirmBlockedReason" class="small text-muted text-center mt-2 mb-0">{{ confirmBlockedReason }}</p>
              </template>

              <form v-else @submit.prevent="submitConfirm">
                <div class="d-flex justify-content-between align-items-center mb-2">
                  <h6 class="fw-bold mb-0">Choose Meeting Day</h6>
                  <button type="button" class="btn-close btn-sm" aria-label="Close" @click="showConfirmForm = false"></button>
                </div>

                <div v-if="bestTimes.length" class="mb-3">
                  <div class="small fw-bold text-muted mb-1">Best times</div>
                  <div class="d-flex flex-column gap-2">
                    <button
                      v-for="w in bestTimes"
                      :key="w.date + w.start"
                      type="button"
                      class="match-card text-start"
                      :class="{ selected: isPicked(w) }"
                      @click="usePick(w)"
                    >
                      <div class="fw-bold small">{{ w.label }}</div>
                      <div class="small">{{ hourLabel(w.start) }} – {{ hourLabel(w.end) }} · {{ w.free }}/{{ totalParticipants }} free</div>
                    </button>
                  </div>
                </div>
                <p v-else class="small text-muted">Nobody marked any free hours. Pick a time below.</p>

                <div class="row g-2 mb-2">
                  <div class="col-12">
                    <label class="form-label small fw-bold text-muted mb-1" for="pickDate">Day</label>
                    <select id="pickDate" v-model="pick.date" class="form-select form-select-sm">
                      <option v-for="day in weekDates" :key="toISO(day)" :value="toISO(day)">{{ longLabel(day) }}</option>
                    </select>
                  </div>
                  <div class="col-6">
                    <label class="form-label small fw-bold text-muted mb-1" for="pickStart">From</label>
                    <select id="pickStart" v-model.number="pick.start" class="form-select form-select-sm">
                      <option v-for="h in HOURS" :key="h" :value="h">{{ hourLabel(h) }}</option>
                    </select>
                  </div>
                  <div class="col-6">
                    <label class="form-label small fw-bold text-muted mb-1" for="pickEnd">To</label>
                    <select id="pickEnd" v-model.number="pick.end" class="form-select form-select-sm">
                      <option v-for="h in endHourOptions" :key="h" :value="h">{{ hourLabel(h) }}</option>
                    </select>
                  </div>
                  <div class="col-12">
                    <label class="form-label small fw-bold text-muted mb-1" for="pickVenue">Venue (optional)</label>
                    <input id="pickVenue" v-model="pick.venue" type="text" maxlength="120" class="form-control form-control-sm" placeholder="e.g. SMU Connexion Meeting Room 3" />
                  </div>
                </div>
                <p class="small mb-3" :class="pickFreeCount === totalParticipants ? 'text-success' : 'text-warning-emphasis'">
                  {{ pickFreeCount }}/{{ totalParticipants }} free for the whole window
                </p>

                <button type="submit" class="btn btn-pulse-primary w-100 py-2 fw-bold" :disabled="isSubmitting">
                  <span v-if="isSubmitting" class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>
                  Confirm &amp; Notify Participants
                </button>
              </form>

              <button type="button" class="btn btn-link btn-sm text-danger w-100 mt-2 text-decoration-none" @click="cancelRequest">
                Cancel meeting request
              </button>
            </template>

            <p v-else class="small text-muted mb-0">
              {{ meeting.organiser_name }} can confirm the meeting time once everyone has responded or the voting deadline has passed.
            </p>
          </div>
        </template>

        <!-- ============ Confirmed ============ -->
        <div v-else-if="isConfirmed" class="pulse-card p-4 shadow-sm">
          <div class="d-flex justify-content-between align-items-start gap-2 mb-2">
            <h6 class="fw-bold mb-0">{{ meeting.title }}</h6>
            <span class="pulse-badge pulse-badge-confirmed">Confirmed</span>
          </div>
          <div class="confirmed-box rounded-3 p-3 mb-3">
            <div class="fw-bold">{{ longLabel(parseISO(meeting.confirmed_date)) }}</div>
            <div>{{ hourLabel(meeting.confirmed_start_hour) }} – {{ hourLabel(meeting.confirmed_end_hour) }}</div>
            <div v-if="meeting.venue" class="small text-muted mt-1">{{ meeting.venue }}</div>
          </div>
          <div v-if="meeting.agenda" class="agenda-box rounded-3 p-2 mb-3">
            <div class="small fw-bold text-muted text-uppercase mb-1">Agenda</div>
            <div class="small agenda-text">{{ meeting.agenda }}</div>
          </div>
          <div class="small text-muted mb-3">
            Organised by {{ meeting.organiser_name }} · {{ totalParticipants }} participants
          </div>
          <button type="button" class="btn btn-sm btn-pulse-outline w-100" @click="exportConfirmed">
            Add to Calendar (.ics)
          </button>
        </div>

        </template>

      </div>
    </div>

    <!-- Right-click menu on a meeting -->
    <div
      v-if="menu.open"
      class="meeting-menu shadow rounded-3"
      role="menu"
      :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
      @click.stop
      @contextmenu.prevent
    >
      <div class="meeting-menu-title text-truncate">{{ menu.meeting.title }}</div>
      <button type="button" role="menuitem" class="meeting-menu-item" :disabled="!menuRules.people" @click="startEdit('people')">
        Edit participants
        <span v-if="!menuRules.people" class="meeting-menu-why">{{ menuRules.peopleWhy }}</span>
      </button>
      <button type="button" role="menuitem" class="meeting-menu-item" :disabled="!menuRules.agenda" @click="startEdit('agenda')">
        Edit agenda
        <span v-if="!menuRules.agenda" class="meeting-menu-why">{{ menuRules.agendaWhy }}</span>
      </button>
    </div>

    <!-- Edit participants / agenda -->
    <template v-if="editing && editMeeting">
      <div class="modal-backdrop fade show edit-backdrop" @click="closeEdit"></div>
      <div class="modal fade show d-block" tabindex="-1" role="dialog" aria-modal="true" style="z-index: 1060;" @click.self="closeEdit">
        <div class="modal-dialog modal-dialog-centered">
          <form class="modal-content border-0 shadow-lg rounded-4" style="background-color: var(--pulse-card-bg);" @submit.prevent="saveEdit">
            <div class="modal-header px-4 py-3">
              <div>
                <h6 class="modal-title fw-bold mb-0">{{ editing === 'people' ? 'Edit participants' : 'Edit agenda' }}</h6>
                <div class="small text-muted">{{ editMeeting.title }}</div>
              </div>
              <button type="button" class="btn-close" aria-label="Close" @click="closeEdit"></button>
            </div>

            <div class="modal-body px-4">
              <template v-if="editing === 'people'">
                <div class="d-flex justify-content-between align-items-center mb-1">
                  <span class="small fw-bold text-muted">Participants</span>
                  <span class="small text-muted">{{ editSelectedCount }} selected</span>
                </div>
                <div class="d-flex flex-wrap gap-1 mb-2">
                  <button type="button" class="pulse-chip pulse-chip-sm border-0" @click="editMemberIds = roster.map((m) => m.member_id)">Everyone</button>
                  <button
                    v-for="s in subcommittees"
                    :key="s"
                    type="button"
                    class="pulse-chip pulse-chip-sm border-0"
                    @click="editSelectSubcommittee(s)"
                  >
                    {{ s }}
                  </button>
                </div>
                <div class="member-list border rounded-3">
                  <label
                    v-for="m in roster"
                    :key="m.member_id"
                    class="d-flex align-items-center gap-2 px-2 py-1 member-row"
                    :class="{ 'text-muted': m.is_me }"
                  >
                    <input
                      type="checkbox"
                      class="form-check-input mt-0"
                      :checked="m.is_me || editMemberIds.includes(m.member_id)"
                      :disabled="m.is_me"
                      @change="toggleEditMember(m.member_id)"
                    />
                    <span class="small flex-grow-1">
                      <strong>{{ m.full_name }}</strong>{{ m.is_me ? ' (you)' : '' }}
                      <span class="d-block text-muted member-meta">{{ m.role_name }}{{ m.subcommittee ? ` · ${m.subcommittee}` : '' }}</span>
                    </span>
                  </label>
                </div>
                <p class="small text-muted mt-2 mb-0">People you add get the request on Telegram. People you remove lose their votes.</p>
              </template>

              <template v-else>
                <label class="form-label small fw-bold text-muted mb-1" for="editAgenda">Agenda</label>
                <textarea id="editAgenda" v-model="editAgenda" rows="5" maxlength="1000" class="form-control form-control-sm"></textarea>
                <p class="small text-muted mt-2 mb-0">Participants are notified in Pulse. Leave empty to remove the agenda.</p>
              </template>
            </div>

            <div class="modal-footer px-4 py-3">
              <button type="button" class="btn btn-sm btn-outline-secondary" @click="closeEdit">Cancel</button>
              <button type="submit" class="btn btn-sm btn-pulse-primary px-3 fw-bold" :disabled="isSaving">
                <span v-if="isSaving" class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>
                Save
              </button>
            </div>
          </form>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.scheduler-grid { min-width: 640px; table-layout: fixed; }
/* Your own class: striped darker grey (others' classes are plain light grey, see .slot-baseline) */
.pulse-class-pill {
  overflow: hidden;
  padding: 0 0.25rem;
  background: repeating-linear-gradient(135deg, #e2e8f0 0 6px, #cbd5e1 6px 12px);
  border-color: #94a3b8;
}
/* Not clickable: you're in class. Undo the shared pill's hover so it doesn't look pressable. */
.pulse-class-pill { cursor: not-allowed; user-select: none; }
.pulse-class-pill:hover {
  background: repeating-linear-gradient(135deg, #e2e8f0 0 6px, #cbd5e1 6px 12px);
  border-color: #94a3b8;
}
.pulse-class-pill .pulse-class-name { background: rgba(255, 255, 255, 0.85); border-radius: 0.35rem; padding: 0 0.3rem; }
.slot-class-extra { font-size: 0.58rem; font-weight: 700; color: #64748b; white-space: nowrap; }
/* Make room for the "+N in class" tag: one line of class name */
.pulse-class-pill:has(.slot-class-extra) .pulse-class-name { -webkit-line-clamp: 1; line-clamp: 1; }
.pulse-class-name { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; }
.scheduler-grid .time-col { width: 64px; font-size: 0.7rem; }
.scheduler-grid .day-col { font-size: 0.75rem; line-height: 1.2; }
.scheduler-grid td { height: 3.1rem; }

/* One hour slot. White when nobody is free, grey when others have class,
   red / amber / green by the share of participants who are free. */
.slot {
  height: 2.75rem;
  width: 100%;
  border: 1px solid var(--pulse-border, #e2e8f0);
  background: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}
.slot-clickable { cursor: pointer; }
.slot-clickable:hover { border-color: #16a34a; }

.avail-red   { background: #f6dcdc; color: #a35555; border-color: #f0c4c4; }
.avail-amber { background: #fbf1cc; color: #8a6a14; border-color: #f3e2a0; }
.avail-green { background: #d9efe0; color: #3d7a52; border-color: #bfe3cb; }
.avail-all   { background: #16a34a; color: #fff; border-color: #16a34a; }

.slot-baseline { background: #f1f5f9; border-color: #cbd5e1; }
.slot-baseline-text { font-size: 0.68rem; font-weight: 800; color: #475569; }

.slot-mine {
  outline: 2px solid #334155;
  outline-offset: -2px;
}
.slot-count { font-size: 0.72rem; font-weight: 800; color: inherit; }
.slot-you {
  position: absolute;
  top: 2px;
  right: 3px;
  font-size: 0.5rem;
  font-weight: 800;
  color: var(--pulse-primary, #e11d48);
}
.slot-you { color: #334155; }
.avail-all .slot-you { color: #fff; }

.slot-meeting {
  background: var(--pulse-primary, #e11d48);
  border-color: var(--pulse-primary, #e11d48);
  color: #fff;
  padding: 0 0.25rem;
}
.slot-name {
  font-size: 0.65rem;
  font-weight: 800;
  line-height: 1.1;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
}

.legend { font-size: 0.7rem; font-weight: 700; color: #475569; }
.legend > span { display: inline-flex; align-items: center; gap: 0.25rem; }
.legend-swatch {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 3px;
  border: 1px solid #e2e8f0;
}
.swatch-own-class { background: repeating-linear-gradient(135deg, #e2e8f0 0 3px, #cbd5e1 3px 6px); border-color: #94a3b8; }
.swatch-class { background: #f1f5f9; border-color: #cbd5e1; }
.swatch-empty { background: #fff; }
.swatch-meeting { background: var(--pulse-primary, #e11d48); border-color: var(--pulse-primary, #e11d48); }

.member-list { max-height: 220px; overflow-y: auto; }
.member-row { cursor: pointer; border-bottom: 1px solid #f1f5f9; }
.member-row:last-child { border-bottom: 0; }
.member-meta { font-size: 0.68rem; }
.member-warning { display: flex; align-items: flex-start; gap: 0.5rem; margin-top: 0.25rem; color: #6b7280; }
.member-warning-icon { flex-shrink: 0; margin-top: 0.05rem; color: #f97316; }
.nudge-btn { font-size: 0.7rem; white-space: nowrap; }

.deadline-box { background: var(--pulse-amber-bg, #fffbeb); border: 1px solid var(--pulse-amber-border, #fde68a); }
.deadline-box.urgent { background: var(--pulse-primary-light, #fff1f2); border-color: var(--pulse-primary-border, #fecdd3); }
.countdown {
  font-size: 1.6rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}
.deadline-box.urgent .countdown { color: var(--pulse-primary, #e11d48); }

.agenda-preview {
  font-size: 0.7rem;
  color: #475569;
  white-space: pre-line;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  margin: 1px 0 2px;
}
.agenda-box { background: #f8fafc; border: 1px solid #e2e8f0; }
.agenda-text { white-space: pre-line; overflow-wrap: anywhere; }

.confirmed-box { background: var(--pulse-green-bg, #f0fdf4); border: 1px solid var(--pulse-green-border, #bbf7d0); }

.match-card {
  border: 1px solid #e2e8f0;
  border-radius: 0.75rem;
  padding: 0.6rem 0.75rem;
  background: var(--pulse-card-bg, #fff);
  transition: border-color 0.15s ease, background-color 0.15s ease;
}
.match-card:hover { border-color: #86efac; }
.match-card.selected { border-color: #16a34a; background: rgba(22, 163, 74, 0.08); }

/* Right-click menu on a meeting */
.meeting-menu {
  position: fixed;
  z-index: 1070;
  width: 230px;
  padding: 0.35rem;
  background: var(--pulse-card-bg, #fff);
  border: 1px solid var(--pulse-border, #e2e8f0);
}
.meeting-menu-title {
  font-size: 0.7rem;
  font-weight: 800;
  color: #64748b;
  text-transform: uppercase;
  padding: 0.25rem 0.5rem 0.35rem;
}
.meeting-menu-item {
  display: block;
  width: 100%;
  text-align: left;
  border: 0;
  background: transparent;
  border-radius: 0.5rem;
  padding: 0.4rem 0.5rem;
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--pulse-ink, #0f172a);
}
.meeting-menu-item:hover:not(:disabled) { background: var(--pulse-primary-light, #fff1f2); color: var(--pulse-primary, #e11d48); }
.meeting-menu-item:disabled { color: #94a3b8; cursor: not-allowed; }
.meeting-menu-why { display: block; font-size: 0.65rem; font-weight: 600; }
.edit-backdrop { background: rgba(15, 23, 42, 0.55); z-index: 1055; }
.slot-past { cursor: not-allowed !important; }
</style>
