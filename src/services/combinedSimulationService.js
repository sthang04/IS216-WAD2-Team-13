import { assessMemberReplacements, recommendFacilityRecovery, buildFacilityAndDelayRecoveryOptions } from './recoveryRecommendationService.js'

const same = (a,b) => a != null && b != null && String(a) === String(b)
const overlaps = (a,b,c,d) => Date.parse(a) < Date.parse(d) && Date.parse(c) < Date.parse(b)

/** Validate every card and normalize IDs to the loaded records. Local inputs
 * are Singapore time; explicit ISO offsets are accepted for tests/imports. */
export function prepareDisruptionCards(data, eventId, cards) {
  const event = data?.events?.find(e => same(e.id,eventId))
  if (!event) throw new Error('Please select an accessible event.')
  if (!Array.isArray(cards) || !cards.length) throw new Error('Add at least one disruption.')
  const segments = (data.event_segments || []).filter(s => same(s.event_id,event.id))
  const assigned = new Set((data.segment_assignments || []).filter(a => segments.some(s => same(s.id,a.segment_id))).map(a => String(a.member_id)))
  const linked = new Set((data.segment_facility_slots || []).filter(l => segments.some(s => same(s.id,l.segment_id))).map(l => String(l.facility_slot_id)))
  const venues = new Set((data.facility_slots || []).filter(s => linked.has(String(s.id))).map(s => s.venue_name))
  const ids = new Set()
  const timestamp = value => {
    const text = String(value || '')
    const local = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)
    const normalized = local ? text + ':00+08:00' : text
    if (!/(Z|[+-]\d{2}:\d{2})$/.test(normalized) || !Number.isFinite(Date.parse(normalized))) throw new Error('Enter valid Singapore date/time values.')
    if (local && new Date(Date.parse(normalized) + 8 * 3600000).toISOString().slice(0,16) !== text) throw new Error('Invalid calendar date.')
    return new Date(normalized).toISOString()
  }
  return cards.map((card,index) => {
    if (!card?.id || ids.has(String(card.id))) throw new Error('Each disruption needs a unique ID.')
    ids.add(String(card.id))
    const base = {id:card.id,type:card.type}
    if (card.type === 'SCHEDULE_DELAY') {
      const segment = segments.find(s => same(s.id,card.segmentId))
      const delayMinutes = Number(card.delayMinutes)
      if (!segment || !Number.isInteger(delayMinutes) || delayMinutes <= 0 || delayMinutes > 1440) throw new Error('Disruption '+(index+1)+': select an activity and a whole delay from 1 to 1440 minutes.')
      return {...base,segmentId:segment.id,delayMinutes}
    }
    if (!['MEMBER_UNAVAILABLE','FACILITY_UNAVAILABLE'].includes(card.type)) throw new Error('Unsupported disruption type.')
    const start = timestamp(card.start), end = timestamp(card.end)
    if (Date.parse(start) >= Date.parse(end)) throw new Error('Disruption '+(index+1)+': end must be after start.')
    if (card.type === 'MEMBER_UNAVAILABLE') {
      const member = (data.members || []).find(m => same(m.id,card.memberId) && assigned.has(String(m.id)))
      if (!member) throw new Error('Select a member assigned to this event.')
      return {...base,memberId:member.id,start,end}
    }
    // UI chooses an actual booking; reject a stale booking from another event.
    // Legacy callers may still pass a verified linked venue name alone.
    if(card.facilityBookingId!=null){
      const booking=(data.facility_slots || []).find(slot=>same(slot.id,card.facilityBookingId)&&linked.has(String(slot.id)))
      if(!booking || booking.venue_name!==card.venueName)throw new Error('Select an actual facility booking linked to this event.')
    }
    if (!venues.has(card.venueName)) throw new Error('Select a facility linked to this event.')
    return {...base,venueName:card.venueName,start,end}
  })
}

/** Use the combined simulated timings for both impact targeting and candidate
 * conflicts. Group repeated unavailable periods by member, not by card. */
export function assessCombinedRecovery(data,eventId,result,disruptions) {
  if (!result) return {memberGroups:[],facilityRecovery:[],facilityOptions:[],delayedChanges:[]}
  const simulated = new Map(result.simulatedSegments.map(s => [String(s.id),s]))
  const scheduleData = {...data,event_segments:data.event_segments.map(s => simulated.get(String(s.id)) || s)}
  const memberIds = [...new Set(disruptions.filter(d => d.type === 'MEMBER_UNAVAILABLE').map(d => String(d.memberId)))]
  const memberGroups = memberIds.map(id => {
    const member = data.members.find(m => same(m.id,id))
    const affectedAssignments = data.segment_assignments.filter(a => {
      const segment = simulated.get(String(a.segment_id))
      return same(a.member_id,id) && segment && disruptions.some(d => d.type === 'MEMBER_UNAVAILABLE' && same(d.memberId,id) && overlaps(segment.starts_at,segment.ends_at,d.start,d.end))
    })
    const segmentIds = new Set(affectedAssignments.map(a => String(a.segment_id)))
    return { memberId:member?.id ?? id, memberName:member?.full_name || 'Member name unavailable',
      affectedAssignments, segments:[...simulated.values()].filter(s => segmentIds.has(String(s.id))),
      ...assessMemberReplacements(scheduleData,eventId,member?.id ?? id,disruptions) }
  })
  const facilityRecovery = recommendFacilityRecovery(scheduleData,eventId,result,disruptions)
  const facilityOptions = buildFacilityAndDelayRecoveryOptions(data,eventId,result,disruptions,facilityRecovery)
  const original = new Map(data.event_segments.map(s => [String(s.id),s]))
  const delayedChanges = [...simulated.values()].filter(s => {
    const before = original.get(String(s.id))
    return before && (Date.parse(s.starts_at)!==Date.parse(before.starts_at) || Date.parse(s.ends_at)!==Date.parse(before.ends_at))
  }).map(s => ({segmentId:s.id,starts_at:s.starts_at,ends_at:s.ends_at}))
  return {memberGroups,facilityRecovery,facilityOptions,delayedChanges}
}

/** Build bounded, explicit preview options rather than a combinatorial search.
 * Organizers choose one candidate per member and optionally a facility/time
 * option. The evaluator checks the merged plan against ALL disruptions. */
export function buildCombinedRecoveryOptions(assessment,selections={},facilityOptionIds=[]) {
  const options = [], seen = new Set()
  const optionKey = option => JSON.stringify(option.changes.map(change =>
    Object.fromEntries(Object.entries(change).sort(([a],[b]) => a.localeCompare(b))))
    .sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))))
  const add = option => {
    const key = optionKey(option)
    if (!option.changes.length || seen.has(key)) return
    seen.add(key); options.push(option)
  }
  const memberChanges = (group,candidate) => group.affectedAssignments.map(a => ({
    segmentId:a.segment_id,assignmentId:a.id,roleName:a.role_name,
    replacedMemberId:group.memberId,replacementMemberId:candidate.id
  }))
  for (const option of assessment.facilityOptions) add(option)
  for (const group of assessment.memberGroups) {
    for (const candidate of group.eligible) add({
      id:'member-'+group.memberId+'-candidate-'+candidate.id,
      title:'Replace '+group.memberName+' with '+candidate.name,
      changes:[...assessment.delayedChanges,...memberChanges(group,candidate)], requiresApproval:true
    })
  }
  const requestedIds = Array.isArray(facilityOptionIds) ? facilityOptionIds : [facilityOptionIds]
  const facilities = assessment.facilityOptions.filter(o => requestedIds.includes(o.id))
  const delayedById = new Map(assessment.delayedChanges.map(c => [String(c.segmentId),c]))
  const merged = new Map(assessment.delayedChanges.map(c => [String(c.segmentId),{...c}]))
  const overrides = new Map(), selectionIssues = []
  for (const option of facilities) {
    for (const change of option.changes) {
      const key = String(change.segmentId)
      const target = merged.get(key) || {segmentId:change.segmentId}
      for (const field of ['starts_at','ends_at','venueName']) {
        if (change[field] === undefined || change[field] === delayedById.get(key)?.[field]) continue
        const fieldKey = key + ':' + field
        if (overrides.has(fieldKey) && overrides.get(fieldKey) !== change[field]) {
          selectionIssues.push('Contradictory '+field+' choices for activity '+key)
        }
        overrides.set(fieldKey,change[field]); target[field] = change[field]
      }
      merged.set(key,target)
    }
  }
  const changes = [...merged.values()]
  let selected = facilities.length > 0
  for (const group of assessment.memberGroups) {
    const candidate = group.eligible.find(c => same(c.id,selections[String(group.memberId)]))
    if (!candidate) continue
    changes.push(...memberChanges(group,candidate)); selected = true
  }
  if (selected) {
    const combined = {id:'combined-selected',title:'Combined selected recovery preview',changes,selectionIssues,
      requiresApproval:true,note:'All remaining conflicts and unselected replacements still require resolution.'}
    // An explicitly selected plan replaces an identical individual option,
    // rather than showing duplicate proposals under different titles.
    const duplicate = options.findIndex(option => optionKey(option) === optionKey(combined))
    if (duplicate >= 0) options.splice(duplicate,1)
    options.push(combined)
  }
  return options
}
