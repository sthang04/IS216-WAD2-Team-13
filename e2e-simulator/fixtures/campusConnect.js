// ISOLATED TEST DATA ONLY. Not a copy of Supabase Event 900001.
// Imported by automated tests only; the live loader never imports this module.
export const FIXTURE_EVENT_ID=990001
const time=minutes=>new Date(Date.parse('2026-11-02T10:00:00+08:00')+minutes*60000).toISOString()
export function campusConnectFixture(mode='manual'){
 const segments=Array.from({length:8},(_,i)=>({id:i+1,event_id:FIXTURE_EVENT_ID,title:'Fixture activity '+(i+1),
  segment_type:'Performance',starts_at:time(i*30),ends_at:time((i+1)*30)}))
 const assignments=segments.map((s,i)=>({id:i+1,segment_id:s.id,member_id:1,role_name:'Performer',is_required:true}))
 const data={
  events:[{id:FIXTURE_EVENT_ID,name:'ISOLATED 8-segment fixture (not live Event 900001)',club_id:1,club_name:'Fixture Club',starts_at:time(0),ends_at:time(240)},
   {id:990002,name:'ISOLATED role history / conflicting event',club_id:1}],
  members:[{id:1,full_name:'Fixture affected member'},{id:2,full_name:'Fixture exact standby'},
   {id:3,full_name:'Fixture review standby'},{id:4,full_name:'Fixture conflicting member'}],
  replacement_memberships:[1,2,3,4].map(memberId=>({memberId,clubId:1,active:true,verified:true})),
  member_replacement_coverage:{rosterVerified:true,scheduleVerified:mode==='verified',warning:mode==='verified'?null:'Club roster loaded. Timetable coverage is incomplete: ISOLATED fixture warning; manual review required.'},member_busy_periods:[],
  event_segments:[...segments,{id:90,event_id:990002,title:'Fixture previous-day role history',starts_at:'2026-11-01T10:00:00+08:00',ends_at:'2026-11-01T11:00:00+08:00'},
   {id:99,event_id:990002,title:'Fixture overlapping assignment',starts_at:time(15),ends_at:time(45)}],
  segment_assignments:[...assignments,{id:90,segment_id:90,member_id:2,role_name:'Performer'},
   {id:91,segment_id:90,member_id:3,role_name:'Crew'},{id:92,segment_id:90,member_id:4,role_name:'Performer'},
   {id:99,segment_id:99,member_id:4,role_name:'Performer'}],
  segment_dependencies:segments.slice(1).map((s,i)=>({prerequisite_segment_id:i+1,dependent_segment_id:s.id})),
  facility_slots:[{id:1,venue_name:'Fixture Original Room',event_date:'2026-11-02',time_slot:'10:00 - 14:00',status:'Booked',owner_club:'Fixture Club'},
   {id:2,venue_name:'Fixture Alternative Room',event_date:'2026-11-02',time_slot:'10:00 - 14:00',status:'Proposed Peer Transfer',owner_club:'Fixture Club'}],
  segment_facility_slots:segments.map(s=>({segment_id:s.id,facility_slot_id:1})),
  facilities:[{id:1,name:'Fixture Original Room',is_active:true,capacity:50},{id:2,name:'Fixture Alternative Room',is_active:true,capacity:50}],
  facility_bookings:[{id:1,facility_id:1,owner_club_id:1,booking_date:'2026-11-02',start_time:'10:00:00',end_time:'14:00:00',status:'Booked'},
   {id:2,facility_id:2,owner_club_id:1,booking_date:'2026-11-02',start_time:'10:00:00',end_time:'14:00:00',status:'Proposed Peer Transfer'}],
  segment_facility_bookings:segments.map(s=>({segment_id:s.id,booking_id:1})),
  facility_booking_coverage:{warning:'ISOLATED fixture coverage, not live database evidence.'}
 }
 if(mode==='blocked'){data.facility_slots[1].status='Booked';data.facility_bookings[1].status='Booked'}
 if(mode==='unlinked'){data.segment_facility_slots=[];data.segment_facility_bookings=[]}
 if(mode==='none')data.segment_assignments.push({id:100,segment_id:99,member_id:2,role_name:'Performer'},{id:101,segment_id:99,member_id:3,role_name:'Crew'})
 if(mode==='no-facility'){data.facility_slots=data.facility_slots.slice(0,1);data.facility_bookings=data.facility_bookings.slice(0,1);data.facilities=data.facilities.slice(0,1)}
 return data
}
export const fixtureAbsence={type:'MEMBER_UNAVAILABLE',memberId:1,start:time(0),end:time(30)}
export const fixtureRoomOutage={type:'FACILITY_UNAVAILABLE',venueName:'Fixture Original Room',start:time(0),end:time(30)}

export function campusConnectMultiEventFixture(){
 const data=campusConnectFixture()
 const later=text=>new Date(Date.parse(text)+86400000).toISOString()
 const event={...data.events[0],id:990003,name:'ISOLATED second selectable event',starts_at:later(data.events[0].starts_at),ends_at:later(data.events[0].ends_at)}
 const segments=data.event_segments.filter(s=>s.event_id===FIXTURE_EVENT_ID).map(s=>({...s,id:s.id+200,event_id:event.id,starts_at:later(s.starts_at),ends_at:later(s.ends_at)}))
 data.events.push(event);data.event_segments.push(...segments)
 data.segment_assignments.push(...segments.map(s=>({id:s.id,segment_id:s.id,member_id:1,role_name:'Performer',is_required:true})))
 data.segment_dependencies.push(...segments.slice(1).map((s,i)=>({prerequisite_segment_id:segments[i].id,dependent_segment_id:s.id})))
 data.facility_slots.push(...data.facility_slots.slice(0,2).map((b,i)=>({...b,id:i+4,event_date:'2026-11-03'})))
 data.facility_bookings.push(...data.facility_bookings.slice(0,2).map((b,i)=>({...b,id:i+4,booking_date:'2026-11-03'})))
 data.segment_facility_slots.push(...segments.map(s=>({segment_id:s.id,facility_slot_id:4})))
 data.segment_facility_bookings.push(...segments.map(s=>({segment_id:s.id,booking_id:4})))
 return data
}
