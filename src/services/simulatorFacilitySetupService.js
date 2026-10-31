import {compareFacilityScheduleConflicts} from './conflictService.js'
import {bookingEvidence} from './simulatorWorkflowService.js'
// Describe existing links only. This is NOT a room recommendation/ranking
// algorithm and never inserts, claims, approves or links a booking.
export function describeSimulatorFacilityLinks(data,eventId){
 const same=(a,b)=>a!=null&&b!=null&&String(a)===String(b)
 const event=data?.events?.find(e=>same(e.id,eventId))
 if(!event)return []
 // Reuse the existing conflict engine for activities sharing a booking.
 let overlaps=[],overlapCoverage=true
 try{overlaps=compareFacilityScheduleConflicts({facility_slots:data.facility_slots || [],segment_facility_slots:data.segment_facility_slots || []},data.event_segments || [],data.event_segments || []).baseline}
 catch{overlapCoverage=false}
 return (data.event_segments || []).filter(s=>same(s.event_id,eventId)).map(segment=>{
  const links=(data.segment_facility_bookings || []).filter(l=>same(l.segment_id,segment.id))
  const minimumCapacity=new Set((data.segment_assignments || []).filter(a=>same(a.segment_id,segment.id)).map(a=>String(a.member_id))).size
  return {segment,bookings:[...new Set(links.map(l=>String(l.booking_id)))].map(id=>{
   const booking=(data.facility_bookings || []).find(b=>same(b.id,id))
   const facility=(data.facilities || []).find(f=>same(f.id,booking?.facility_id))
   const evidence=bookingEvidence(data,id,event.club_id,segment.starts_at,segment.ends_at,eventId)
   const blockers=[...evidence.reasons]
   if(!overlapCoverage)blockers.push('Loaded activity conflict checks are incomplete.')
   for(const conflict of overlaps.filter(c=>same(c.facilitySlotId,id)&&c.segmentIds.some(segmentId=>same(segmentId,segment.id))))blockers.push(conflict.message)
   if(facility?.is_active!==true)blockers.push('Facility active status is not verified.')
   const capacity=facility?.capacity==null?NaN:Number(facility.capacity)
   if(!Number.isFinite(capacity)||capacity<0)blockers.push('Facility capacity is unverified.')
   else if(capacity<minimumCapacity)blockers.push('Capacity is below the recorded assigned-member count.')
   return {id,facilityName:evidence.facilityName || 'Booking details unavailable',
    status:evidence.status,capacity:Number.isFinite(capacity)?capacity:null,minimumCapacity,
    blockers,recordedChecksPassed:blockers.length===0}
  })}
 })
}
