<script setup>
// Purpose: The Event Risk page users see. Pip asks one question at a time, every choice
// comes from the loaded event data, and the answer is the simulation engine's own result
// (impact summary + ranked recovery plans). Requests, Apply and Undo run through the
// recovery workflow kept underneath (workflow / workflowAct props).
import { ref, computed, nextTick, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../supabase'
import SimulatorDisruptionInterval from './SimulatorDisruptionInterval.vue'
import { activityKey } from '../services/simulatorActivityGroups.js'
import { singaporeLocal } from '../services/disruptionScheduleService.js'

const props = defineProps({
  data: { type: Object, default: () => ({}) },
  events: { type: Array, default: () => [] },
  selectedEventId: { type: [String, Number], default: '' },
  selectedEvent: { type: Object, default: null },
  members: { type: Array, default: () => [] },
  bookings: { type: Array, default: () => [] },
  activities: { type: Array, default: () => [] },
  plans: { type: Array, default: () => [] },
  summary: { type: String, default: '' },
  error: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  workflow: { type: Object, default: null },
  workflowAct: { type: Function, default: null }
})

const emit = defineEmits(['select-event', 'run', 'use-plan', 'reset'])

const messages = ref([])
const step = ref('')
const draft = ref({})
const query = ref('')
// Long lists show 6 at first; typing in the chat box filters them
const LIST_LIMIT = 6
const showAll = ref(false)
const chatContainer = ref(null)
// Where each asked step starts in the message log, so Back can rewind it
const history = ref([])
let runCount = 0
// The current run's plans in display order, for "try the next person" after a decline
let lastPlans = []
// The fix Pip is following through: { id, optionId, planId, title, type, delayMinutes }
const fix = ref(null)
const router = useRouter()

const TYPES = [
  { id: 'MEMBER_UNAVAILABLE', icon: '🤒', label: "Someone can't come", sub: 'Find who can cover their tasks', keywords: 'sick ill absent member person crew replace' },
  { id: 'FACILITY_UNAVAILABLE', icon: '🏛️', label: "A room can't be used", sub: 'Find another room that is free', keywords: 'room venue facility hall studio broken booking' },
  { id: 'SCHEDULE_DELAY', icon: '⏱️', label: 'Something is running late', sub: 'See what gets pushed back', keywords: 'late delay delayed behind overrun' }
]
const DELAYS = [15, 30, 45, 60]

const now = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
// Singapore time as "10:30 AM"
const clock = value => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('en-SG', { timeZone: 'Asia/Singapore', hour: 'numeric', minute: '2-digit' }).toUpperCase()
}
// "10:30–11:00 AM", or "11:30 AM–12:30 PM" when it crosses noon
function span(a, b) {
  const from = clock(a), to = clock(b)
  if (!from || !to) return from || to
  return from.slice(-2) === to.slice(-2) ? `${from.slice(0, -3)}–${to}` : `${from}–${to}`
}
const same = (a, b) => String(a) === String(b)
const eventName = computed(() => props.selectedEvent?.name || 'this event')
const memberName = id => props.data?.members?.find(m => same(m.id, id))?.full_name || 'Someone'
const segment = id => props.data?.event_segments?.find(s => same(s.id, id))

function scrollToBottom() {
  nextTick(() => {
    if (chatContainer.value) chatContainer.value.scrollTop = chatContainer.value.scrollHeight
  })
}
function say(text, extra = {}) {
  const id = Date.now() + Math.random()
  messages.value.push({ id, sender: 'assistant', text, timestamp: now(), ...extra })
  scrollToBottom()
  return id
}
// Long replies (the options) scroll to their start, so the summary and first option are in view
function scrollToMessage(id) {
  nextTick(() => {
    const box = chatContainer.value, el = box?.querySelector(`[data-msg-id="${id}"]`)
    if (box && el) box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - 12
  })
}
function answer(text) {
  messages.value.push({ id: Date.now() + Math.random(), sender: 'user', text, timestamp: now() })
  scrollToBottom()
}

// ---- Questions ----
const QUESTIONS = {
  event: () => 'Which event is this about?',
  type: () => `What went wrong at ${eventName.value}?`,
  member: () => "Who can't make it?",
  facility: () => "Which room or venue can't be used?",
  time: () => draft.value.type === 'MEMBER_UNAVAILABLE'
    ? `When is ${memberName(draft.value.memberId)} unavailable?`
    : `When can't ${draft.value.venueName || 'the room'} be used?`,
  activity: () => 'Which activity is running late?',
  minutes: () => `How late is ${segment(draft.value.segmentId)?.title || 'it'}?`
}
function ask(next) {
  step.value = next
  query.value = ''
  showAll.value = false
  history.value.push({ step: next, at: messages.value.length })
  say(QUESTIONS[next]())
}
function back() {
  history.value.pop()
  const previous = history.value.pop()
  if (!previous) return
  messages.value.splice(previous.at)
  ask(previous.step)
}

// ---- Choices for the current step (all from the loaded event) ----
const choices = computed(() => {
  if (step.value === 'event') {
    // The open event first, then upcoming (soonest first), then past (most recent first)
    const now = Date.now(), end = e => Date.parse(e.ends_at), start = e => Date.parse(e.starts_at)
    const rank = e => same(e.id, props.selectedEventId) ? 0 : end(e) >= now ? 1 : 2
    const day = e => Number.isFinite(start(e)) ? new Date(e.starts_at).toLocaleDateString('en-SG', { timeZone: 'Asia/Singapore', weekday: 'short', day: 'numeric', month: 'short' }) : ''
    return [...props.events]
      .sort((a, b) => rank(a) - rank(b) || (rank(a) === 2 ? start(b) - start(a) : start(a) - start(b)))
      .map(e => ({
        id: e.id, label: e.name,
        sub: [e.source_table === 'ops_events' ? 'Day Ops' : 'Saved event', day(e), same(e.id, props.selectedEventId) ? 'open now' : end(e) < now ? 'past' : ''].filter(Boolean).join(' · ')
      }))
  }
  if (step.value === 'type') return TYPES.map(t => ({
    ...t,
    disabled: t.id === 'MEMBER_UNAVAILABLE' ? !props.members.length : t.id === 'FACILITY_UNAVAILABLE' ? !props.bookings.length : !props.activities.some(a => !a.is_fixed)
  }))
  if (step.value === 'member') return props.members.map(m => ({ id: m.id, label: m.full_name }))
  if (step.value === 'facility') return props.bookings.map(b => ({
    id: b.id, label: b.venue_name, sub: [b.time_slot, b.venue_only ? 'not booked through Pulse' : b.status].filter(Boolean).join(' · ')
  }))
  // In run-of-show order, each with its time slot
  if (step.value === 'activity') return [...props.activities]
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
    .map(a => ({
      id: a.id, label: a.title,
      sub: span(a.starts_at, a.ends_at) + (a.ids.length > 1 ? ` · ${a.ids.length} crew` : '') + (a.is_fixed ? ' · fixed time' : ''),
      disabled: a.is_fixed
    }))
  return []
})
const matches = computed(() => {
  const text = String(query.value).trim().toLowerCase()
  return text ? choices.value.filter(c => [c.label, c.sub, c.keywords].join(' ').toLowerCase().includes(text)) : choices.value
})
// Activities always show in full so the run of show reads top to bottom
const shownChoices = computed(() => showAll.value || step.value === 'activity' || String(query.value).trim() ? matches.value : matches.value.slice(0, LIST_LIMIT))
const hiddenCount = computed(() => matches.value.length - shownChoices.value.length)
// The chat box searches whatever Pip is asking about; the hint follows the question
const HINTS = {
  event: 'Type an event name…',
  type: 'Type e.g. "sick", "room" or "late"…',
  member: 'Type a name, e.g. Mei…',
  facility: 'Type a room or venue…',
  activity: 'Type an activity…',
  minutes: 'Type the minutes late, e.g. 20…',
  time: 'Use the time boxes above',
  done: 'Pick an option above'
}
const canType = computed(() => choices.value.length > 0 || step.value === 'minutes')
const placeholder = computed(() => HINTS[step.value] || 'Pick an option above')

async function choose(choice) {
  if (choice.disabled) return
  if (step.value === 'event') {
    answer(choice.label)
    if (!same(choice.id, props.selectedEventId)) {
      emit('select-event', choice.id)
      // The sandbox resets its cards for the new event on the next tick
      await nextTick(); await nextTick()
    }
    ask('type')
  } else if (step.value === 'type') {
    answer(choice.icon + ' ' + choice.label)
    draft.value = { type: choice.id, start: '', end: '', delayMinutes: 30 }
    ask(choice.id === 'MEMBER_UNAVAILABLE' ? 'member' : choice.id === 'FACILITY_UNAVAILABLE' ? 'facility' : 'activity')
  } else if (step.value === 'member') {
    answer(choice.label)
    draft.value.memberId = choice.id
    ask('time')
  } else if (step.value === 'facility') {
    answer(choice.label + (choice.sub ? ` (${choice.sub})` : ''))
    draft.value.facilityBookingId = choice.id
    draft.value.venueName = choice.label
    ask('time')
  } else if (step.value === 'activity') {
    answer(choice.label + ' · ' + choice.sub)
    draft.value.segmentId = choice.id
    ask('minutes')
  }
}

// Send picks the only match (or, for "how late", the typed minutes)
function submitTyped() {
  const text = String(query.value).trim()
  if (!text) return
  if (step.value === 'minutes') {
    const minutes = Number(text)
    if (Number.isInteger(minutes) && minutes > 0 && minutes <= 1440) chooseDelay(minutes)
    else say('Type a whole number of minutes between 1 and 1440.')
    return
  }
  if (matches.value.length === 1) choose(matches.value[0])
  else if (!matches.value.length) say(`I couldn't find "${text}". Try a shorter word, or tap one of the options.`)
  else say(`A few options match "${text}". Tap the one you mean.`)
}

// ---- Time / delay answers ----
function wholeEvent() {
  draft.value.start = singaporeLocal(props.selectedEvent?.starts_at)
  draft.value.end = singaporeLocal(props.selectedEvent?.ends_at)
  draft.value.intervalMode = 'event'
  confirmTime()
}
function confirmTime() {
  if (!draft.value.start || !draft.value.end) {
    say('Fill in both the From and Until times first (or tap "Whole event").')
    return
  }
  answer(draft.value.intervalMode === 'event' ? 'The whole event' : `${clock(draft.value.start + '+08:00')} – ${clock(draft.value.end + '+08:00')}`)
  run()
}
function chooseDelay(minutes) {
  draft.value.delayMinutes = minutes
  answer(minutes + ' min late')
  run()
}

// ---- Run the sandbox engine and describe its real result ----
function lines(plan) {
  const swaps = new Map(), rooms = new Map(), times = new Map()
  for (const c of plan.changes || []) {
    const seg = segment(c.segmentId), key = seg ? activityKey(seg) : String(c.segmentId)
    if (c.replacementMemberId != null) {
      const k = c.replacedMemberId + '>' + c.replacementMemberId
      if (!swaps.has(k)) swaps.set(k, { from: memberName(c.replacedMemberId), to: memberName(c.replacementMemberId), acts: new Set() })
      swaps.get(k).acts.add(key)
    }
    if (c.venueName) {
      if (!rooms.has(c.venueName)) rooms.set(c.venueName, new Set())
      rooms.get(c.venueName).add(key)
    }
    if (c.starts_at || c.ends_at) {
      times.set(key, `${seg?.title || 'Activity'}: now ${span(c.starts_at || seg?.starts_at, c.ends_at || seg?.ends_at)}`)
    }
  }
  return [
    ...[...swaps.values()].map(s => `👤 ${s.from} → ${s.to} (${s.acts.size} ${s.acts.size === 1 ? 'task' : 'tasks'})`),
    ...[...rooms].map(([venue, acts]) => `🏛️ Move to ${venue}${plan.availability ? ' · ' + plan.availability : ''} (${acts.size} ${acts.size === 1 ? 'activity' : 'activities'})`),
    ...[...times.values()].map(t => '⏱️ ' + t)
  ]
}
const statusLabel = status => status === 'FEASIBLE' ? 'Checks passed · needs approval' : status === 'INFEASIBLE' ? 'Has conflicts to sort out' : 'Needs review'
// Short trade-off tags from the plan's own data: downsides first, then "No clashes".
// Who covers what is already in the change lines below the tags.
function tags(plan, onlyOption, workload) {
  const downsides = []
  const clashes = Array.isArray(plan.conflicts) ? plan.conflicts.length : 0
  if (clashes) downsides.push(`⚠️ ${clashes} ${clashes === 1 ? 'clash' : 'clashes'} left`)
  if (plan.availability && !/whole time/i.test(plan.availability)) downsides.push('🏛️ ' + plan.availability)
  if (plan.leftover?.length) downsides.push(`🏛️ ${plan.leftover.length} still need a room`)
  const shifts = new Map()
  for (const c of plan.changes || []) {
    const seg = segment(c.segmentId)
    if (!seg || !(c.starts_at || c.ends_at)) continue
    shifts.set(activityKey(seg), c.starts_at ? Math.round((Date.parse(c.starts_at) - Date.parse(seg.starts_at)) / 60000) : 0)
  }
  if (shifts.size) {
    const moves = [...new Set(shifts.values())], n = shifts.size, what = n === 1 ? '1 activity' : n + ' activities'
    downsides.push(moves.length === 1 && moves[0] > 0 ? `⏱️ ${what} ${n === 1 ? 'moves' : 'move'} ${moves[0]} min later`
      : moves.length === 1 && moves[0] === 0 ? `⏱️ ${what} ${n === 1 ? 'ends' : 'end'} earlier` : `⏱️ ${what} change time`)
  }
  if ((plan.changes || []).some(c => c.venueName)) downsides.push('⏳ Needs room approval')
  const upsides = [...(workload ? [workload] : []), ...(clashes ? [] : ['✅ No clashes'])]
  // Nothing to weigh up when it's the only option and has no downsides
  if (onlyOption && !downsides.length) return []
  return [...downsides, ...upsides].slice(0, 3)
}
// How busy the replacement already is on the event's day (distinct activities), to tell tied people apart
const sgDate = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date(value))
function tasksToday(memberId) {
  const day = props.selectedEvent?.starts_at ? sgDate(props.selectedEvent.starts_at) : ''
  const keys = new Set()
  for (const a of props.data?.segment_assignments || []) {
    if (!same(a.member_id, memberId)) continue
    const seg = segment(a.segment_id)
    if (seg && day && sgDate(seg.starts_at) === day) keys.add(activityKey(seg))
  }
  return keys.size
}
const replacements = plan => [...new Set((plan.changes || []).filter(c => c.replacementMemberId != null).map(c => String(c.replacementMemberId)))]
function workloadTag(plan) {
  const [only, ...more] = replacements(plan)
  if (!only || more.length) return ''
  const n = tasksToday(only)
  return n ? `📋 ${n} other ${n === 1 ? 'task' : 'tasks'} today` : '📋 No other tasks today'
}
// Plans with the same status and score are a tie: put the least busy replacement first (display order only)
function orderTies(plans) {
  const load = plan => { const [only] = replacements(plan); return only ? tasksToday(only) : 0 }
  return plans.map((plan, i) => ({ plan, i, load: load(plan) }))
    .sort((a, b) => (a.plan.status === b.plan.status && a.plan.score === b.plan.score ? a.load - b.load : 0) || a.i - b.i)
    .map(row => row.plan)
}
const describe = (plan, i, all) => ({
  id: plan.id, title: plan.title, score: plan.score, status: statusLabel(plan.status), lines: lines(plan),
  tags: tags(plan, all.length === 1, workloadTag(plan)),
  tied: all.length > 1 && all.some((other, j) => j !== i && other.score === plan.score && other.status === plan.status)
})

async function run() {
  step.value = 'running'
  emit('run', { ...draft.value })
  await nextTick()
  if (props.error) {
    say(`I couldn't run that: ${props.error}`)
    // Let them fix the answer that caused it
    const retry = draft.value.type === 'SCHEDULE_DELAY' ? 'minutes' : 'time'
    step.value = retry
    return
  }
  const runId = ++runCount
  lastPlans = orderTies(props.plans)
  const top = lastPlans.slice(0, 3)
  scrollToMessage(say(props.summary || 'Here is what the simulation found.', {
    kind: 'result', runId,
    options: top.map(describe)
  }))
  step.value = 'done'
}

// ---- After choosing: what changes, then the requests, Apply and Undo ----
// One line per activity, only what changes for it
function changeList(plan) {
  const rows = new Map()
  for (const c of plan.changes || []) {
    const seg = segment(c.segmentId), key = seg ? activityKey(seg) : String(c.segmentId)
    if (!rows.has(key)) rows.set(key, { title: seg?.title || 'Activity', at: seg?.starts_at, when: seg ? span(seg.starts_at, seg.ends_at) : '', parts: new Set() })
    const row = rows.get(key)
    if (c.replacementMemberId != null) row.parts.add(`${memberName(c.replacedMemberId)} → ${memberName(c.replacementMemberId)}`)
    if (c.venueName) row.parts.add(`move to ${c.venueName}`)
    if (c.starts_at || c.ends_at) row.parts.add(`now ${span(c.starts_at || seg?.starts_at, c.ends_at || seg?.ends_at)}`)
  }
  return [...rows.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).map(r => `${r.title} (${r.when}): ${[...r.parts].join(', ')}`)
}
const wf = computed(() => props.workflow)
// The workflow's status reaches Pip as a prop, so wait for it to re-render before reading the result
async function act(name, arg) {
  if (!props.workflowAct) return undefined
  const result = await props.workflowAct(name, arg)
  await nextTick()
  return result
}

function usePlan(msg, planId) {
  const plan = props.plans.find(p => p.id === planId)
  if (msg.runId !== runCount || !plan) {
    say('That result is out of date because the scenario changed. Run it again to get a fresh fix.')
    return
  }
  msg.chosenId = planId
  answer('Choose: ' + plan.title)
  chooseFix(plan)
}
function chooseFix(plan) {
  emit('use-plan', plan.id)
  fix.value = { id: Date.now(), optionId: plan.id, planId: '', title: plan.title, type: draft.value.type, delayMinutes: draft.value.delayMinutes, declined: new Set() }
  const list = changeList(plan)
  const members = replacements(plan), rooms = (plan.changes || []).some(c => c.venueName)
  const todo = [
    ...members.map(id => `ask ${memberName(id)} to cover`),
    ...(rooms ? ['help you request the room'] : [])
  ]
  say("Here's what will change:", { kind: 'changes', list })
  // The server only saves a room outage for a real Pulse booking linked to the event
  const room = draft.value.type === 'FACILITY_UNAVAILABLE' && props.bookings.find(b => same(b.id, draft.value.facilityBookingId))
  if (room?.venue_only) {
    say(`I can show this fix, but I can't send requests for it: ${room.venue_name} isn't booked through Pulse, so there's no booking to check against. To make it work, choose this event's facility booking in Day-of Ops (the "Facility booking" field), then try again.`)
    step.value = 'done'
    return
  }
  say(todo.length
    ? `If you confirm, I'll ${todo.join(' and ')}. As soon as everyone accepts, Day Ops is updated automatically. You don't need to press Apply.`
    : "If you confirm, I'll save this fix so you can apply it. Nothing changes in Day Ops until you press Apply.",
  { kind: 'confirm', fixId: fix.value.id })
  step.value = 'done'
}
// Save the fix as a recovery and send the member requests straight away
async function confirmFix(msg) {
  if (msg.fixId !== fix.value?.id || msg.done || msg.sending) return
  if (!wf.value) { say("I can't reach the recovery steps right now. Refresh the page and try again."); return }
  if (!wf.value.canRequest) {
    say(`I can't send requests on this site: ${wf.value.notice || 'live recovery is turned off (preview mode).'}`)
    return
  }
  msg.done = true
  answer('Confirm')
  await act('start')
  if (!wf.value.planId) { msg.done = false; say(`That didn't go through: ${friendly(wf.value.error) || 'the fix could not be saved.'}`); return }
  fix.value.planId = wf.value.planId
  for (const row of wf.value.members) if (row.state === 'Invitation required') await act('invite', row.key)
  if (wf.value.error) say(`One request didn't go through: ${wf.value.error}`)
  say('Here are the steps for this fix. I\'ll update them as people reply.', { kind: 'tracker', fixId: fix.value.id, planId: fix.value.planId, title: fix.value.title })
}
// Server messages a user can act on, in plain words
function friendly(error) {
  if (/Unavailable room is not linked/i.test(error || '')) return "this room isn't a Pulse booking linked to the event. Choose the event's facility booking in Day-of Ops, then try again."
  if (/Unavailable member is not assigned/i.test(error || '')) return "that person isn't on this event's crew any more. Refresh and try again."
  if (/activation is OFF|not released/i.test(error || '')) return 'sending is switched off in Supabase (the release gate). Ask Jerica to turn it on.'
  return error
}
function pickAnother(msg) {
  msg.done = true
  answer('Pick another')
  fix.value = null
  say('No problem. Choose another option above, or try a different problem.')
}

// Live tracker rows read straight from the workflow
const isLive = msg => msg.fixId === fix.value?.id && !!wf.value && wf.value.planId && wf.value.planId === fix.value?.planId
const MEMBER_STATE = { Pending: '⏳ Waiting for reply', Accepted: '✅ Accepted', Declined: '❌ Declined', Expired: '⌛ No reply in time', Cancelled: 'Cancelled', 'Invitation required': 'Not sent yet' }
const ROOM_STATE = { Approved: '✅ Approved', 'Pending approval': '⏳ Waiting for approval', Rejected: '❌ Rejected', 'Booking not linked': 'Not requested yet' }
const memberLabel = state => MEMBER_STATE[state] || state
// Colour of a checklist row: done (green), waiting (amber), problem (red), not started (grey)
function tone(state) {
  if (['Accepted', 'Approved'].includes(state)) return 'done'
  if (['Pending', 'Pending approval'].includes(state)) return 'wait'
  if (['Declined', 'Rejected', 'Expired', 'Cancelled'].includes(state)) return 'bad'
  return 'todo'
}
const DELIVERY = {
  'Awaiting configured sender': 'Telegram message is queued. It also shows in their Pulse inbox.',
  'Account not linked': "They haven't linked Telegram, so it's only in their Pulse inbox.",
  'Notification failed': "Telegram didn't send. It's still in their Pulse inbox.",
  'Delivery unconfirmed (do not resend)': "Telegram may have sent. Don't resend; it's in their Pulse inbox."
}
const deliveryNote = label => DELIVERY[label] || `Telegram: ${label}. It's also in their Pulse inbox.`
const roomLabel = state => ROOM_STATE[state] || state

async function sendInvite(row) { await act('invite', row.key); if (wf.value?.error) say(`That request didn't go through: ${wf.value.error}`) }
async function requestRoom(room) {
  const target = await act('room-target', room.key)
  if (target) router.push(target)
}
async function linkRoom(room) { await act('link-room', room.key); if (wf.value?.error) say(`I couldn't link that booking: ${wf.value.error}`) }
async function applyFix() {
  answer('Apply changes')
  await act('apply')
  if (wf.value?.applied === 'Applied') say("✅ Done. Day Ops is updated. Want me to tell the crew?", { kind: 'applied', fixId: fix.value?.id })
  else say(`That didn't apply: ${wf.value?.error || 'something still needs to be done first.'}`)
}
// The server only undoes once the disruption is over, so ask first
function undoFix() {
  const open = wf.value?.unresolved || []
  if (!open.length) return runUndo()
  const items = open.map(r => r.type === 'MEMBER_UNAVAILABLE' ? `${memberName(r.memberId)} is available again` : `${r.venueName || 'the room'} can be used again`)
  say(`To undo, please confirm the problem is over: ${items.join(' and ')}.`, { kind: 'undo-check', fixId: fix.value?.id, indexes: open.map(r => r.index) })
}
async function confirmUndo(msg) {
  if (msg.done) return
  msg.done = true
  answer("Yes, it's over")
  for (const index of msg.indexes) {
    await act('resolve', index)
    if (wf.value?.error) { say(`I couldn't record that: ${wf.value.error}`); return }
  }
  await runUndo(true)
}
async function runUndo(confirmed = false) {
  if (!confirmed) answer('Undo')
  await act('undo')
  if (wf.value?.applied === 'Undone') say('↩️ Undone. Day Ops is back to how it was before this fix.')
  else say(`I couldn't undo it: ${wf.value?.error || wf.value?.undoReason || 'Undo is not available for this fix.'}`)
}
// Reuses Day Ops' crew alert: one Telegram message to the whole crew of the event
async function notifyCrew(msg) {
  msg.notified = true
  const ev = props.selectedEvent
  if (!supabase || ev?.source_table !== 'ops_events') { say('Crew alerts only work for Day Ops events.'); return }
  const minutes = fix.value?.type === 'SCHEDULE_DELAY' ? Number(fix.value.delayMinutes) : 0
  const delayed = minutes >= 1 && minutes <= 300
  const { data, error } = await supabase.rpc('rpc_notify_ops_schedule_change', {
    p_club_id: ev.club_id, p_event_id: ev.source_id,
    p_action: delayed ? 'delayed' : 'updated', p_delay_minutes: delayed ? minutes : null
  })
  if (error) { msg.notified = false; say(`I couldn't notify the crew: ${error.message}`); return }
  say(`📲 Sent a Telegram update to ${data?.queued ?? 'the'} crew ${data?.queued === 1 ? 'member' : 'members'}.`)
}
function viewDayOps() { router.push('/operations') }

// Someone said no: offer the next person from the same run
watch(() => wf.value?.members, rows => {
  if (!fix.value?.planId || wf.value?.planId !== fix.value.planId) return
  for (const row of rows || []) {
    if (!['Declined', 'Expired'].includes(row.state) || fix.value.declined.has(row.key)) continue
    fix.value.declined.add(row.key)
    const tried = new Set([...fix.value.declined].map(key => key.split(':')[1]))
    const next = runCount && lastPlans.find(plan => plan.id !== fix.value.optionId && props.plans.some(p => p.id === plan.id) &&
      (plan.changes || []).some(c => same(c.replacedMemberId, row.replaced) && c.replacementMemberId != null && !tried.has(String(c.replacementMemberId))))
    const who = memberName(row.recipient)
    if (next) {
      const nextId = next.changes.find(c => same(c.replacedMemberId, row.replaced) && c.replacementMemberId != null).replacementMemberId
      say(`${who} ${row.state === 'Declined' ? "can't do it" : "didn't reply in time"}. Try ${memberName(nextId)} instead?`, { kind: 'retry', planId: next.id, name: memberName(nextId), fixId: fix.value.id })
    } else {
      say(`${who} ${row.state === 'Declined' ? "can't do it" : "didn't reply in time"}, and I don't have another person ready. Tap "Try another problem" to run it again.`)
    }
  }
}, { deep: true })
async function retryWith(msg) {
  if (msg.done) return
  const plan = props.plans.find(p => p.id === msg.planId)
  if (!plan) { say('That option is out of date. Run the problem again to get fresh options.'); return }
  msg.done = true
  answer(`Yes, ask ${msg.name}`)
  const declined = fix.value?.declined || new Set()
  await act('cancel')
  chooseFix(plan)
  fix.value.declined = declined
  await nextTick(); await nextTick()
  const confirm = [...messages.value].reverse().find(m => m.kind === 'confirm')
  if (confirm) await confirmFix(confirm)
}

// ---- Fixes saved earlier for this event ----
const inProgress = computed(() => (wf.value?.saved || []).filter(p => p.application_status === 'Draft' && p.lifecycle === 'In Progress'))
const pastFixes = computed(() => (wf.value?.saved || []).filter(p => ['Applied', 'Undone'].includes(p.application_status)))
const offered = new Set()
// Once the event's saved fixes load, mention any that are still waiting
watch(() => [props.selectedEventId, inProgress.value.length, step.value], () => {
  const key = String(props.selectedEventId)
  if (step.value !== 'type' || offered.has(key) || !inProgress.value.length) return
  offered.add(key)
  say(`You have ${inProgress.value.length} ${inProgress.value.length === 1 ? 'fix' : 'fixes'} still in progress for ${eventName.value}:`, { kind: 'saved', items: inProgress.value.slice(0, 3) })
})
function showPastFixes() {
  if (!pastFixes.value.length) { say('No applied fixes for this event yet.'); return }
  say('Fixes applied for this event:', { kind: 'saved', items: pastFixes.value.slice(0, 5) })
}
async function openSaved(item) {
  answer('Open: ' + item.title)
  await act('open-saved', item.id)
  fix.value = { id: Date.now(), optionId: '', planId: item.id, title: item.title, type: '', delayMinutes: 0, declined: new Set() }
  say(`Here's where "${item.title}" is up to:`, { kind: 'tracker', fixId: fix.value.id, planId: item.id, title: item.title })
}

function startOver(keepEvent = true) {
  history.value.length = 0
  if (keepEvent && props.selectedEventId) {
    say("OK, let's try another problem.")
    ask('type')
  } else {
    ask('event')
  }
}
function handleReset() {
  emit('reset')
  messages.value = []
  history.value.length = 0
  fix.value = null
  offered.clear()
  say("👋 Hi! I'm Pip. Tell me what went wrong and I'll check the schedule and suggest a fix.\n\nI'll ask a few quick questions, then show you the best fixes. Nothing changes until you apply one.")
  ask('event')
}
onMounted(handleReset)
</script>

<template>
  <div class="pulse-chatbot-card mb-4">

    <!-- Chatbot Header -->
    <div class="pip-header d-flex flex-wrap align-items-center justify-content-between gap-3">
      <div class="d-flex align-items-center gap-3">
        <div class="pulse-bot-avatar-box d-flex align-items-center justify-content-center">
          <span style="font-size: 1.5rem;">🐱</span>
          <span class="pip-online" aria-hidden="true"></span>
        </div>
        <div>
          <h5 class="fw-bold mb-0 text-dark" style="letter-spacing: -0.01em;">Pip</h5>
          <small class="d-block pip-header-sub">Your event contingency assistant · answer a few questions, get a fix</small>
        </div>
      </div>

      <div class="d-flex align-items-center gap-2">
        <button
          type="button"
          class="btn btn-sm pip-ghost-btn rounded-pill px-3 py-1 fw-semibold"
          style="font-size: 0.75rem;"
          @click="handleReset"
        >
          ↻ Start over
        </button>
      </div>
    </div>

    <!-- Chat Stream Scrollbox -->
    <div
      ref="chatContainer"
      class="pulse-chat-stream p-3 p-lg-4"
      aria-live="polite"
    >
      <div v-for="m in messages" :key="m.id" class="mb-3" :data-msg-id="m.id">

        <!-- User Bubble -->
        <div v-if="m.sender === 'user'" class="d-flex justify-content-end">
          <div class="pulse-user-bubble px-3 py-2 text-white">
            {{ m.text }}
            <div class="text-end text-white text-opacity-75 mt-1" style="font-size: 0.65rem;">{{ m.timestamp }}</div>
          </div>
        </div>

        <!-- Assistant Bubble -->
        <div v-else class="d-flex align-items-start gap-2.5">
          <div class="pulse-bot-mini-avatar flex-shrink-0 rounded-circle d-flex align-items-center justify-content-center">
            <span style="font-size: 1rem;">🐱</span>
          </div>

          <div class="pulse-bot-bubble p-3 text-dark flex-grow-1">
            <div style="white-space: pre-line;">{{ m.text }}</div>

            <!-- Result: the sandbox's top-ranked plan -->
            <template v-if="m.kind === 'result'">
              <!-- Top 3 fixes, ranked by the sandbox's score -->
              <div
                v-for="(plan, i) in m.options"
                :key="plan.id"
                class="pip-option p-3 mt-2"
                :class="{ 'pip-option-best': i === 0 && !plan.tied, 'pip-option-chosen': m.chosenId === plan.id }"
              >
                <div class="d-flex flex-wrap align-items-start justify-content-between gap-2">
                  <div>
                    <span v-if="plan.tied" class="badge bg-secondary-subtle text-dark border mb-1" style="font-size: 0.62rem;">Equally good</span>
                    <span v-else-if="i === 0" class="badge bg-danger text-white mb-1" style="font-size: 0.62rem;">⭐ Recommended</span>
                    <span v-else class="text-muted d-block mb-1" style="font-size: 0.68rem;">Option {{ i + 1 }}</span>
                    <strong class="d-block text-dark" style="font-size: 0.86rem;">{{ plan.title }}</strong>
                  </div>
                  <!-- A shared score says nothing, so only differing scores are shown -->
                  <span v-if="typeof plan.score === 'number' && !plan.tied" class="badge bg-white text-dark border" style="font-size: 0.75rem;">{{ plan.score }}/100</span>
                </div>
                <div v-if="plan.tags.length" class="d-flex flex-wrap gap-1 mt-2">
                  <span v-for="tag in plan.tags" :key="tag" class="pip-tag" :class="{ 'pip-tag-warn': /^(⚠️|🏛️|⏱️|⏳)/.test(tag) }">{{ tag }}</span>
                </div>
                <ul class="list-unstyled mb-0 mt-2" style="font-size: 0.76rem;">
                  <li v-for="line in plan.lines.slice(0, 3)" :key="line">{{ line }}</li>
                  <li v-if="plan.lines.length > 3" class="text-muted">+ {{ plan.lines.length - 3 }} more changes</li>
                  <li v-if="!plan.lines.length" class="text-muted">No schedule changes needed.</li>
                </ul>
                <button
                  type="button"
                  class="btn btn-sm rounded-pill px-3 mt-2 fw-bold"
                  :class="m.chosenId === plan.id ? 'btn-pulse-primary text-white' : 'btn-outline-danger'"
                  style="font-size: 0.75rem;"
                  @click="usePlan(m, plan.id)"
                >
                  {{ m.chosenId === plan.id ? '✓ Chosen' : 'Choose this →' }}
                </button>
              </div>
              <div v-if="!m.options.length" class="p-3 rounded-3 mt-3 border bg-light small">
                I couldn't find a fix that works for this one: nobody suitable is free, or no other room is available. Try a shorter time, or a different person or room.
              </div>

              <div v-if="m.options.length" class="mt-3 pt-2 border-top">
                <small class="text-muted" style="font-size: 0.7rem;">
                  {{ m.options.some(o => o.tied) ? 'Equally good options are listed with the least busy person first. ' : '' }}Choosing a fix doesn't change anything yet.
                </small>
              </div>
            </template>

            <!-- What the chosen fix changes -->
            <ul v-if="m.kind === 'changes'" class="pip-change-list mt-2 mb-0">
              <li v-for="line in m.list.slice(0, 5)" :key="line">{{ line }}</li>
              <li v-if="m.list.length > 5" class="text-muted">+ {{ m.list.length - 5 }} more</li>
              <li v-if="!m.list.length" class="text-muted">No changes to Day Ops.</li>
            </ul>

            <div v-if="m.kind === 'confirm' && !m.done && m.fixId === fix?.id" class="d-flex flex-wrap gap-2 mt-3">
              <button type="button" class="btn btn-sm btn-pulse-primary text-white fw-bold rounded-pill px-3" :disabled="wf?.busy" @click="confirmFix(m)">Confirm{{ /ask|request/.test(m.text) ? ' and send requests' : '' }} →</button>
              <button type="button" class="btn btn-sm btn-outline-secondary rounded-pill px-3" @click="pickAnother(m)">Pick another</button>
            </div>

            <!-- Live steps for the fix, read from the recovery workflow -->
            <div v-if="m.kind === 'tracker'" class="mt-2">
              <template v-if="isLive(m)">
                <div v-for="row in wf.members" :key="row.key" class="pip-step" :class="'tone-' + tone(row.state)">
                  <div class="flex-grow-1">
                    <div>👤 Ask <strong>{{ memberName(row.recipient) }}</strong> to cover {{ memberName(row.replaced) }} ({{ row.count }} {{ row.count === 1 ? 'task' : 'tasks' }})</div>
                    <small v-if="row.state === 'Pending' && row.delivery" class="text-muted d-block">{{ deliveryNote(row.delivery) }}</small>
                  </div>
                  <span class="pip-step-status">{{ memberLabel(row.state) }}</span>
                  <button v-if="row.state === 'Invitation required'" type="button" class="btn btn-sm btn-outline-danger rounded-pill px-3" :disabled="wf.busy || !wf.canRequest" @click="sendInvite(row)">Send request</button>
                </div>
                <div v-for="room in wf.rooms" :key="room.key" class="pip-step" :class="'tone-' + tone(room.status)">
                  <div class="flex-grow-1">🏛️ Book <strong>{{ room.venue }}</strong>, {{ room.span }}</div>
                  <span class="pip-step-status">{{ roomLabel(room.status) }}</span>
                  <button v-if="!room.linked && room.hasClaim" type="button" class="btn btn-sm btn-outline-danger rounded-pill px-3" :disabled="wf.busy" @click="linkRoom(room)">Link my booking request</button>
                  <button v-else-if="!room.linked" type="button" class="btn btn-sm btn-outline-danger rounded-pill px-3" :disabled="wf.busy" @click="requestRoom(room)">Request room →</button>
                </div>
                <div class="pip-step" :class="'tone-' + (wf.applied === 'Applied' || wf.applied === 'Undone' ? 'done' : wf.applyReady ? 'ready' : 'todo')">
                  <template v-if="wf.applied === 'Applied'">
                    <div class="flex-grow-1">✅ <strong>Applied to Day Ops</strong></div>
                    <button type="button" class="btn btn-sm btn-outline-secondary rounded-pill px-3" :disabled="!wf.undoReady" :title="wf.undoReason" @click="undoFix">↩️ Undo</button>
                  </template>
                  <div v-else-if="wf.applied === 'Undone'" class="flex-grow-1">↩️ <strong>Undone.</strong> Day Ops is back to how it was.</div>
                  <div v-else-if="wf.applied === 'Cancelled'" class="flex-grow-1 text-muted">This fix was cancelled.</div>
                  <template v-else>
                    <div class="flex-grow-1">
                      <div>{{ wf.applyReady ? '▶️' : '🔒' }} <strong>Apply changes</strong> to Day Ops</div>
                      <small class="text-muted d-block">{{ wf.applyReady ? 'Everything is ready. Pressing Apply confirms you have checked the changes above.' : 'Unlocks when every step above is ✅.' }}</small>
                      <small v-if="!wf.canApply" class="text-muted d-block">Applying is turned off on this site (preview mode).</small>
                    </div>
                    <button type="button" class="btn btn-sm btn-pulse-primary text-white fw-bold rounded-pill px-3" :disabled="!wf.applyReady || !wf.canApply || wf.busy" @click="applyFix">{{ wf.applyReady ? 'Apply' : '🔒 Apply' }}</button>
                  </template>
                </div>
                <div class="d-flex flex-wrap align-items-center gap-2 mt-2">
                  <button type="button" class="btn btn-sm btn-link text-secondary p-0" style="font-size: 0.75rem;" :disabled="wf.busy || wf.loading" @click="act('refresh')">↻ Check for replies</button>
                  <small v-if="wf.busy" class="text-muted">Working on it…</small>
                  <small v-else-if="wf.loading" class="text-muted">Checking…</small>
                </div>
                <small v-if="wf.error" class="text-danger d-block mt-1">{{ wf.error }}</small>
              </template>
              <div v-else class="text-muted small">
                This fix is saved.
                <button type="button" class="btn btn-sm btn-link p-0 align-baseline" @click="openSaved({ id: m.planId, title: m.title })">Open it again</button>
              </div>
            </div>

            <div v-if="m.kind === 'applied'" class="d-flex flex-wrap gap-2 mt-3">
              <button v-if="selectedEvent?.source_table === 'ops_events' && !m.notified" type="button" class="btn btn-sm btn-pulse-primary text-white fw-bold rounded-pill px-3" @click="notifyCrew(m)">📲 Notify crew</button>
              <button type="button" class="btn btn-sm btn-outline-secondary rounded-pill px-3" @click="viewDayOps">View in Day-of Ops →</button>
            </div>

            <div v-if="m.kind === 'undo-check' && !m.done && m.fixId === fix?.id" class="d-flex flex-wrap gap-2 mt-3">
              <button type="button" class="btn btn-sm btn-pulse-primary text-white fw-bold rounded-pill px-3" :disabled="wf?.busy" @click="confirmUndo(m)">Yes, it's over. Undo</button>
              <button type="button" class="btn btn-sm btn-outline-secondary rounded-pill px-3" @click="m.done = true">Cancel</button>
            </div>

            <div v-if="m.kind === 'retry' && !m.done && m.fixId === fix?.id" class="d-flex flex-wrap gap-2 mt-3">
              <button type="button" class="btn btn-sm btn-pulse-primary text-white fw-bold rounded-pill px-3" :disabled="wf?.busy" @click="retryWith(m)">Yes, ask {{ m.name }}</button>
              <button type="button" class="btn btn-sm btn-outline-secondary rounded-pill px-3" @click="m.done = true">Not now</button>
            </div>

            <div v-if="m.kind === 'saved'" class="d-flex flex-column gap-2 mt-2">
              <div v-for="item in m.items" :key="item.id" class="pip-step">
                <div class="flex-grow-1"><strong>{{ item.title }}</strong><small class="text-muted d-block">{{ item.application_status === 'Draft' ? item.status : item.application_status }}</small></div>
                <button type="button" class="btn btn-sm btn-outline-danger rounded-pill px-3" @click="openSaved(item)">{{ item.application_status === 'Draft' ? 'Continue' : 'Open' }}</button>
              </div>
            </div>

            <div class="text-end text-muted mt-2" style="font-size: 0.65rem;">{{ m.timestamp }}</div>
          </div>
        </div>
      </div>

      <!-- Current question's answers -->
      <div v-if="step && step !== 'running'" class="pip-answers ps-md-5">
        <div v-if="loading && step === 'event'" class="text-muted small">Loading your events…</div>
        <p v-else-if="step === 'event' && !events.length" class="text-muted small mb-2">No events found yet. Create one in Day-of Ops first.</p>

        <div v-if="shownChoices.length" class="d-flex flex-wrap gap-2">
          <button
            v-for="c in shownChoices"
            :key="c.id"
            type="button"
            class="btn btn-sm pulse-scenario-chip text-start d-flex align-items-center gap-2 px-3 py-2 text-dark"
            :class="{ 'pulse-chip-active': step === 'event' && String(c.id) === String(selectedEventId) }"
            :disabled="c.disabled"
            @click="choose(c)"
          >
            <span v-if="c.icon" class="pip-chip-icon" :class="'icon-' + c.id">{{ c.icon }}</span>
            <div>
              <strong class="d-block" style="font-size: 0.78rem;">{{ c.label }}</strong>
              <small v-if="c.sub" class="text-muted d-block" style="font-size: 0.68rem;">{{ c.sub }}</small>
            </div>
          </button>
        </div>
        <p v-else-if="choices.length" class="text-muted small mb-0">Nothing matches "{{ query }}".</p>
        <button v-if="hiddenCount > 0" type="button" class="btn btn-sm btn-link text-secondary p-0 mt-2" style="font-size: 0.78rem;" @click="showAll = true">Show all ({{ matches.length }})</button>
        <p v-if="step === 'type' && choices.some(c => c.disabled)" class="text-muted mt-2 mb-0" style="font-size: 0.72rem;">
          Greyed out = this event has no crew, rooms or movable activities for that yet.
        </p>

        <div v-if="step === 'time'" class="pip-panel p-3">
          <SimulatorDisruptionInterval id="pip-time" :index="1" :event="selectedEvent" v-model:start="draft.start" v-model:end="draft.end" />
          <div class="d-flex flex-wrap gap-2 mt-2">
            <button type="button" class="btn btn-sm btn-pulse-primary text-white fw-bold rounded-pill px-3" @click="draft.intervalMode = ''; confirmTime()">Check this time →</button>
            <button type="button" class="btn btn-sm btn-outline-secondary rounded-pill px-3" @click="wholeEvent">Whole event</button>
          </div>
        </div>

        <div v-if="step === 'minutes'" class="d-flex flex-wrap gap-2">
          <button
            v-for="minutes in DELAYS"
            :key="minutes"
            type="button"
            class="btn btn-sm pulse-scenario-chip px-3 py-2 rounded-3 border bg-white text-dark fw-semibold"
            @click="chooseDelay(minutes)"
          >
            {{ minutes }} min
          </button>
        </div>

        <div v-if="step === 'done'" class="d-flex flex-wrap gap-2">
          <button type="button" class="btn btn-sm pulse-scenario-chip px-3 py-2 rounded-3 border bg-white text-dark fw-semibold" @click="startOver(true)">Try another problem</button>
          <button type="button" class="btn btn-sm pulse-scenario-chip px-3 py-2 rounded-3 border bg-white text-dark fw-semibold" @click="startOver(false)">Change event</button>
          <button v-if="pastFixes.length" type="button" class="btn btn-sm pulse-scenario-chip px-3 py-2 rounded-3 border bg-white text-dark fw-semibold" @click="showPastFixes">Past fixes</button>
        </div>

        <button v-if="history.length > 1 && step !== 'done'" type="button" class="btn btn-link btn-sm text-secondary p-0 mt-2" style="font-size: 0.75rem;" @click="back">← Back</button>
      </div>
    </div>

    <!-- The chat box: searches the current question's options, or takes the minutes late -->
    <form class="pip-input-bar d-flex align-items-center gap-2" @submit.prevent="submitTyped">
      <div class="input-group input-group-sm">
        <span class="input-group-text border-0 bg-transparent text-muted ps-3">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
        </span>
        <input
          v-model="query"
          :type="step === 'minutes' ? 'number' : 'text'"
          class="form-control border-0 bg-transparent py-2"
          :placeholder="placeholder"
          :disabled="!canType"
          :aria-label="placeholder"
          style="font-size: 0.825rem;"
        />
      </div>

      <button
        type="submit"
        class="btn btn-pulse-primary text-white fw-bold px-3 py-2 rounded-pill flex-shrink-0 d-flex align-items-center gap-1"
        style="font-size: 0.8rem;"
        :disabled="!canType || !String(query).trim()"
      >
        <span>Send</span>
        <span>→</span>
      </button>
    </form>

  </div>
</template>

<style scoped>
/* Pulse colours (src/style.css) with a few soft accents so Pip isn't just red and white */
.pulse-chatbot-card {
  border-radius: 1.25rem;
  background: #fff;
  border: 1px solid var(--pulse-border, #e2e8f0);
  box-shadow: var(--pulse-shadow);
  overflow: hidden;
}

.pip-header {
  padding: 1rem 1.25rem;
  background: linear-gradient(120deg, #fff1f2 0%, #fdf4ff 55%, #eff6ff 100%);
  border-bottom: 1px solid var(--pulse-border, #e2e8f0);
}

.pip-header-sub {
  font-size: 0.75rem;
  color: var(--pulse-ink-muted, #64748b);
}

.pulse-bot-avatar-box {
  position: relative;
  width: 48px;
  height: 48px;
  border-radius: 14px;
  background: linear-gradient(135deg, #fecdd3, #fbcfe8 55%, #ddd6fe);
  box-shadow: 0 6px 14px -6px rgba(225, 29, 72, 0.45);
}

.pip-online {
  position: absolute;
  right: -3px;
  bottom: -3px;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: #22c55e;
  border: 2px solid #fff;
}

.pip-ghost-btn {
  background: rgba(255, 255, 255, 0.8);
  border: 1px solid var(--pulse-border, #e2e8f0);
  color: #475569;
}

.pip-ghost-btn:hover {
  background: #fff;
  border-color: var(--pulse-primary-border, #fecdd3);
  color: var(--pulse-primary, #e11d48);
}

.pulse-chat-stream {
  max-height: 560px;
  min-height: 300px;
  overflow-y: auto;
  background:
    radial-gradient(circle at 0% 0%, rgba(253, 242, 248, 0.9), transparent 45%),
    radial-gradient(circle at 100% 100%, rgba(239, 246, 255, 0.9), transparent 45%),
    #f8fafc;
}

.pulse-bot-mini-avatar {
  width: 32px;
  height: 32px;
  background: linear-gradient(135deg, #ffe4e6, #ede9fe);
  font-size: 1rem;
}

.pulse-bot-bubble {
  max-width: 92%;
  font-size: 0.84rem;
  line-height: 1.5;
  background: #fff;
  border-radius: 4px 18px 18px 18px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05), 0 4px 14px -6px rgba(15, 23, 42, 0.08);
}

.pulse-user-bubble {
  max-width: 82%;
  font-size: 0.85rem;
  border-radius: 18px 18px 4px 18px;
  background: linear-gradient(135deg, #f43f5e, #e11d48 55%, #be123c);
  box-shadow: 0 6px 14px -8px rgba(225, 29, 72, 0.6);
}

/* Answer chips */
.pulse-scenario-chip {
  background: #fff;
  border: 1px solid var(--pulse-border, #e2e8f0);
  border-radius: 14px;
  transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
}

.pulse-scenario-chip:hover:not(:disabled) {
  transform: translateY(-1px);
  border-color: var(--pulse-primary-border, #fecdd3);
  box-shadow: 0 6px 14px -8px rgba(225, 29, 72, 0.35);
}

.pulse-scenario-chip:disabled {
  opacity: 0.45;
}

.pulse-chip-active {
  background: var(--pulse-primary-light, #fff1f2) !important;
  border-color: var(--pulse-primary, #e11d48) !important;
}

.pip-chip-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  font-size: 1.05rem;
  flex-shrink: 0;
}

.icon-MEMBER_UNAVAILABLE { background: var(--pulse-blue-bg, #e0f2fe); }
.icon-FACILITY_UNAVAILABLE { background: var(--pulse-amber-bg, #fef3c7); }
.icon-SCHEDULE_DELAY { background: #ede9fe; }

.pip-panel {
  background: #fff;
  border: 1px solid var(--pulse-border, #e2e8f0);
  border-radius: 16px;
  box-shadow: var(--pulse-shadow-sm);
}

/* Fix options */
.pip-option {
  background: #fff;
  border: 1px solid var(--pulse-border, #e2e8f0);
  border-radius: 14px;
  transition: box-shadow 0.15s ease, border-color 0.15s ease;
}

.pip-option:hover {
  box-shadow: 0 8px 18px -12px rgba(15, 23, 42, 0.3);
}

.pip-option-best {
  border-color: var(--pulse-primary-border, #fecdd3);
  background: linear-gradient(135deg, #fff1f2, #fff 60%);
  box-shadow: inset 4px 0 0 var(--pulse-primary, #e11d48);
}

.pip-option-chosen {
  border-color: var(--pulse-green-border, #bbf7d0);
  background: linear-gradient(135deg, #f0fdf4, #fff 60%);
  box-shadow: inset 4px 0 0 var(--pulse-green, #15803d);
}

.pip-tag {
  font-size: 0.7rem;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  background: var(--pulse-green-bg, #dcfce7);
  color: #166534;
  border: 1px solid var(--pulse-green-border, #bbf7d0);
}

.pip-tag-warn {
  background: var(--pulse-amber-bg, #fef3c7);
  color: #92400e;
  border-color: var(--pulse-amber-border, #fde68a);
}

.pip-change-list {
  padding-left: 1.1rem;
  font-size: 0.8rem;
}

/* Checklist rows, coloured by status */
.pip-step {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  padding: 0.65rem 0.8rem;
  margin-top: 0.45rem;
  border: 1px solid var(--pulse-border, #e2e8f0);
  border-left-width: 4px;
  border-radius: 12px;
  background: #fff;
  font-size: 0.8rem;
}

.pip-step.tone-done { border-left-color: #22c55e; background: #f0fdf4; }
.pip-step.tone-wait { border-left-color: #f59e0b; background: #fffbeb; }
.pip-step.tone-bad { border-left-color: #ef4444; background: #fef2f2; }
.pip-step.tone-ready { border-left-color: var(--pulse-primary, #e11d48); background: #fff1f2; }
.pip-step.tone-todo { border-left-color: #cbd5e1; }

.pip-step-status {
  font-size: 0.72rem;
  font-weight: 600;
  color: #475569;
  white-space: nowrap;
}

/* Chat box */
.pip-input-bar {
  padding: 0.75rem 1rem;
  border-top: 1px solid var(--pulse-border, #e2e8f0);
  background: #fff;
}

.pip-input-bar .input-group {
  background: #f1f5f9;
  border-radius: 999px;
  transition: box-shadow 0.15s ease, background 0.15s ease;
}

.pip-input-bar .input-group:focus-within {
  background: #fff;
  box-shadow: 0 0 0 3px var(--pulse-primary-light, #fff1f2), 0 0 0 1px var(--pulse-primary-border, #fecdd3);
}

.pip-input-bar .form-control:focus {
  box-shadow: none;
}

.pulse-chat-stream::-webkit-scrollbar {
  width: 6px;
}
.pulse-chat-stream::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 9999px;
}

@media (max-width: 576px) {
  .pip-header {
    padding: 0.85rem 1rem;
  }
  .pulse-scenario-chip {
    width: 100%;
  }
  .pulse-user-bubble {
    max-width: 90%;
  }
  .pulse-bot-bubble {
    max-width: 95%;
  }
  .pulse-bot-avatar-box {
    width: 40px;
    height: 40px;
  }
}
</style>
