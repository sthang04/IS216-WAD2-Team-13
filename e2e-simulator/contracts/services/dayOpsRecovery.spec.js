// WHY THIS FILE IS RETAINED: Checks the Day-of Ops side of the simulator: crew task
// grouping, venue-only rooms, whole-venue moves and delay recovery plans.
// SCOPE: Non-browser checks using the Playwright test runner; synthetic data only.
// A passing result here does not prove live Supabase data or the Apply/Undo backend.
import {test} from '@playwright/test'
import assert from 'node:assert/strict'
import { adaptOpsSimulationData } from '../../../src/services/simulatorOpsDataService.js'
import { prepareDisruptionCards, assessCombinedRecovery, buildCombinedRecoveryOptions } from '../../../src/services/combinedSimulationService.js'
import { runCompleteSimulation } from '../../../src/services/simulationService.js'
import { evaluateRecoveryPlan } from '../../../src/services/recoveryPlanEvaluationService.js'
import { groupActivities } from '../../../src/services/simulatorActivityGroups.js'
import { simulationImpactSummary } from '../../../src/services/simulatorPresentationService.js'

// One Day Ops event on 5 Nov: Mei (1), Angel (2), John (3). Day Ops saves one task per
// crew member, so "Brief Emcees" for Mei and Angel is two rows with the same title/time.
const EVENT = '11111111-1111-4111-8111-111111111111'
const DAY = '2026-11-05'
const at = clock => DAY + 'T' + clock + ':00+08:00'
let n = 0
const task = (member, title, start, end, extra = {}) => ({
  id: '00000000-0000-4000-8000-' + String(++n).padStart(12, '0'),
  event_id: EVENT, member_id: member, title, task_type: extra.type || 'other',
  start_time: start + ':00', end_time: end + ':00', venue: extra.venue ?? null, is_fixed: !!extra.fixed
})

function fixture() {
  n = 0
  const tasks = [
    task(1, 'Report', '09:30', '10:00'), task(2, 'Report', '09:30', '10:00'),
    task(1, 'Brief Emcees', '11:30', '12:30'), task(2, 'Brief Emcees', '11:30', '12:30'),
    task(1, 'Lunch', '12:30', '14:00', { type: 'meal' }), task(2, 'Lunch', '12:30', '14:00', { type: 'meal' }),
    task(1, 'Rehearsal', '14:00', '16:00', { type: 'perform' }),
    task(2, 'Greet guest', '17:00', '18:00'),
    task(2, 'Show', '18:00', '20:00', { type: 'perform', fixed: true }),
    task(3, 'Meet venue staff', '10:30', '11:00', { venue: 'AAC' })
  ]
  const ops = adaptOpsSimulationData({
    events: [{ id: EVENT, club_id: 10, name: 'Concert', event_date: DAY, venue: 'Main Hall' }],
    tasks,
    crew: [1, 2, 3].map(id => ({ event_id: EVENT, member_id: id })),
    members: [{ id: 1, full_name: 'Mei' }, { id: 2, full_name: 'Angel' }, { id: 3, full_name: 'John' }],
    clubs: [{ id: 10, name: 'Test CCA' }]
  })
  // Other CCAs' confirmed bookings: Studio 7.2 is taken in the evening only.
  const booked = [{ id: 501, venue_name: 'Studio 7.2', booking_date: DAY, event_date: DAY, start_time: '18:00:00', end_time: '21:00:00', time_slot: '18:00 - 21:00', status: 'Booked', owner_club_id: 99, facility_id: 3 }]
  // Same shape simulationDataService builds: venue-only stand-ins never become bookings
  const data = {
    ...ops,
    replacement_memberships: [1, 2, 3].map(memberId => ({ memberId, clubId: 10, active: true, verified: true })),
    member_replacement_coverage: { rosterVerified: true, scheduleVerified: false },
    facilities: [{ id: 1, name: 'Main Hall', is_active: true }, { id: 2, name: 'Gym Studio', is_active: true }, { id: 3, name: 'Studio 7.2', is_active: true }],
    facility_bookings: booked,
    facility_slots: [...booked, ...ops.venue_only_slots],
    segment_facility_bookings: [],
    segment_facility_slots: [...ops.venue_only_links]
  }
  return { data, tasks }
}
const seg = (data, title, member) => data.event_segments.find(s => s.title === title &&
  data.segment_assignments.some(a => a.segment_id === s.id && a.member_id === member))
const copies = (data, title) => data.event_segments.filter(s => s.title === title).map(s => s.id)
function run(data, cards) {
  const eventId = data.events[0].id
  const ds = prepareDisruptionCards(data, eventId, cards)
  const result = runCompleteSimulation(data, eventId, ds)
  const assessment = assessCombinedRecovery(data, eventId, result, ds)
  return { eventId, ds, result, assessment, options: buildCombinedRecoveryOptions(assessment) }
}
// The page sends one delay per crew copy of the chosen activity (EventRiskView expandDelayCards)
const delayAll = (data, title, minutes) => copies(data, title).map((segmentId, i) => ({ id: 'd' + i, type: 'SCHEDULE_DELAY', segmentId, delayMinutes: minutes }))
const direct = result => new Set(result.directImpacts.map(i => String(i.segmentId)))

test('crew copies of one task group into one activity; different titles or times stay apart', () => {
  const { data } = fixture()
  const groups = groupActivities(data.event_segments)
  assert.equal(groups.length, 7)
  assert.equal(groups.find(g => g.title === 'Brief Emcees').ids.length, 2)
  assert.equal(groups.find(g => g.title === 'Rehearsal').ids.length, 1)
  // Same title at another time is a separate activity
  const later = { ...data.event_segments.find(s => s.title === 'Report'), id: 'later', starts_at: at('15:00'), ends_at: at('15:30') }
  assert.equal(groupActivities([...data.event_segments, later]).filter(g => g.title === 'Report').length, 2)
})

test('venue-only stand-ins: one per venue the tasks use, spanning that venue\'s tasks', () => {
  const { data } = fixture()
  const slots = data.facility_slots.filter(s => s.venue_only)
  assert.deepEqual(slots.map(s => s.venue_name).sort(), ['AAC', 'Main Hall'])
  assert.equal(slots.find(s => s.venue_name === 'Main Hall').time_slot, '09:30 - 20:00')
  assert.equal(slots.find(s => s.venue_name === 'AAC').time_slot, '10:30 - 11:00')
  // Stand-ins are simulation only: never listed as real bookings
  assert.ok(!data.facility_bookings.some(b => b.venue_only))
})

test('member unavailable flags only their tasks overlapping the window (end is exclusive)', () => {
  const { data } = fixture()
  const { result } = run(data, [{ id: 'm', type: 'MEMBER_UNAVAILABLE', memberId: 1, start: at('09:30'), end: at('14:00') }])
  const hit = direct(result)
  for (const title of ['Report', 'Brief Emcees', 'Lunch']) assert.ok(hit.has(String(seg(data, title, 1).id)), title)
  assert.ok(!hit.has(String(seg(data, 'Rehearsal', 1).id)), 'Rehearsal starts exactly at 14:00')
  assert.ok(!hit.has(String(seg(data, 'Brief Emcees', 2).id)), "Angel's copy is not Mei's")
})

test('room outage flags only tasks at that venue in the window', () => {
  const { data } = fixture()
  const { result } = run(data, [{ id: 'f', type: 'FACILITY_UNAVAILABLE', venueName: 'Main Hall', facilityBookingId: data.facility_slots.find(s => s.venue_name === 'Main Hall').id, start: at('12:00'), end: at('13:00') }])
  const hit = direct(result)
  for (const id of [...copies(data, 'Brief Emcees'), ...copies(data, 'Lunch')]) assert.ok(hit.has(String(id)))
  assert.ok(!hit.has(String(seg(data, 'Meet venue staff', 3).id)), 'AAC task is unaffected')
  assert.ok(!hit.has(String(seg(data, 'Report', 1).id)), 'outside the window')
})

test('several activities in one Day-of Ops venue at once are not a room clash', () => {
  const { data } = fixture()
  const { result } = run(data, delayAll(data, 'Brief Emcees', 30))
  assert.ok(!result.newConflicts.some(c => c.type === 'FACILITY_SCHEDULE_OVERLAP'))
})

test('whole-venue move: free rooms first, partly-free rooms cover what fits and offer a room for the rest', () => {
  const { data } = fixture()
  const { assessment } = run(data, [{ id: 'f', type: 'FACILITY_UNAVAILABLE', venueName: 'Main Hall', facilityBookingId: data.facility_slots.find(s => s.venue_name === 'Main Hall').id, start: at('09:30'), end: at('20:00') }])
  const move = assessment.venueMoves.find(v => v.venue === 'Main Hall')
  const gym = move.options.find(o => o.room === 'Gym Studio')
  const studio = move.options.find(o => o.room === 'Studio 7.2')
  assert.equal(move.options[0].room, 'Gym Studio', 'fully free room ranks first')
  assert.equal(gym.availability, 'Free the whole time')
  assert.deepEqual(gym.leftover, [])
  assert.equal(studio.availability, 'Free until 18:00')
  assert.deepEqual(studio.leftover, ['Show'])
  // Partly-free room only moves activities that fit; the Show stays put
  assert.ok(!studio.changes.some(c => String(c.segmentId) === String(seg(data, 'Show', 2).id)))
  assert.ok(studio.changes.some(c => String(c.segmentId) === String(seg(data, 'Greet guest', 2).id)))
  // "Rest of the time" rooms are free for the leftover only, never the partly-free room itself
  assert.deepEqual(studio.fill.map(f => f.room), ['Gym Studio'])
  assert.ok(studio.fill[0].changes.every(c => String(c.segmentId) === String(seg(data, 'Show', 2).id)))
})

test('no free room at all falls back to per-activity options instead of offering nothing', () => {
  const { data } = fixture()
  data.facilities = data.facilities.filter(f => f.name !== 'Gym Studio')
  data.facility_slots.push({ id: 502, venue_name: 'Studio 7.2', booking_date: DAY, event_date: DAY, start_time: '09:00:00', end_time: '18:00:00', time_slot: '09:00 - 18:00', status: 'Booked', owner_club_id: 99, facility_id: 3 })
  const { assessment } = run(data, [{ id: 'f', type: 'FACILITY_UNAVAILABLE', venueName: 'Main Hall', facilityBookingId: data.facility_slots.find(s => s.venue_name === 'Main Hall').id, start: at('09:30'), end: at('20:00') }])
  assert.ok(!assessment.venueMoves.length)
})

test('delay into a free next task: end on time and start-next-later both clear the clash', () => {
  const { data } = fixture()
  const { eventId, ds, options } = run(data, delayAll(data, 'Brief Emcees', 30))
  const endOnTime = options.find(o => o.id === 'delay-end-on-time')
  const startLater = options.find(o => o.id === 'crew-shorten')
  assert.ok(endOnTime && startLater)
  for (const id of copies(data, 'Brief Emcees')) {
    const c = endOnTime.changes.find(x => x.segmentId === id)
    assert.equal(Date.parse(c.starts_at), Date.parse(at('12:00')))
    assert.equal(Date.parse(c.ends_at), Date.parse(at('12:30')))
  }
  for (const id of copies(data, 'Lunch')) {
    const c = startLater.changes.find(x => x.segmentId === id)
    assert.equal(Date.parse(c.starts_at), Date.parse(at('13:00')))
    assert.equal(Date.parse(c.ends_at), Date.parse(at('14:00')), 'same finish time')
  }
  for (const option of [endOnTime, startLater]) {
    const plan = evaluateRecoveryPlan({ data, eventId, disruptions: ds, option })
    assert.ok(!plan.conflicts.some(c => c.type === 'MEMBER_DOUBLE_BOOKING'), option.title)
  }
  const keep = options.find(o => !o.kind || o.kind === 'facility-delay' || /Keep delayed/.test(o.title))
  if (keep) assert.ok(evaluateRecoveryPlan({ data, eventId, disruptions: ds, option: keep }).conflicts.some(c => c.type === 'MEMBER_DOUBLE_BOOKING'))
})

test('delay into a fixed task: never moves the fixed task; ending on time still works', () => {
  const { data } = fixture()
  const show = seg(data, 'Show', 2).id
  const { eventId, ds, options } = run(data, delayAll(data, 'Greet guest', 15))
  for (const option of options) assert.ok(!option.changes.some(c => c.segmentId === show && (c.starts_at || c.ends_at)), option.title)
  assert.ok(!options.some(o => o.id === 'crew-shorten'), 'cannot start a fixed task later')
  const endOnTime = options.find(o => o.id === 'delay-end-on-time')
  assert.equal(Date.parse(endOnTime.changes[0].ends_at), Date.parse(at('18:00')))
  assert.ok(!evaluateRecoveryPlan({ data, eventId, disruptions: ds, option: endOnTime }).conflicts.length)
})

test('end on time is not offered when under 15 minutes would be left', () => {
  const { data } = fixture()
  const { options } = run(data, delayAll(data, 'Greet guest', 50))
  assert.ok(!options.some(o => o.id === 'delay-end-on-time'))
})

test('summary counts an activity once and mentions double-booked crew', () => {
  const { data } = fixture()
  const { eventId, ds, result } = run(data, delayAll(data, 'Brief Emcees', 30))
  const text = simulationImpactSummary({ data, eventId, result, disruptions: ds })
  assert.equal(text.match(/Brief Emcees/g).length, 2, 'once as the cause, once as the impact')
  assert.match(text, /2 crew members are now due somewhere else/)
})

test('venue-only stand-ins add no booking warnings to a person-swap plan', () => {
  const { data } = fixture()
  const { eventId, ds, options } = run(data, [{ id: 'm', type: 'MEMBER_UNAVAILABLE', memberId: 1, start: at('09:30'), end: at('14:00') }])
  for (const option of options) {
    const plan = evaluateRecoveryPlan({ data, eventId, disruptions: ds, option })
    assert.ok(!plan.warnings.some(w => /Booking approval pending|Booking verification required/.test(w)), option.title)
  }
})

test('simulating never changes the original Day Ops records', () => {
  const { data, tasks } = fixture()
  const before = JSON.stringify({ data, tasks })
  run(data, delayAll(data, 'Brief Emcees', 30))
  run(data, [{ id: 'f', type: 'FACILITY_UNAVAILABLE', venueName: 'Main Hall', facilityBookingId: data.facility_slots.find(s => s.venue_name === 'Main Hall').id, start: at('09:30'), end: at('20:00') }])
  assert.equal(JSON.stringify({ data, tasks }), before)
})
