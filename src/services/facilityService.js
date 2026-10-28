
// Facility bookings for the Master Facility Calendar: reading the calendar,
// releasing, claiming, undoing a release, plus date helpers.
// Every action is checked again by the database, so these buttons are not
// the security; they just call the right database function.
 
import { supabase } from '../supabase'
import { demoMemberId } from './sessionState'
 
// Supabase returns { data, error }: throw the error, otherwise give back the rows.
// supabase is null when the .env keys are missing, so say so clearly instead of crashing.
function unwrap(response) {
  if (response.error) {
    throw new Error(response.error.message)
  }
  return response.data
}
 
function requireSupabase() {
  if (!supabase) {
    throw new Error('Supabase is not configured on this device.')
  }
}
 
// The four booking statuses used in facility_bookings.status (reuse these names everywhere)
export const STATUSES = {
  BOOKED: 'Booked',
  PROPOSED: 'Proposed Peer Transfer',
  PENDING: 'Pending Admin Sign-off',
  CONFIRMED: 'Officially Confirmed Booking'
}
 
// Order used when sorting: released slots first, confirmed last
const STATUS_ORDER = {
  'Proposed Peer Transfer': 0,
  'Pending Admin Sign-off': 1,
  'Booked': 2,
  'Officially Confirmed Booking': 3
}
 
// The last date the calendar shows.
// It starts with a fallback and is replaced by the database value
// (pulse_config 'calendar_end_date') when fetchCalendarEndDate() runs.
// "export let" lets other files see the new value after it changes.
export let CALENDAR_END = '2026-12-31'
 
// Transfers close this many days before the booking.
// Mirrors the database rule (transfer_lead_days = 4) for display only.
export const TRANSFER_LEAD_DAYS = 4
 
// ---------------- Dates ----------------
// Booking dates are stored as 'YYYY-MM-DD' strings in Supabase.
// Keeping them as date strings (and working in UTC) avoids timezone
// conversions that could shift a booking to the previous or next day.
 
// Today's date in Singapore, e.g. '2026-10-28'
// Intl.DateTimeFormat -> JS built-in date and time formatter
// 'en-CA' -> produces the YYYY-MM-DD format we need
// timeZone -> use Singapore's time zone, whatever the laptop's setting
// format() -> turn the current date into that string
export function singaporeToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date())
}
 
// Adds (or, with a negative number, subtracts) days from a date
// without being affected by the browser's timezone.
// 'T00:00:00Z' -> midnight UTC, so the date never shifts
// toISOString().slice(0, 10) -> keep only the 'YYYY-MM-DD' part, drop the time
// e.g. '2026-10-28' + 3 days -> '2026-10-31'
export function addDays(dateString, days) {
  const date = new Date(dateString + 'T00:00:00Z')
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
 
// Finds the Monday of the week a date falls in.
// getUTCDay() gives 0 = Sunday ... 6 = Saturday; we treat Sunday as day 7
// so the week runs Monday to Sunday.
// (Unlike formatWeekLabel, this does not stop at CALENDAR_END.)
export function weekStartOf(dateString) {
  const date = new Date(dateString + 'T00:00:00Z')
  let day = date.getUTCDay()
  if (day === 0) {
    day = 7
  }
  return addDays(dateString, 1 - day)
}
 
// Default view: next week (Monday to Sunday)
export function defaultWeekStart() {
  return addDays(weekStartOf(singaporeToday()), 7)
}
 
// The first date that can still be released or claimed
export function transferCutoffDate() {
  return addDays(singaporeToday(), TRANSFER_LEAD_DAYS)
}
 
// Formats a date as a human-readable string: '2026-11-05' -> 'Thu, 5 Nov'
// toLocaleDateString('en-SG') -> Singapore English conventions
// 'short' -> short names (Thu, Nov)
// withYear = false -> no year; true -> 'Thu, 5 Nov 2026'
export function formatDate(dateString, withYear = false) {
  const options = { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }
  if (withYear) {
    options.year = 'numeric'
  }
  return new Date(dateString + 'T00:00:00Z').toLocaleDateString('en-SG', options)
}
 
// The week range shown above the calendar, e.g. '2 Nov – 8 Nov 2026'.
// The end date (normally the Sunday, 6 days later) never goes past CALENDAR_END.
export function formatWeekLabel(weekStart) {
  let weekEnd = addDays(weekStart, 6)
  if (weekEnd > CALENDAR_END) {
    weekEnd = CALENDAR_END
  }
  const startLabel = new Date(weekStart + 'T00:00:00Z').toLocaleDateString('en-SG', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  const endLabel = new Date(weekEnd + 'T00:00:00Z').toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  return startLabel + ' – ' + endLabel
}
 
// '18:00:00' -> '18:00'
export function formatTime(time) {
  if (!time) {
    return ''
  }
  return time.slice(0, 5)
}
 
// '~40 (estimate)' or '40 (published)'
export function capacityLabel(facility) {
  if (facility.capacity_is_estimate) {
    return '~' + facility.capacity + ' (estimate)'
  }
  return facility.capacity + ' (published)'
}
 
// ---------------- Reading data from the database ----------------
 
// Reads the calendar's last date from the database and updates CALENDAR_END.
// cfg_text is a database function that reads one setting from pulse_config.
// If anything fails we keep the fallback date, so the calendar still works.
export async function fetchCalendarEndDate() {
  if (!supabase) {
    return CALENDAR_END
  }
  try {
    const value = unwrap(await supabase.rpc('cfg_text', { p_key: 'calendar_end_date' }))
    if (value) {
      CALENDAR_END = value
    }
  } catch (error) {
    console.log(error.message)
  }
  return CALENDAR_END
}
 
// Every active facility, A to Z
export async function fetchFacilities() {
  requireSupabase()
  return unwrap(await supabase
    .from('facilities')
    .select('*')
    .eq('is_active', true)
    .order('name'))
}
 
// Bookings between two dates. filters can have: from, to, ownerClubId, statuses
// "filters = {}" -> if nothing is passed, use an empty object (no filters)
export async function fetchCalendar(filters = {}) {
  requireSupabase()
 
  // The first time the calendar loads, also read the end date from the database
  await fetchCalendarEndDate()
 
  let query = supabase.from('v_master_facility_calendar').select('*')
  if (filters.from) {
    query = query.gte('booking_date', filters.from)
  }
  if (filters.to) {
    query = query.lte('booking_date', filters.to)
  }
  if (filters.ownerClubId) {
    query = query.eq('owner_club_id', filters.ownerClubId)
  }
  if (filters.statuses) {
    query = query.in('status', filters.statuses)
  }
 
  const rows = unwrap(await query.order('facility_name').order('booking_date').order('start_time'))
 
  // Inside each facility: released and pending slots first, then by date and time.
  // (a.x || '') guards against an empty value; an unknown status sorts last (9).
  rows.sort((a, b) => {
    const facilityA = a.facility_name || ''
    const facilityB = b.facility_name || ''
    if (facilityA !== facilityB) {
      return facilityA.localeCompare(facilityB)
    }
 
    let orderA = STATUS_ORDER[a.status]
    let orderB = STATUS_ORDER[b.status]
    if (orderA === undefined) {
      orderA = 9
    }
    if (orderB === undefined) {
      orderB = 9
    }
    if (orderA !== orderB) {
      return orderA - orderB
    }
 
    const dateA = a.booking_date || ''
    const dateB = b.booking_date || ''
    if (dateA !== dateB) {
      return dateA.localeCompare(dateB)
    }
    return (a.start_time || '').localeCompare(b.start_time || '')
  })
  return rows
}
 
// Every transfer this CCA released or claimed (for My Club)
export async function fetchClubTransfers(clubId) {
  requireSupabase()
  return unwrap(await supabase.rpc('rpc_club_transfers', {
    p_club_id: clubId,
    p_demo_member_id: demoMemberId()
  }))
}
 
// ---------------- Actions ----------------
 
// Our CCA gives up a booking (it becomes a Proposed Peer Transfer)
export async function releaseBooking(bookingId, clubId) {
  requireSupabase()
  return unwrap(await supabase.rpc('rpc_release_booking', {
    p_booking_id: bookingId,
    p_club_id: clubId,
    p_demo_member_id: demoMemberId()
  }))
}
 
// Take back a release before anyone claims it
export async function undoRelease(bookingId, clubId) {
  requireSupabase()
  return unwrap(await supabase.rpc('rpc_undo_release', {
    p_booking_id: bookingId,
    p_club_id: clubId,
    p_demo_member_id: demoMemberId()
  }))
}
 
// Claim a released slot. Also used to accept a waitlist offer.
// The OSL request email is sent automatically.
export async function claimBooking(bookingId, clubId) {
  requireSupabase()
  return unwrap(await supabase.rpc('rpc_claim_booking', {
    p_booking_id: bookingId,
    p_club_id: clubId,
    p_demo_member_id: demoMemberId()
  }))
}
 
// "Reset demo" button: clears demo transfers and seeds them again
export async function resetDemoData() {
  requireSupabase()
  return unwrap(await supabase.rpc('rpc_reset_demo_data'))
}
 
// ---------------- Realtime ----------------
 
// Supabase Realtime: run onChange when any booking or waitlist row changes,
// so every open calendar updates without a refresh.
// Returns a function that stops listening (call it when the page closes).
export function listenForCalendarChanges(onChange) {
  // No Supabase connection: nothing to listen to, so return a stop function that does nothing
  if (!supabase) {
    return function stopListening() {}
  }
 
  // Each page gets its own channel name, so two open pages don't clash
  const channel = supabase
    .channel('calendar-' + Date.now() + '-' + Math.random().toString(36).slice(2))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'facility_bookings' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'waitlist_entries' }, onChange)
    .subscribe()
 
  function stopListening() {
    supabase.removeChannel(channel)
  }
  return stopListening
}
 
// Old name, kept so any file still using subscribeToCalendarChanges keeps working
export const subscribeToCalendarChanges = listenForCalendarChanges
 
// ---------------- Which buttons a booking shows (UI only) ----------------
// Decides which buttons a booking row shows. The database repeats every
// check, so this only keeps the screen honest; it is not the security.
// options has: clubId, canManage, isOslAdmin, waitlistEntry
export function bookingActions(booking, options) {
  const actions = []
  const isOurs = booking.owner_club_id === options.clubId
 
  // OSL reviews pending claims
  if (options.isOslAdmin && booking.status === STATUSES.PENDING) {
    actions.push({ type: 'review', label: 'Review', variant: 'primary' })
    return actions
  }
 
  // View-only members and public viewers get no buttons
  if (!options.canManage || !options.clubId) {
    return actions
  }
 
  // Too close to the booking date
  if (!booking.is_transfer_window_open) {
    actions.push({ type: 'locked', label: 'Locked', hint: 'Transfers close ' + TRANSFER_LEAD_DAYS + ' days before the booking' })
    return actions
  }
 
  // Our own booking: release it, or undo the release
  if (isOurs) {
    if (booking.status === STATUSES.BOOKED) {
      actions.push({ type: 'release', label: 'Release', variant: 'primary' })
    }
    if (booking.status === STATUSES.PROPOSED) {
      // Can't undo while another CCA is holding the 30-minute offer
      let hint = ''
      if (booking.offered_club_id) {
        hint = booking.offered_club_name + ' holds a waitlist offer'
      }
      actions.push({ type: 'undo', label: 'Undo Release', variant: 'outline', disabled: !!booking.offered_club_id, hint: hint })
    }
    return actions
  }
 
  // We claimed it and OSL hasn't decided yet: nothing to do but wait
  if (booking.status === STATUSES.PENDING && booking.claiming_club_id === options.clubId) {
    return actions
  }
 
  // Released by another CCA
  if (booking.status === STATUSES.PROPOSED) {
    if (booking.offered_club_id === options.clubId) {
      actions.push({ type: 'claim', label: 'Accept offer', variant: 'primary' })
      return actions
    }
    if (!booking.offered_club_id) {
      actions.push({ type: 'claim', label: 'Claim', variant: 'primary' })
      return actions
    }
  }
 
  // Otherwise: join or leave the waitlist
  if (options.waitlistEntry) {
    actions.push({ type: 'leave', label: 'Leave waitlist (#' + options.waitlistEntry.queue_position + ')', variant: 'warning' })
  } else {
    actions.push({ type: 'join', label: 'Join waitlist', variant: 'outline' })
  }
  return actions
}