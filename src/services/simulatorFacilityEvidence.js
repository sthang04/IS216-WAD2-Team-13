// Read-only evidence for the existing ranking pipeline. Singapore booking dates
// are local calendar dates, never UTC dates or the browser's local timezone.
export function simulatorBookingPeriod(booking){
 if(booking?.booking_date&&booking.start_time&&booking.end_time)
  return [booking.booking_date+'T'+booking.start_time+'+08:00',booking.booking_date+'T'+booking.end_time+'+08:00']
 const times=String(booking?.time_slot || '').split(/\s*-\s*/)
 return times.length===2?times.map(time=>booking.event_date+'T'+time+(time.split(':').length===2?':00':'')+'+08:00'):[null,null]
}
export function simulatorFacilityFacts(data,segmentId,start,end){
 const same=(a,b)=>a!=null&&b!=null&&String(a)===String(b)
 const key=value=>String(value || '').trim().toLowerCase()
 const bookings=data.facility_bookings || data.facility_slots || []
 const segment=(data.event_segments || []).find(s=>same(s.id,segmentId))
 const links=data.segment_facility_bookings || data.segment_facility_slots || []
 const linked=links.find(l=>same(l.segment_id,segmentId))
 const original=bookings.find(b=>same(b.id,linked?.booking_id ?? linked?.facility_slot_id))
 const originalFacility=(data.facilities || []).find(f=>same(f.id,original?.facility_id))
 const minimumCapacity=new Set((data.segment_assignments || []).filter(a=>same(a.segment_id,segmentId)).map(a=>String(a.member_id))).size
 const valid=Number.isFinite(Date.parse(start))&&Number.isFinite(Date.parse(end))&&Date.parse(start)<Date.parse(end)
 return (data.facilities || []).filter(f=>f.is_active!==false).map(f=>{
  const reasons=[],warnings=['Audience attendance, required equipment/layout and club eligibility must be verified; staff count alone does not confirm suitability.','Calendar visibility is limited by RLS. No visible conflict is not a confirmed reservation.']
  const capacity=f.capacity==null?null:Number(f.capacity)
  const knownCapacity=capacity!=null&&Number.isFinite(capacity)&&capacity>=0
  if(!valid)reasons.push('Invalid activity time range.')
  if(knownCapacity&&capacity<minimumCapacity)reasons.push('Capacity is below the recorded assigned-member count.')
  if(!knownCapacity)warnings.push('Capacity is unknown; manual verification is required.')
  if(originalFacility?.facility_type&&f.facility_type&&originalFacility.facility_type!==f.facility_type)
   warnings.push('Facility type differs from the original room; verify activity suitability.')
  const overlaps=bookings.filter(b=>{
   if(!(same(b.facility_id,f.id)||(!b.facility_id&&key(b.venue_name)===key(f.name))))return false
   const [a,z]=simulatorBookingPeriod(b)
   if(!Number.isFinite(Date.parse(a))||!Number.isFinite(Date.parse(z))){warnings.push('A visible calendar record has invalid times; availability needs verification.');return false}
   return Date.parse(a)<Date.parse(end)&&Date.parse(start)<Date.parse(z)
  })
  const confirmed=overlaps.filter(b=>['booked','officially confirmed booking'].includes(key(b.status)))
  // A Booked record conservatively blocks double booking; this does NOT certify
  // its approval or grant this organizer rights to use that reservation.
  if(confirmed.length)reasons.push('Another confirmed reservation overlaps this facility.')
  if(overlaps.length&&!confirmed.length)warnings.push('Visible calendar records overlap; check claim eligibility and approval in Facility Calendar.')
  return {id:f.id,name:f.name,type:f.facility_type || 'Unverified',capacity:knownCapacity?capacity:null,
   equipment:Array.isArray(f.equipment)?f.equipment:[],minimumCapacity,blocked:reasons.length>0,reasons,
   bookingIds:overlaps.map(b=>b.id),warnings,
   status:overlaps.length?'Recorded reservations: check ownership, transfer and approval':'Availability unverified: no recorded conflict in accessible calendar data; booking approval required',
   warning:warnings.join(' '),segmentId:segment?.id}
 })
}
