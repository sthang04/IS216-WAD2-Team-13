// Purpose: Discover and confirm original booking links through authorized, fingerprint-checked server RPCs.
// Separate from recovery-plan booking attachment. Never insert links in Vue.
import {simulatorWorkflowActivation} from './simulatorWorkflowActivation.js'
// Deployment opt-in only: the server separately checks its release gate, the
// actor's event permission, exact fingerprints and approved booking evidence.
export const ORIGINAL_BOOKING_LINK_VERIFIED=simulatorWorkflowActivation(import.meta.env || {}).enabled
const fingerprint=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)
// Discovery returns evidence only. Linking requires explicit confirmation and
// both server fingerprints to prevent attaching a changed booking or event.
export function createOriginalBookingWorkflow(client,{enabled=ORIGINAL_BOOKING_LINK_VERIFIED}={}){
 const call=async(name,args)=>{
  if(args.p_event_id!=null && !/^[1-9][0-9]*$/.test(String(args.p_event_id))) throw Error('Day Ops booking links require the operations integration migration.')
  if(!client)throw Error('Supabase is unavailable.')
  const {data,error}=await client.rpc(name,args)
  if(error)throw Error('Original booking contract unavailable or rejected: '+error.message)
  if(!data||data.ok===false)throw Error(data?.error || 'No valid booking response.')
  return data
 }
 return {
  discover:async(eventId,segmentId)=>{
   const data=await call('rpc_simulator_original_booking_candidates',{p_event_id:eventId,p_segment_id:segmentId})
   if(String(data.event_id)!==String(eventId)||String(data.segment_id)!==String(segmentId)||
    !fingerprint(data.event_fingerprint)||!Array.isArray(data.bookings)||
    data.bookings.some(b=>!b||!b.booking_id||typeof b.eligible!=='boolean'||!Array.isArray(b.reasons)||!fingerprint(b.booking_fingerprint)))
    throw Error('Incomplete booking eligibility response; linking is unavailable.')
   return data
  },
  link:async(evidence,booking,confirmed)=>{
   if(!enabled)throw Error('Original booking linking remains disabled pending backend review, deployment and verification.')
   if(!confirmed)throw Error('Explicitly confirm this original event booking link first.')
   if(!booking?.eligible||!fingerprint(evidence?.event_fingerprint)||!fingerprint(booking.booking_fingerprint))throw Error('Refresh eligible booking evidence first.')
   const result=await call('rpc_simulator_link_original_booking',{
    p_event_id:evidence.event_id,p_segment_id:evidence.segment_id,p_booking_id:booking.booking_id,
    p_expected_event_fingerprint:evidence.event_fingerprint,p_expected_booking_fingerprint:booking.booking_fingerprint,
    p_acknowledge_suitability:true})
   if(result.linked!==true||String(result.event_id)!==String(evidence.event_id)||String(result.segment_id)!==String(evidence.segment_id)||
    String(result.booking_id)!==String(booking.booking_id))throw Error('The server did not confirm the selected event booking link.')
   return result
  }
 }
}