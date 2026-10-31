// Decorate an existing room recommendation without ranking, removing or replacing it.
export function calendarOptionsForRecommendation({venue,start,end,rows,clubId,bookingActions,canClaim=false,isOslAdmin=false,waitlistEntries=[]}) {
 const begin=Date.parse(start),finish=Date.parse(end)
 if(!Number.isFinite(begin)||!Number.isFinite(finish)||begin>=finish)return [{action:'Unavailable',reason:'Activity times are missing or invalid.'}]
 const interval=b=>[Date.parse(b.booking_date+'T'+b.start_time+'+08:00'),Date.parse(b.booking_date+'T'+b.end_time+'+08:00')]
 const matching=rows.filter(b=>b.facility_name===venue)
 const covering=matching.filter(b=>{const [s,e]=interval(b);return s<=begin&&e>=finish})
 if(!covering.length)return [{action:'View in Calendar',reason:matching.length?'No visible slot covers the full activity.':'No visible booking. Vacancy is unverified; no vacant-room creation API is supported.'}]
 return covering.map(b=>{
  const [s,e]=interval(b)
  const conflict=rows.some(o=>String(o.booking_id)!==String(b.booking_id)&&o.facility_id!=null&&b.facility_id!=null&&String(o.facility_id)===String(b.facility_id)&&interval(o)[0]<e&&s<interval(o)[1])
  // Reuse the team's exact calendar rules, rather than maintaining another copy.
  const actions=bookingActions(b,{clubId,canManage:canClaim,isOslAdmin,waitlistEntry:waitlistEntries.find(e=>String(e.booking_id)===String(b.booking_id))})
  const approved=b.status==='Officially Confirmed Booking'&&clubId!=null&&String(b.owner_club_id)===String(clubId)
  const action=conflict?'Unavailable':actions.some(a=>a.type==='claim'&&!a.disabled)?'Claim Room':actions.some(a=>a.type==='leave')?'Manage Waitlist':actions.some(a=>a.type==='join')?'Join Waitlist':'View in Calendar'
  return {bookingId:b.booking_id,status:b.status,action,confirmed:approved&&!conflict,
   reason:conflict?'Another visible booking overlaps this physical room.':approved?'Recorded booking belongs to this club; Apply must revalidate it.':b.status==='Pending Admin Sign-off'?'Pending OSL approval; not confirmed.':action==='Claim Room'?'Released slot; claim requires calendar confirmation and approval.':action==='Manage Waitlist'?'Your club already has a live queue entry; manage or leave it in the calendar.':action==='Join Waitlist'?'Waitlist only; no approved replacement booking.':'Not claimable for the current club or permissions. Review in the calendar.'}
 })
}

// Read the SAME calendar and active queue services as the Master Calendar.
// A queue read failure is a coverage error: never guess "Join" without its state.
export async function readSimulatorCalendarSnapshot({fetchCalendar,fetchActiveClubEntries,from,to,clubId}) {
 const [rows,entries]=await Promise.all([
  fetchCalendar({from,to}),
  clubId!=null?fetchActiveClubEntries(clubId):Promise.resolve([])
 ])
 if(!Array.isArray(rows)||!Array.isArray(entries))throw new Error('Calendar or waitlist response is incomplete.')
 return {rows,entries}
}
