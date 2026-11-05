// Day-of Operations: reading and saving a CCA's events, crew and tasks.
// Tables: ops_events, ops_event_crew, ops_tasks (supabase/migrations/20261104000100_pulse_ops_events.sql,
// event start/end times in 20261104000200_pulse_ops_event_times.sql).
// The database only lets active ExCos of the event's CCA read or change them.

import { supabase } from '../supabase'

// Supabase returns { data, error }: throw the error, otherwise give back the rows
function unwrap(response) {
  if (response.error) {
    throw response.error
  }
  return response.data
}

// True when the error means the ops tables haven't been created yet
export function isMissingTableError(error) {
  return error?.code === '42P01' || error?.code === 'PGRST205'
}

// '18:30:00' -> 1110 (minutes after midnight), and back
function timeToMinutes(time) {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`
}

// The CCA's active ExCos: who can be put on an event's crew
export async function loadClubExcos(clubId) {
  const rows = unwrap(await supabase
    .from('v_user_club_memberships')
    .select('member_id, full_name, role_name, telegram_handle, membership_is_active')
    .eq('club_id', clubId)
    .order('full_name'))

  return rows
    .filter((row) => row.membership_is_active !== false)
    .map((row) => ({
      memberId: Number(row.member_id),
      name: row.full_name,
      role: row.role_name || 'ExCo',
      phone: row.telegram_handle || ''
    }))
}

// False until 20261104000200 has been run (ops_events has no start/end time yet)
let hasEventTimes = true

// '42703' / 'PGRST204': the column doesn't exist
function isMissingColumnError(error) {
  return error?.code === '42703' || error?.code === 'PGRST204'
}

function selectEvents(clubId) {
  // The !name picks which link to follow (tasks also link to crew, so there's more than one path)
  const eventColumns = hasEventTimes ? 'id, name, event_date, venue, start_time, end_time' : 'id, name, event_date, venue'
  return supabase
    .from('ops_events')
    .select(`${eventColumns}, ops_event_crew!ops_event_crew_event_id_fkey(member_id, checked_in_at, late), ops_tasks!ops_tasks_event_id_fkey(id, member_id, title, task_type, start_time, end_time, venue, is_fixed)`)
    .eq('club_id', clubId)
    .order('event_date')
}

// All of a CCA's events, in the shape the page uses (times in minutes)
export async function loadEvents(clubId, excos) {
  let response = await selectEvents(clubId)
  if (hasEventTimes && isMissingColumnError(response.error)) {
    hasEventTimes = false
    response = await selectEvents(clubId)
  }
  const rows = unwrap(response)

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    date: row.event_date,
    venue: row.venue || '',
    start: row.start_time ? timeToMinutes(row.start_time) : null,
    end: row.end_time ? timeToMinutes(row.end_time) : null,
    crew: row.ops_event_crew.map((c) => {
      const exco = excos.find((e) => e.memberId === Number(c.member_id))
      return {
        memberId: Number(c.member_id),
        name: exco ? exco.name : 'Former ExCo',
        role: exco ? exco.role : '',
        phone: exco ? exco.phone : '',
        checkedInAt: c.checked_in_at ? timeToMinutes(c.checked_in_at) : null,
        late: c.late || '',
        blocks: row.ops_tasks
          .filter((t) => Number(t.member_id) === Number(c.member_id))
          .map((t) => ({
            id: t.id,
            start: timeToMinutes(t.start_time),
            end: timeToMinutes(t.end_time),
            title: t.title,
            type: t.task_type,
            venue: t.venue || '',
            fixed: t.is_fixed
          }))
      }
    })
  }))
}

// Save one event as it is now: details, crew (with check-ins) and tasks.
// Crew or tasks no longer on the page are removed.
// createdBy is only passed the first time, so later saves keep the original creator.
export async function saveEvent(clubId, event, createdBy = null) {
  const details = {
    id: event.id,
    club_id: clubId,
    name: event.name,
    event_date: event.date,
    venue: event.venue || null
  }
  if (hasEventTimes) {
    details.start_time = event.start == null ? null : minutesToTime(event.start)
    details.end_time = event.end == null ? null : minutesToTime(event.end)
  }
  if (createdBy !== null) details.created_by = createdBy
  unwrap(await supabase.from('ops_events').upsert(details))

  const memberIds = event.crew.map((p) => p.memberId)
  const taskIds = event.crew.flatMap((p) => p.blocks.map((b) => b.id))

  // Remove tasks first, then crew (removing crew also removes their tasks)
  let removeTasks = supabase.from('ops_tasks').delete().eq('event_id', event.id)
  if (taskIds.length) removeTasks = removeTasks.not('id', 'in', `(${taskIds.join(',')})`)
  unwrap(await removeTasks)

  let removeCrew = supabase.from('ops_event_crew').delete().eq('event_id', event.id)
  if (memberIds.length) removeCrew = removeCrew.not('member_id', 'in', `(${memberIds.join(',')})`)
  unwrap(await removeCrew)

  if (memberIds.length) {
    unwrap(await supabase.from('ops_event_crew').upsert(event.crew.map((p) => ({
      event_id: event.id,
      member_id: p.memberId,
      checked_in_at: p.checkedInAt === null ? null : minutesToTime(p.checkedInAt),
      late: p.late || null
    })), { onConflict: 'event_id,member_id' }))
  }

  if (taskIds.length) {
    unwrap(await supabase.from('ops_tasks').upsert(event.crew.flatMap((p) => p.blocks.map((b) => ({
      id: b.id,
      event_id: event.id,
      member_id: p.memberId,
      title: b.title,
      task_type: b.type,
      start_time: minutesToTime(b.start),
      end_time: minutesToTime(b.end),
      venue: b.venue || null,
      is_fixed: b.fixed
    })))))
  }
}

export async function deleteEvent(eventId) {
  unwrap(await supabase.from('ops_events').delete().eq('id', eventId))
}

// ---------------- Day-of Ops & Personal Schedule Cross-Sync Helpers ----------------

export function resolveSmuBuilding(venueStr = "") {
  const v = (venueStr || "").toLowerCase()
  if (v.includes("studio") || v.includes("connexion") || v.includes("l7.2") || v.includes("7.1")) {
    return "SMU CONNEXION"
  }
  if (v.includes("scis") || v.includes("seminar room") || v.includes("sr 2.1") || v.includes("lab")) {
    return "SMU SCHOOL OF COMPUTING AND INFORMATION SYSTEMS 1"
  }
  if (v.includes("main hall") || v.includes("library") || v.includes("b1") || v.includes("holding room") || v.includes("audio & lighting") || v.includes("booth") || v.includes("lorry") || v.includes("loading bay")) {
    return "LI KA SHING LIBRARY"
  }
  if (v.includes("bazaar") || v.includes("campus green") || v.includes("admin") || v.includes("osl")) {
    return "SMU ADMINISTRATION BUILDING"
  }
  if (v.includes("soe") || v.includes("soss") || v.includes("social sciences") || v.includes("economics")) {
    return "SMU SCHOOL OF ECONOMICS & SCHOOL OF SOCIAL SCIENCES"
  }
  if (v.includes("law") || v.includes("yphsl")) {
    return "SMU YONG PUNG HOW SCHOOL OF LAW"
  }
  if (v.includes("lkcsb") || v.includes("business")) {
    return "SMU LEE KONG CHIAN SCHOOL OF BUSINESS"
  }
  return "LI KA SHING LIBRARY"
}

function getTodayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export function getDefaultSampleOpsEvents(clubName = "Eurhythmix") {
  const today = getTodayIso()
  return [
    {
      id: "ops-sample-showcase",
      name: "Showcase",
      date: today,
      venue: "Main Hall",
      crew: [
        {
          memberId: 2,
          name: "Rachel Tan",
          role: "Logistics Director",
          phone: "@racheltan",
          checkedInAt: 895, // 14:55
          late: "",
          blocks: [
            { id: "b1", start: 900, end: 960, title: "Collect props from Studio 7.1", type: "setup", venue: "Studio 7.1", fixed: false },
            { id: "b2", start: 960, end: 990, title: "Walk to Main Hall", type: "move", venue: "Campus Concourse • 8 min walk", fixed: false },
            { id: "b3", start: 990, end: 1050, title: "Stage setup", type: "setup", venue: "Main Hall Stage", fixed: false },
            { id: "b4", start: 1050, end: 1110, title: "Dinner", type: "meal", venue: "Holding Room B1.2", fixed: false },
            { id: "b5", start: 1110, end: 1170, title: "Tech rehearsal", type: "perform", venue: "Main Hall Stage", fixed: false },
            { id: "b6", start: 1170, end: 1200, title: "Front of house check", type: "other", venue: "Main Hall Foyer", fixed: false },
            { id: "b7", start: 1200, end: 1320, title: "Performance (backstage lead)", type: "perform", venue: "Main Hall Stage", fixed: true },
            { id: "b8", start: 1320, end: 1350, title: "Teardown", type: "setup", venue: "Main Hall Stage", fixed: false }
          ]
        },
        {
          memberId: 3,
          name: "Angel Low",
          role: "Lead Dancer",
          phone: "@angellow",
          checkedInAt: 898, // 14:58
          late: "",
          blocks: [
            { id: "b21", start: 900, end: 990, title: "Warm up + run Act 2", type: "perform", venue: "Studio 7.1", fixed: false },
            { id: "b22", start: 990, end: 1020, title: "Walk to Main Hall", type: "move", venue: "Campus Concourse • 8 min walk", fixed: false },
            { id: "b23", start: 1020, end: 1050, title: "Spacing on stage", type: "perform", venue: "Main Hall Stage", fixed: false },
            { id: "b24", start: 1050, end: 1110, title: "Dinner + change into costumes", type: "meal", venue: "Holding Room B1.2", fixed: false },
            { id: "b25", start: 1110, end: 1170, title: "Tech rehearsal", type: "perform", venue: "Main Hall Stage", fixed: false },
            { id: "b26", start: 1170, end: 1200, title: "Hair & makeup", type: "other", venue: "Holding Room B1.2", fixed: false },
            { id: "b27", start: 1200, end: 1320, title: "Performance", type: "perform", venue: "Main Hall Stage", fixed: true },
            { id: "b28", start: 1320, end: 1350, title: "Teardown", type: "setup", venue: "Main Hall Stage", fixed: false }
          ]
        },
        {
          memberId: 5,
          name: "Darren Koh",
          role: "Props Head",
          phone: "@darrenk",
          checkedInAt: null,
          late: "Running 10 min late (SOE seminar)",
          blocks: [
            { id: "b41", start: 900, end: 960, title: "Load props onto lorry", type: "setup", venue: "Studio 7.1", fixed: false },
            { id: "b42", start: 960, end: 990, title: "Go with lorry", type: "move", venue: "Loading Bay", fixed: false },
            { id: "b43", start: 990, end: 1050, title: "Stage setup", type: "setup", venue: "Main Hall Stage", fixed: false },
            { id: "b44", start: 1050, end: 1080, title: "Buy dinner for ExCo", type: "other", venue: "Campus Basement", fixed: false },
            { id: "b45", start: 1080, end: 1110, title: "Dinner", type: "meal", venue: "Holding Room B1.2", fixed: false },
            { id: "b46", start: 1110, end: 1170, title: "Tech rehearsal", type: "perform", venue: "Main Hall Stage", fixed: false },
            { id: "b47", start: 1170, end: 1200, title: "Props check", type: "setup", venue: "Backstage", fixed: false },
            { id: "b48", start: 1200, end: 1320, title: "Performance (props crew)", type: "perform", venue: "Backstage", fixed: true },
            { id: "b49", start: 1320, end: 1350, title: "Teardown + load lorry", type: "setup", venue: "Loading Bay", fixed: false }
          ]
        }
      ]
    }
  ]
}

export function getStoredOpsEvents(clubName = "Eurhythmix") {
  try {
    const raw = localStorage.getItem(`pulse_ops_events:${clubName || "demo"}`)
    if (raw) {
      const parsed = JSON.parse(raw)
      // The Operations page saves { events, selectedEventId }
      const saved = Array.isArray(parsed) ? parsed : parsed?.events
      if (Array.isArray(saved) && saved.length > 0) return saved
    }
  } catch {}
  return null
}

export function getOpsTasksForMember(memberName, clubName = "Eurhythmix") {
  if (!memberName) return { tasks: [], eventName: "", eventDate: "", tasksCount: 0 }
  
  let allEvents = getStoredOpsEvents(clubName)
  if (!allEvents || allEvents.length === 0) {
    allEvents = getDefaultSampleOpsEvents(clubName)
  }

  const normalizedTarget = memberName.trim().toLowerCase()
  return opsTasksFromEvents(allEvents, (c) => {
    const cName = (c.name || "").toLowerCase()
    return cName === normalizedTarget || cName.includes(normalizedTarget) || normalizedTarget.includes(cName)
  })
}

// A signed-in member's tasks, from the same saved events the Operations page shows
export async function fetchMyOpsTasks(clubId, memberId) {
  const excos = await loadClubExcos(clubId)
  const events = await loadEvents(clubId, excos)
  return opsTasksFromEvents(events, (c) => c.memberId === Number(memberId))
}

function opsTasksFromEvents(allEvents, isThisPerson) {
  const matchedTasks = []
  const matchedEvents = []

  for (const ev of allEvents) {
    if (!ev || !ev.crew || !Array.isArray(ev.crew)) continue

    const crewPerson = ev.crew.find(isThisPerson)

    if (crewPerson && Array.isArray(crewPerson.blocks) && crewPerson.blocks.length > 0) {
      matchedEvents.push(ev)
      for (const [idx, b] of crewPerson.blocks.entries()) {
        const startStr = typeof b.start === "number" ? minutesToTime(b.start).slice(0, 5) : (b.start || "15:00")
        const endStr = typeof b.end === "number" ? minutesToTime(b.end).slice(0, 5) : (b.end || "16:00")
        const combinedVenue = b.venue ? `${b.venue}, ${ev.venue || "Main Hall"}` : (ev.venue || "Main Hall")

        matchedTasks.push({
          id: `ops-${ev.id}-${b.id || idx}`,
          title: `${b.title} (${ev.name})`,
          category: "Day-of Ops",
          date: ev.date,
          startTime: startStr,
          endTime: endStr,
          venue: combinedVenue,
          building: resolveSmuBuilding(b.venue || ev.venue),
          room: b.venue || ev.venue || "Main Hall",
          role: crewPerson.role || "Crew Member",
          status: b.fixed ? "In Progress" : "Not Started",
          notes: `Assigned in Day-of Operations for ${ev.name}. ${b.fixed ? "Fixed time performance schedule." : ""}`,
          isCustom: false,
          isOpsTask: true,
          eventId: ev.id
        })
      }
    }
  }

  // The banner points at the next event, or the latest one once they have all passed
  const today = getTodayIso()
  const ordered = [...matchedEvents].sort((a, b) => a.date.localeCompare(b.date))
  const primary = ordered.find((ev) => ev.date >= today) || ordered[ordered.length - 1]

  return {
    tasks: matchedTasks,
    eventName: primary?.name || "",
    eventDate: primary?.date || "",
    tasksCount: matchedTasks.length,
    eventsCount: matchedEvents.length
  }
}
