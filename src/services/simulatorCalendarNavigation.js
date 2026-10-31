const single=value=>typeof value==='string'?value:''
const explicitTime=value=>typeof value==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value))
export const SIMULATOR_FOCUS_KEYS=['simFacilityId','simFacility','simStart','simEnd']
// Navigation context only; never proof of permission, vacancy or a reservation.
export function simulatorCalendarTarget({facilityId,venue,start,end},weekStartOf){
 if(!explicitTime(start)||!explicitTime(end)||Date.parse(start)>=Date.parse(end))return {path:'/facilities'}
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore'}).format(new Date(start))
 const query={week:weekStartOf(day)}
 if(venue){query.simFacility=String(venue);query.simStart=start;query.simEnd=end}
 if(facilityId!=null&&/^[1-9][0-9]*$/.test(String(facilityId)))query.simFacilityId=String(facilityId)
 return {path:'/facilities',query}
}
export function readSimulatorCalendarFocus(query,facilities){
 const requested=SIMULATOR_FOCUS_KEYS.some(k=>query[k]!=null)
 if(!requested)return null
 if(SIMULATOR_FOCUS_KEYS.some(k=>query[k]!=null&&typeof query[k]!=='string'))return {requested:true,error:'Invalid simulator navigation parameters.'}
 const name=single(query.simFacility),id=single(query.simFacilityId),start=single(query.simStart),end=single(query.simEnd)
 if(!explicitTime(start)||!explicitTime(end)||Date.parse(start)>=Date.parse(end)||(!id&&!name)||name.length>200||
  (id&&!/^[1-9][0-9]*$/.test(id)))return {requested:true,error:'Invalid simulator facility/time request. Normal calendar validation still applies.'}
 const matches=facilities.filter(f=>id?String(f.id)===id:f.name===name)
 if(matches.length!==1)return {requested:true,error:'Requested facility is not uniquely available in the loaded calendar inventory.'}
 return {requested:true,facilityId:matches[0].id,facilityName:matches[0].name,start,end,error:null}
}
export function bookingMatchesSimulatorFocus(booking,focus){
 if(!focus||focus.error)return true
 const start=Date.parse(booking.booking_date+'T'+booking.start_time+'+08:00')
 const end=Date.parse(booking.booking_date+'T'+booking.end_time+'+08:00')
 return String(booking.facility_id)===String(focus.facilityId)&&Number.isFinite(start)&&Number.isFinite(end)&&
  start<Date.parse(focus.end)&&Date.parse(focus.start)<end
}
export function clearSimulatorCalendarFocus(query){
 return Object.fromEntries(Object.entries(query).filter(([key])=>!SIMULATOR_FOCUS_KEYS.includes(key)))
}
