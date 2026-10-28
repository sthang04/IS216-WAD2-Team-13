// OSL's side of a transfer: see claims waiting for sign-off, approve or reject
// them, and read each transfer's audit history.
// The database checks the caller is an OSL admin before returning anything.
 
import { ref } from 'vue'
import { supabase } from '../supabase'
import { demoMemberId } from './sessionState'
 
// Labels for the audit history list
export const AUDIT_ACTION_LABELS = {
  RELEASED: 'Released by owner',
  RELEASE_UNDONE: 'Release undone',
  CLAIMED: 'Claimed',
  OSL_EMAIL_REQUESTED: 'OSL request email sent',
  APPROVED: 'Approved by OSL',
  REJECTED: 'Rejected by OSL',
  RELISTED_AFTER_REJECTION: 'Relisted after rejection',
  SIGNOFF_EXPIRED: 'Sign-off deadline passed; slot stayed with the releasing CCA'
}
 
// Claims waiting for OSL sign-off
export async function fetchPendingTransfers() {
  const response = await supabase.rpc('rpc_osl_pending_transfers', {
    p_demo_member_id: demoMemberId()
  })
  if (response.error) {
    throw new Error(response.error.message)
  }
  return response.data
}
 
// The OSL page only loads the latest 20 decisions, so it stays fast all semester
export const DECISION_LIMIT = 20
 
// True when the OSL page is showing the maximum number of decisions
// (older ones exist but were not loaded). Pip reads this to warn OSL.
export const decisionListIsFull = ref(false)
 
export async function fetchRecentDecisions() {
  const response = await supabase.rpc('rpc_recent_transfer_decisions', {
    p_demo_member_id: demoMemberId(),
    p_limit: DECISION_LIMIT
  })
  if (response.error) {
    throw new Error(response.error.message)
  }
  decisionListIsFull.value = response.data.length >= DECISION_LIMIT
  return response.data
}
 
export async function fetchAuditHistory(bookingId) {
  const response = await supabase.rpc('rpc_transfer_audit_history', {
    p_booking_id: bookingId,
    p_demo_member_id: demoMemberId()
  })
  if (response.error) {
    throw new Error(response.error.message)
  }
  return response.data
}
 
// Refused by the database after the 48-hour sign-off deadline
export async function approveTransfer(transferId) {
  const response = await supabase.rpc('rpc_approve_transfer', {
    p_transfer_id: transferId,
    p_demo_member_id: demoMemberId()
  })
  if (response.error) {
    throw new Error(response.error.message)
  }
  return response.data
}
 
export async function rejectTransfer(transferId, reason) {
  const response = await supabase.rpc('rpc_reject_transfer', {
    p_transfer_id: transferId,
    p_reason: reason,
    p_demo_member_id: demoMemberId()
  })
  if (response.error) {
    throw new Error(response.error.message)
  }
  return response.data
}
 
// Re-send the OSL request email (only if the automatic one failed)
export async function requestOslEmail(transferId, clubId) {
  const response = await supabase.rpc('rpc_request_osl_email', {
    p_transfer_id: transferId,
    p_club_id: clubId,
    p_demo_member_id: demoMemberId()
  })
  if (response.error) {
    throw new Error(response.error.message)
  }
  return response.data
}
 