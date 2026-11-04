// Purpose: Produce plain-English impact summaries and limited shortlists without changing engine results or rankings.
/** Presentation only: describe engine results without inferring vacancies or
 * recalculating impact, feasibility, ranking or approval. */
const same=(a,b)=>a!=null&&b!=null&&String(a)===String(b)
const short=value=>{const text=String(value || '').trim();return text.length>44?text.slice(0,41)+'...':text}
const join=items=>!items.length?'':items.length===1?items[0]:items.slice(0,-1).join(', ')+' and '+items.at(-1)
// Describe actual disruption causes and distinct direct/downstream activity impacts using loaded resource names.
export function simulationImpactSummary({data={},eventId,result,disruptions=[]}={}){
 if(!result || !data)return ''
 const segments=(data.event_segments || []).filter(s=>same(s.event_id,eventId))
 const byId=new Map(segments.map(s=>[String(s.id),s]))
 const ids=rows=>[...new Set((rows || []).filter(r=>r.segmentId!=null).map(r=>String(r.segmentId)))]
 const direct=ids(result.directImpacts)
 const downstream=ids(result.downstreamRisks).filter(id=>!direct.includes(id))
 const labels=[],delays=new Map()
 for(const d of disruptions){
  if(d.type==='MEMBER_UNAVAILABLE'){
   const name=data.members?.find(m=>same(m.id,d.memberId))?.full_name
   labels.push(name?short(name)+" can't attend":'the selected member cannot attend')
  }else if(d.type==='FACILITY_UNAVAILABLE')labels.push((short(d.venueName)||'the selected facility')+' is unavailable')
  else if(d.type==='SCHEDULE_DELAY'){
   const key=String(d.segmentId),minutes=Number(d.delayMinutes)
   if(Number.isFinite(minutes)&&minutes>0)delays.set(key,(delays.get(key)||0)+minutes)
  }else labels.push('the selected disruption occurs')
 }
 for(const [id,minutes] of delays)labels.push((short(byId.get(id)?.title)||'the selected activity')+' is delayed '+minutes+' min')
 const causes=[...new Set(labels)]
 const cause=causes.length>2?causes[0]+' and '+(causes.length-1)+' other disruptions occur':join(causes)
 let impact
 if(!direct.length)impact='no direct activity impacts were detected in the loaded schedule'
 else{
  const names=direct.slice(0,2).map(id=>short(byId.get(id)?.title)||'an affected activity')
  const activities=direct.length>2?direct.length+' activities ('+names.join(', ')+', ...)':join(names)
  impact=activities+' '+(direct.length===1?'needs':'need')+' review'
 }
 const cascade=downstream.length?', with '+downstream.length+' downstream '+(downstream.length===1?'activity':'activities')+' also at risk':''
 return (cause?'If '+cause+', ': 'In this simulation, ')+impact+cascade+'.'
}

/** Limit the displayed shortlist only; preserve an explicitly selected option
 * outside it and never sort, score, select or mutate the complete input. */
export function visibleRecoveryOptions(plans,limit=3,selectedId=''){
 const visible=limit==='all'?plans:plans.slice(0,Number(limit))
 const selected=plans.find(plan=>plan.id===selectedId)
 return selected&&!visible.some(plan=>plan.id===selected.id)?[...visible,selected]:visible
}
