import {suggestSimulatorFacilities} from './simulatorWorkflowService.js'
const same=(a,b)=>a!=null&&b!=null&&String(a)===String(b)
const venueKey=value=>String(value || '').trim().toLowerCase()
// Presentation adapter only: joins EXISTING recommendations, suitability facts
// and evaluator ranks. No weights, scores or new ranking rules are introduced.
export function presentSimulatorFacilities({data,recommendations=[],options=[],rankedPlans=[],simulatedSegments=[]}){
 const ranks=new Map(rankedPlans.map((p,index)=>[p.id,{plan:p,index}]))
 return recommendations.map(recommendation=>{
  const segment=simulatedSegments.find(s=>same(s.id,recommendation.segmentId))
  const facts=segment?suggestSimulatorFacilities(data,segment.id,segment.starts_at,segment.ends_at):[]
  const alternatives=[],excludedAlternatives=[]
  for(const alternative of recommendation.alternatives || []){
   const venue=alternative.venue || alternative.venueName
   const option=options.find(o=>o.changes?.some(c=>same(c.segmentId,recommendation.segmentId)&&venueKey(c.venueName)===venueKey(venue)))
   const evaluated=ranks.get(option?.id)
   const fact=facts.find(f=>venueKey(f.name)===venueKey(venue))
   const rejected=(evaluated?.plan.conflicts || []).filter(c=>
    ['FACILITY_UNAVAILABLE','FACILITY_DOUBLE_BOOKING'].includes(c.type)&&same(c.segmentId,recommendation.segmentId)&&
    (!c.venue||venueKey(c.venue)===venueKey(venue))).map(c=>c.message)
   const facility=(data.facilities || []).find(f=>venueKey(f.name)===venueKey(venue))
   if(facility?.is_active===false)rejected.push('Facility is inactive.')
   if(fact?.blocked)rejected.push(...fact.reasons)
   const item={...alternative,venue,facilityId:fact?.id ?? facility?.id ?? null,score:evaluated?.plan.score ?? null,evaluationRank:evaluated?.plan.rank ?? null,
    order:evaluated?.index ?? Number.MAX_SAFE_INTEGER,capacity:fact?.capacity ?? null,
    minimumCapacity:fact?.minimumCapacity ?? null,equipment:fact?.equipment || [],
    suitability:[...(fact?.reasons || []),...(fact?.warnings || [])].join(' ') || 'Capacity is a minimum check only; attendance, facility type and required equipment need verification.',
    starts_at:segment?.starts_at,ends_at:segment?.ends_at,
    warnings:[...(evaluated?.plan.warnings || []),...(fact?.warnings || [])],remainingConflicts:(evaluated?.plan.conflicts || []).filter(c=>!rejected.includes(c.message)),
    rejectedReasons:rejected}
   ;(rejected.length?excludedAlternatives:alternatives).push(item)
  }
  // Preserve evaluator order, including its existing tie-break behavior.
  alternatives.sort((a,b)=>a.order-b.order)
  return {...recommendation,alternatives,excludedAlternatives}
 })
}
