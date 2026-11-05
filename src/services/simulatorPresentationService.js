// Purpose: Produce plain-English impact summaries and limited shortlists without changing engine results or rankings.
/** Presentation only: describe engine results without inferring vacancies or
 * recalculating impact, feasibility, ranking or approval. */
import {activityKey} from './simulatorActivityGroups.js'
const same=(a,b)=>a!=null&&b!=null&&String(a)===String(b)
const short=value=>{const text=String(value || '').trim();return text.length>44?text.slice(0,41)+'...':text}
const join=items=>!items.length?'':items.length===1?items[0]:items.slice(0,-1).join(', ')+' and '+items.at(-1)
// Describe actual disruption causes and distinct direct/downstream activity impacts using loaded resource names.
export function simulationImpactSummary({data={},eventId,result,disruptions=[]}={}){
 if(!result || !data)return ''
 const segments=(data.event_segments || []).filter(s=>same(s.event_id,eventId))
 const byId=new Map(segments.map(s=>[String(s.id),s]))
 // One id per activity: crew members' copies of the same Day Ops activity count once.
 const ids=rows=>{const seen=new Set();return [...new Set((rows || []).filter(r=>r.segmentId!=null).map(r=>String(r.segmentId)))].filter(id=>{const key=byId.has(id)?activityKey(byId.get(id)):id;if(seen.has(key))return false;seen.add(key);return true})}
 const direct=ids(result.directImpacts)
 const directKeys=new Set(direct.map(id=>byId.has(id)?activityKey(byId.get(id)):id))
 const downstream=ids(result.downstreamRisks).filter(id=>!directKeys.has(byId.has(id)?activityKey(byId.get(id)):id))
 const labels=[],delays=new Map()
 for(const d of disruptions){
  if(d.type==='MEMBER_UNAVAILABLE'){
   const name=data.members?.find(m=>same(m.id,d.memberId))?.full_name
   labels.push(name?short(name)+" can't attend":'the selected member cannot attend')
  }else if(d.type==='FACILITY_UNAVAILABLE')labels.push((short(d.venueName)||'the selected facility')+' is unavailable')
  else if(d.type==='SCHEDULE_DELAY'){
   const key=byId.has(String(d.segmentId))?activityKey(byId.get(String(d.segmentId))):String(d.segmentId),minutes=Number(d.delayMinutes)
   // A grouped delay arrives once per crew copy: count its minutes once per copy, not summed across copies.
   if(Number.isFinite(minutes)&&minutes>0){const entry=delays.get(key)||{id:String(d.segmentId),perSegment:new Map()};entry.perSegment.set(String(d.segmentId),(entry.perSegment.get(String(d.segmentId))||0)+minutes);delays.set(key,entry)}
  }else labels.push('the selected disruption occurs')
 }
 for(const {id,perSegment} of delays.values())labels.push((short(byId.get(id)?.title)||'the selected activity')+' is delayed '+Math.max(...perSegment.values())+' min')
 const causes=[...new Set(labels)]
 const cause=causes.length>2?causes[0]+' and '+(causes.length-1)+' other disruptions occur':join(causes)
 let impact
 if(!direct.length)impact='no direct activity impacts were detected in the loaded schedule'
 else{
  const names=direct.slice(0,2).map(id=>short(byId.get(id)?.title)||'an affected activity')
  const activities=direct.length>2?direct.length+' activities ('+names.join(', ')+', ...)':join(names)
  impact=activities+' '+(direct.length===1?'needs':'need')+' review'
 }
 // Crew now due in two places at once (e.g. a delay running into their next task)
 const doubleBooked=new Set((result.newConflicts || []).filter(c=>c.type==='MEMBER_DOUBLE_BOOKING'&&c.memberId!=null).map(c=>String(c.memberId))).size
 const cascade=(downstream.length?', with '+downstream.length+' downstream '+(downstream.length===1?'activity':'activities')+' also at risk':'')+
  (doubleBooked?(downstream.length?' and ':', and ')+doubleBooked+' crew '+(doubleBooked===1?'member is':'members are')+' now due somewhere else at the same time':'')
 return (cause?'If '+cause+', ': 'In this simulation, ')+impact+cascade+'.'
}

/** Limit the displayed shortlist only; preserve an explicitly selected option
 * outside it and never sort, score, select or mutate the complete input. */
export function visibleRecoveryOptions(plans,limit=3,selectedId=''){
 const visible=limit==='all'?plans:plans.slice(0,Number(limit))
 const selected=plans.find(plan=>plan.id===selectedId)
 return selected&&!visible.some(plan=>plan.id===selected.id)?[...visible,selected]:visible
}
