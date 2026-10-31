import {simulatorBookingPeriod} from './simulatorFacilityEvidence.js'
const same=(a,b)=>a!=null&&b!=null&&String(a)===String(b)
const key=value=>String(value || '').trim().toLowerCase()
const time=value=>Date.parse(value)
const valid=(start,end)=>Number.isFinite(start)&&Number.isFinite(end)&&start<end
const overlap=(a,b,c,d)=>a<d&&c<b
export function controlRoomTime(value){
 if(value==null)return 'Time unavailable'
 const date=new Date(value)
 return Number.isFinite(date.getTime())?new Intl.DateTimeFormat('en-SG',{timeZone:'Asia/Singapore',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date):'Time unavailable'
}
/** Presentation only: consumes the existing engine's impact/conflict results.
 * It never recalculates risk scores, expands club access, or writes records. */
export function buildControlRoomModel(data={},eventId,result=null,disruptions=[],options={}){
 const original=(data.event_segments || []).filter(s=>same(s.event_id,eventId))
  .slice().sort((a,b)=>(time(a.starts_at)-time(b.starts_at))||String(a.id).localeCompare(String(b.id)))
 const ids=new Set(original.map(s=>String(s.id)))
 const hasSimulation=!!result&&same(result.eventId,eventId)
 const direct=new Map((hasSimulation?result.directImpacts || []:[]).map(i=>[String(i.segmentId),i]))
 const downstream=new Set((hasSimulation?result.downstreamRisks || []:[]).map(i=>String(i.segmentId)))
 const simulated=new Map((hasSimulation?result.simulatedSegments || []:[]).map(s=>[String(s.id),s]))
 const conflicts=hasSimulation?result.newConflicts || []:[]
 const dependencies=(data.segment_dependencies || []).filter(d=>ids.has(String(d.prerequisite_segment_id))&&ids.has(String(d.dependent_segment_id)))
  .filter((d,index,rows)=>rows.findIndex(x=>same(x.prerequisite_segment_id,d.prerequisite_segment_id)&&same(x.dependent_segment_id,d.dependent_segment_id))===index)
 const activities=original.map(s=>{
  const next=simulated.get(String(s.id)) || s
  const related=conflicts.filter(c=>same(c.segmentId,s.id)||(c.segmentIds || []).some(id=>same(id,s.id))||
   same(c.prerequisiteId,s.id)||same(c.dependentId,s.id))
  const causes=[...(direct.get(String(s.id))?.causes || []).map(c=>c.reason),...related.map(c=>c.message || c.reason)].filter(Boolean)
  const status=direct.has(String(s.id))?'direct':downstream.has(String(s.id))?'downstream':'unchanged'
  if(status==='downstream'&&!causes.length)causes.push('Depends on an affected earlier activity; downstream risk requires review.')
  return {...s,simulated:next,status,causes:[...new Set(causes)],
   originalStart:time(s.starts_at),originalEnd:time(s.ends_at),simulatedStart:time(next.starts_at),simulatedEnd:time(next.ends_at)}
 })
 // Deterministic dependency levels; cycles are reported rather than silently
 // inventing a valid execution order or dropping activities from the graph.
 const incoming=new Map(activities.map(a=>[String(a.id),0])),levels=new Map(activities.map(a=>[String(a.id),0]))
 for(const d of dependencies)incoming.set(String(d.dependent_segment_id),incoming.get(String(d.dependent_segment_id))+1)
 const queue=activities.filter(a=>incoming.get(String(a.id))===0).map(a=>String(a.id)),visited=new Set()
 while(queue.length){
  const id=queue.shift();visited.add(id)
  for(const edge of dependencies.filter(d=>String(d.prerequisite_segment_id)===id)){
   const target=String(edge.dependent_segment_id);levels.set(target,Math.max(levels.get(target),levels.get(id)+1))
   incoming.set(target,incoming.get(target)-1);if(incoming.get(target)===0)queue.push(target)
  }
 }
 const cycle=visited.size<activities.length
 const rows=new Map()
 const nodes=activities.map(activity=>{
  const level=visited.has(String(activity.id))?levels.get(String(activity.id)):0
  const row=rows.get(level)||0;rows.set(level,row+1)
  return {...activity,level,x:20+level*265,y:20+row*136}
 })
 const nodeMap=new Map(nodes.map(n=>[String(n.id),n]))
 const edges=dependencies.map(d=>({from:nodeMap.get(String(d.prerequisite_segment_id)),to:nodeMap.get(String(d.dependent_segment_id))}))
 // A day window keeps multi-day events readable; dates are sorted as ISO local days.
 const localDay=ms=>new Date(ms+8*3600000).toISOString().slice(0,10)
 const days=[...new Set(activities.flatMap(a=>[[a.originalStart,a.originalEnd],[a.simulatedStart,a.simulatedEnd]].flatMap(([a,b])=>{
  if(!valid(a,b))return []
  const result=[];const last=b-1
  for(let from=Date.parse(localDay(a)+'T00:00:00+08:00');from<=last;from+=86400000){result.push(localDay(from));if(result.length>=366)break}
  return result
 })))].sort()
 const day=days.includes(options.day)?options.day:days[0] || null
 const midnight=day?Date.parse(day+'T00:00:00+08:00'):null
 const windows=activities.flatMap(a=>[[a.originalStart,a.originalEnd],[a.simulatedStart,a.simulatedEnd]])
  .filter(([a,b])=>day && valid(a,b) && overlap(a,b,midnight,midnight+86400000))
 const bounds=windows.flatMap(([a,b])=>[Math.max(a,midnight),Math.min(b,midnight+86400000)])
 const start=bounds.length?Math.min(...bounds):null,end=bounds.length?Math.max(...bounds):null,span=end-start
 const position=(a,b)=>valid(start,end)&&valid(a,b)&&overlap(a,b,start,end)?{left:Math.max(0,(a-start)/span*100),width:(Math.min(b,end)-Math.max(a,start))/span*100}:null
 const timeline=activities.map(a=>({...a,originalBar:position(a.originalStart,a.originalEnd),simulatedBar:position(a.simulatedStart,a.simulatedEnd)})).filter(a=>a.originalBar || a.simulatedBar)
 const bookings=data.facility_bookings || data.facility_slots || []
 const links=(data.segment_facility_bookings || data.segment_facility_slots || []).filter(l=>ids.has(String(l.segment_id)))
 const bookingById=new Map(bookings.map(b=>[String(b.id),b]))
 const linkedIds=new Set(links.map(l=>String(l.booking_id ?? l.facility_slot_id)))
 const groups=new Map()
 for(const id of linkedIds){
  const booking=bookingById.get(id);if(!booking)continue
  const facility=(data.facilities || []).find(f=>same(f.id,booking.facility_id))
  const groupKey=String(booking.facility_id ?? booking.venue_name ?? id)
  if(!groups.has(groupKey))groups.set(groupKey,{id:groupKey,name:facility?.name || booking.venue_name || 'Facility identity unavailable',bookings:[]})
  groups.get(groupKey).bookings.push({...booking})
 }
 // Bounded, adaptive cells avoid a misleading fixed demo date or huge grids.
 const step=valid(start,end)?Math.max(15*60000,Math.ceil(span/(20*15*60000))*15*60000):null
 const cells=[]
 if(step)for(let from=start;from<end;from+=step)cells.push({start:from,end:Math.min(end,from+step)})
 const facilities=[...groups.values()].map(group=>{
  const bookingIds=new Set(group.bookings.map(b=>String(b.id)))
  const linkedSegments=new Set(links.filter(l=>bookingIds.has(String(l.booking_id ?? l.facility_slot_id))).map(l=>String(l.segment_id)))
  const calendar=bookings.filter(b=>group.bookings.some(own=>same(own.facility_id,b.facility_id))&&['booked','officially confirmed booking'].includes(key(b.status)))
  return {...group,cells:cells.map(cell=>{
   const inUse=activities.filter(a=>linkedSegments.has(String(a.id))&&(!result?.proposedVenues?.[String(a.id)] || key(result.proposedVenues[String(a.id)])===key(group.name))&&overlap(a.simulatedStart,a.simulatedEnd,cell.start,cell.end))
   const outage=hasSimulation&&(disruptions || []).some(d=>d.type==='FACILITY_UNAVAILABLE'&&key(d.venueName)===key(group.name)&&overlap(time(d.start),time(d.end),cell.start,cell.end))
   const simultaneous=inUse.some((a,i)=>inUse.slice(i+1).some(b=>valid(Math.max(a.simulatedStart,b.simulatedStart),Math.min(a.simulatedEnd,b.simulatedEnd))&&overlap(Math.max(a.simulatedStart,b.simulatedStart),Math.min(a.simulatedEnd,b.simulatedEnd),cell.start,cell.end)))
   const competingPairs=[]
   calendar.forEach((a,i)=>calendar.slice(i+1).forEach(b=>{
    const [as,ae]=simulatorBookingPeriod(a),[bs,be]=simulatorBookingPeriod(b)
    if(String(a.id)!==String(b.id)&&valid(Math.max(time(as),time(bs)),Math.min(time(ae),time(be)))&&overlap(Math.max(time(as),time(bs)),Math.min(time(ae),time(be)),cell.start,cell.end))competingPairs.push([a.id,b.id])
   }))
   const competing=competingPairs.length>0
   const status=outage?'outage':simultaneous||competing?'conflict':inUse.length?'in-use':'no-event-use'
   return {...cell,status,conflictDetails:[...(simultaneous?['Event activities overlap in this room.']:[]),...competingPairs.map(pair=>'Recorded reservations '+pair.join(' and ')+' overlap. Approval is checked separately.')],activities:inUse.map(a=>a.title),label:status==='outage'?'Simulated outage':status==='conflict'?'Scheduling conflict':status==='in-use'?'Event activity':'No event use shown'}
  })}
 })
 return {hasSimulation,activities,affected:activities.filter(a=>a.status!=='unchanged'),nodes,edges,cycle,timeline,
  domain:{start,end},days,day,facilities,missingLinks:links.filter(l=>!bookingById.has(String(l.booking_id ?? l.facility_slot_id))).length,
  graphWidth:Math.max(250,...nodes.map(n=>n.x+240)),graphHeight:Math.max(130,...nodes.map(n=>n.y+110))}
}

/** Presentation uses evaluator results without scoring, saving, or claiming rooms. */
export function recoveryControlRoomResult(eventId,plan){
 if(!plan)return null
 const impacts=(plan.proposedSegments || []).map(segment=>{
  const causes=(plan.conflicts || []).filter(c=>same(c.segmentId,segment.id)||(c.segmentIds || []).some(id=>same(id,segment.id))||same(c.prerequisiteId,segment.id)||same(c.dependentId,segment.id)).map(c=>({reason:c.message || c.reason}))
  return {segmentId:segment.id,causes}
 }).filter(i=>i.causes.length)
 return {eventId,simulatedSegments:plan.proposedSegments || [],directImpacts:impacts,downstreamRisks:[],newConflicts:plan.conflicts || [],proposedVenues:plan.proposedVenues || {}}
}
