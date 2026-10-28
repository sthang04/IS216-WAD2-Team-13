// waitlistService.js
// Waitlist for released slots: CCAs queue up, and when a slot is released
// the club at #1 gets 30 minutes to accept it.

import { supabase } from '../supabase'
import { demoMemberId } from './sessionState'

// Every waitlist entry for one CCA (for the Waitlist page)
export async function fetchClubWaitlist(clubId) {
  const response = await supabase
    .from('v_waitlist_queue')
    .select('*')
    .eq('club_id', clubId)
    .order('booking_date')
    .order('start_time')
  if (response.error) {
    throw new Error(response.error.message)
  }
  return response.data
}

// Only the CCA's live entries (still waiting, or holding an offer)
export async function fetchActiveClubEntries(clubId) {
  const response = await supabase
    .from('v_waitlist_queue')
    .select('entry_id, booking_id, status, queue_position, offer_expires_at')
    .eq('club_id', clubId)
    .in('status', ['WAITING', 'OFFERED'])
  if (response.error) {
    throw new Error(response.error.message)
  }
  return response.data
}

// The queue for one booking, in order
export async function fetchQueue(bookingId) {
  const response = await supabase
    .from('v_waitlist_queue')
    .select('*')
    .eq('booking_id', bookingId)
    .in('status', ['WAITING', 'OFFERED'])
    .order('queue_position')
  if (response.error) {
    throw new Error(response.error.message)
  }
  return response.data
}

export async function joinWaitlist(bookingId, clubId) {
  const response = await supabase.rpc('rpc_join_waitlist', {
    p_booking_id: bookingId,
    p_club_id: clubId,
    p_demo_member_id: demoMemberId()
  })
  if (response.error) {
    throw new Error(response.error.message)
  }
  return response.data
}

// Leaving while holding an offer declines it, and the next CCA gets the offer
export async function leaveWaitlist(bookingId, clubId) {
  const response = await supabase.rpc('rpc_leave_waitlist', {
    p_booking_id: bookingId,
    p_club_id: clubId,
    p_demo_member_id: demoMemberId()
  })
  if (response.error) {
    throw new Error(response.error.message)
  }
  return response.data
}

// Supabase Realtime: run onChange whenever this CCA's waitlist rows change
export function listenForClubWaitlist(clubId, onChange) {
  const channel = supabase
    .channel('club-waitlist-' + clubId)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'waitlist_entries', filter: 'club_id=eq.' + clubId },
      onChange
    )
    .subscribe()

  function stopListening() {
    supabase.removeChannel(channel)
  }
  return stopListening
}

// Seconds until an offer runs out (for the countdown only;
// the database decides when it really expires)
export function secondsLeft(expiresAt, now) {
  if (!expiresAt) {
    return 0
  }
  const seconds = Math.floor((new Date(expiresAt).getTime() - now) / 1000)
  if (seconds < 0) {
    return 0
  }
  return seconds
}

// 125 seconds -> "02:05"
export function formatCountdown(seconds) {
  const minutes = String(Math.floor(seconds / 60)).padStart(2, '0')
  const secs = String(seconds % 60).padStart(2, '0')
  return minutes + ':' + secs
}
