
import { supabase, unwrap } from './supabaseClient'
import { demoMemberId } from './sessionState'
//reuse naming 
export const STATUSES = {
  BOOKED: 'Booked',
  PROPOSED: 'Proposed Peer Transfer',
  PENDING: 'Pending Admin Sign-off',
  CONFIRMED: 'Officially Confirmed Booking'
}

const STATUS_ORDER = {
  'Proposed Peer Transfer': 0,
  'Pending Admin Sign-off': 1,
  'Booked': 2,
  'Officially Confirmed Booking': 3
}

export const CALENDAR_END = await fetchCalendarEndDate()


// Booking dates are stored as 'YYYY-MM-DD' strings in Supabase.
// Keeping them as date strings avoids unnecessary timezone conversions
// that could shift a booking to the previous or next day.

//Use Intl.DateTimeFormat =>JS built-in date and time formatter to ensure use of Sg date
// and en-CA produces needed date format
//timeZone -> convert to Singapore's time zone
//format->format the current date as a string
export function singaporeToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date())
}

//Adds or subtracts a specified number of days from a date without 
// being affected by the user's browser timezone
//UTC -> ensure its in UTC JS Date format
//dateString and days are enquired from database -> strings and int
//.toISOString() + slice -> convert UTC date object to ISO string without the timing only date
export function addDays(dateString, days) {
  const d = new Date(`${dateString}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
//find the monday(0) date of a given week
//does not prevent weekstart from exceeding calendar_end unlike weekend
export function weekStartOf(dateString) {
  const d = new Date(`${dateString}T00:00:00Z`)
  const isoDay = d.getUTCDay() || 7
  return addDays(dateString, 1 - isoDay)
}

// Default view: the next Monday–Sunday week.
export function defaultWeekStart() {
  return addDays(weekStartOf(singaporeToday()), 7)
}

// Mirrors the database rule (transfer_lead_days = 4) for display only.
export const TRANSFER_LEAD_DAYS = 4
export function transferCutoffDate() {
  return addDays(singaporeToday(), TRANSFER_LEAD_DAYS)
}
//format date to human-readable string
//.toLocaleDateString('en-SG') -> formats date using Singapore English convention
//'short' -> short form it 
//withYear=false -> won't show year else would show year in numeric form
export function formatDate(dateString, withYear = false) {
  return new Date(`${dateString}T00:00:00Z`).toLocaleDateString('en-SG', {
    weekday: 'short', day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC'
  })
}
//display weekly calendar range -> ensure that displayed end date(suppose to be sunday 6) will not exceed calendar_end
export function formatWeekLabel(weekStart) {
  const end = addDays(weekStart, 6) > CALENDAR_END ? CALENDAR_END : addDays(weekStart, 6)
  const opts = { day: 'numeric', month: 'short', timeZone: 'UTC' }
  const startLabel = new Date(`${weekStart}T00:00:00Z`).toLocaleDateString('en-SG', opts)
  const endLabel = new Date(`${end}T00:00:00Z`).toLocaleDateString('en-SG', { ...opts, year: 'numeric' })
  return `${startLabel} – ${endLabel}`
}

export function formatTime(t) {
  return (t || '').slice(0, 5)
}

export function capacityLabel(facility) {
  return facility.capacity_is_estimate ? `~${facility.capacity} (estimate)` : `${facility.capacity} (published)`
}

// ---------------------------------------------------------------- reads from data base
export async function fetchFacilities() {
  return unwrap(await supabase.from('facilities').select('*').eq('is_active', true).order('name'))
}

export async function fetchCalendar({ from, to, ownerClubId, statuses } = {}) {
  let query = supabase.from('v_master_facility_calendar').select('*')
  if (from) query = query.gte('booking_date', from)
  if (to) query = query.lte('booking_date', to)
  if (ownerClubId) query = query.eq('owner_club_id', ownerClubId)
  if (statuses) query = query.in('status', statuses)
  const rows = unwrap(await query
    .order('facility_name')
    .order('booking_date')
    .order('start_time'))
  // Released and pending first inside each facility.
  return rows.sort((a, b) =>
    (a.facility_name || '').localeCompare(b.facility_name || '') ||
    (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
    (a.booking_date || '').localeCompare(b.booking_date || '') ||
    (a.start_time || '').localeCompare(b.start_time || ''))
}

export async function fetchClubTransfers(clubId) {
  return unwrap(await supabase.rpc('rpc_club_transfers', { p_club_id: clubId, p_demo_member_id: demoMemberId() }))
}
export async function fetchCalendarEndDate() {
  const { data, error } = await supabase
    .from('app_config')
    .select('value')
    .eq('key', 'calendar_end_date')
    .single()

  if (error) {
    console.log(error.message)
    return '2026-12-31' // fallback
  }

  return data.value
}
// ---------------------------------------------------------------- actions
export async function releaseBooking(bookingId, clubId) {
  return unwrap(await supabase.rpc('rpc_release_booking', { p_booking_id: bookingId, p_club_id: clubId, p_demo_member_id: demoMemberId() }))
}

export async function undoRelease(bookingId, clubId) {
  return unwrap(await supabase.rpc('rpc_undo_release', { p_booking_id: bookingId, p_club_id: clubId, p_demo_member_id: demoMemberId() }))
}

// Also used to accept a waitlist offer.
export async function claimBooking(bookingId, clubId) {
  return unwrap(await supabase.rpc('rpc_claim_booking', { p_booking_id: bookingId, p_club_id: clubId, p_demo_member_id: demoMemberId() }))
}

export async function resetDemoData() {
  return unwrap(await supabase.rpc('rpc_reset_demo_data'))
}

// ---------------------------------------------------------------- realtime
export function subscribeToCalendarChanges(onChange) {
  const channel = supabase
    .channel(`calendar-${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'facility_bookings' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'waitlist_entries' }, onChange)
    .subscribe()
  return () => supabase.removeChannel(channel)
}

// ---------------------------------------------------------------- permissions (UI only)
// Decides which buttons a booking row shows. The database repeats every
// check, so this only keeps the screen honest; it is not the security.
export function bookingActions(booking, { clubId, canManage, isOslAdmin, waitlistEntry }) {
  const actions = []
  const mine = booking.owner_club_id === clubId

  if (isOslAdmin && booking.status === STATUSES.PENDING) {
    return [{ type: 'review', label: 'Review', variant: 'primary' }]
  }
  if (!canManage || !clubId) return actions
  if (!booking.is_transfer_window_open) {
    return [{ type: 'locked', label: 'Locked', hint: `Transfers close ${TRANSFER_LEAD_DAYS} days before the booking` }]
  }

  if (mine) {
    if (booking.status === STATUSES.BOOKED) actions.push({ type: 'release', label: 'Release', variant: 'primary' })
    if (booking.status === STATUSES.PROPOSED) {
      const held = !!booking.offered_club_id
      actions.push({
        type: 'undo', label: 'Undo Release', variant: 'outline', disabled: held,
        hint: held ? `${booking.offered_club_name} holds a waitlist offer` : ''
      })
    }
    return actions
  }

  // Our own claim is waiting for OSL; nothing to do but wait.
  if (booking.status === STATUSES.PENDING && booking.claiming_club_id === clubId) return actions

  if (booking.status === STATUSES.PROPOSED) {
    if (booking.offered_club_id === clubId) {
      actions.push({ type: 'claim', label: 'Accept offer', variant: 'primary' })
      return actions
    }
    if (!booking.offered_club_id) {
      actions.push({ type: 'claim', label: 'Claim', variant: 'primary' })
      return actions
    }
  }

  if (waitlistEntry) {
    actions.push({ type: 'leave', label: `Leave waitlist (#${waitlistEntry.queue_position})`, variant: 'warning' })
  } else {
    actions.push({ type: 'join', label: 'Join waitlist', variant: 'outline' })
  }
  return actions
}
