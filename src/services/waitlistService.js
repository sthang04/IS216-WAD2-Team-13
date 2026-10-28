import { supabase, unwrap } from './supabaseClient'
import { demoMemberId } from './sessionState'

export async function fetchClubWaitlist(clubId) {
  return unwrap(await supabase
    .from('v_waitlist_queue')
    .select('*')
    .eq('club_id', clubId)
    .order('booking_date')
    .order('start_time'))
}

export async function fetchActiveClubEntries(clubId) {
  return unwrap(await supabase
    .from('v_waitlist_queue')
    .select('entry_id, booking_id, status, queue_position, offer_expires_at')
    .eq('club_id', clubId)
    .in('status', ['WAITING', 'OFFERED']))
}

export async function fetchQueue(bookingId) {
  return unwrap(await supabase
    .from('v_waitlist_queue')
    .select('*')
    .eq('booking_id', bookingId)
    .in('status', ['WAITING', 'OFFERED'])
    .order('queue_position'))
}

export async function joinWaitlist(bookingId, clubId) {
  return unwrap(await supabase.rpc('rpc_join_waitlist', { p_booking_id: bookingId, p_club_id: clubId, p_demo_member_id: demoMemberId() }))
}

// Leaving while holding an offer declines it; the next club is promoted.
export async function leaveWaitlist(bookingId, clubId) {
  return unwrap(await supabase.rpc('rpc_leave_waitlist', { p_booking_id: bookingId, p_club_id: clubId, p_demo_member_id: demoMemberId() }))
}

// Fires whenever any of this CCA's waitlist rows change (offer made, declined,
// expired, claimed), so Pip and the Waitlist tab never show a stale offer.
export function subscribeToClubWaitlist(clubId, onChange) {
  const channel = supabase
    .channel(`club-waitlist-${clubId}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'waitlist_entries', filter: `club_id=eq.${clubId}` },
      onChange)
    .subscribe()
  return () => supabase.removeChannel(channel)
}

// Purely visual: the database job decides when an offer really expires.
export function secondsLeft(expiresAt, now = Date.now()) {
  if (!expiresAt) return 0
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000))
}

export function formatCountdown(seconds) {
  const m = String(Math.floor(seconds / 60)).padStart(2, '0')
  const s = String(seconds % 60).padStart(2, '0')
  return `${m}:${s}`
}
