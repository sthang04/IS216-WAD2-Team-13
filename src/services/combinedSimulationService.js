// Purpose: Validate disruption cards and combine member, room and timing proposals without changing operational records.
import { requireEventRange, requireActivityRange } from './disruptionScheduleService.js'
import { simulatorBookingPeriod } from './simulatorFacilityEvidence.js'
import { activityKey } from './simulatorActivityGroups.js'
// Proposals stay hypothetical: merge choices here, then evaluate the complete
// schedule before ranking. A high rank never supplies consent or booking approval.
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
  const eventRange = requireEventRange(event)
  const ids = new Set()
  const timestamp = value => {
    const text = String(value || '')
    const local = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(text)
    const normalized = local ? text + (text.length === 16 ? ':00' : '') + '+08:00' : text
    if (!/(Z|[+-]\d{2}:\d{2})$/.test(normalized) || !Number.isFinite(Date.parse(normalized))) throw new Error('Enter valid Singapore date/time values.')
    if (local && new Date(Date.parse(normalized) + 8 * 3600000).toISOString().slice(0,text.length) !== text) throw new Error('Invalid calendar date.')
    return new Date(normalized).toISOString()
  }
  return cards.map((card,index) => {
    if (!card?.id || ids.has(String(card.id))) throw new Error('Each disruption needs a unique ID.')
    ids.add(String(card.id))
    const base = {id:card.id,type:card.type}
    if (card.type === 'SCHEDULE_DELAY') {
      const segment = segments.find(s => same(s.id,card.segmentId))
      if(segment?.is_fixed) throw new Error('Fixed Day Ops task times cannot be moved.')
      const delayMinutes = Number(card.delayMinutes)
      if (!segment || !Number.isInteger(delayMinutes) || delayMinutes <= 0 || delayMinutes > 1440) throw new Error('Disruption '+(index+1)+': select an activity and a whole delay from 1 to 1440 minutes.')
      // Delay begins at the selected activity's scheduled start. Bound its original
      // interval only: the delayed finish can legitimately exceed the event end.
      requireActivityRange(eventRange, segment)
      return {...base,segmentId:segment.id,delayMinutes}
    }
    if (!['MEMBER_UNAVAILABLE','FACILITY_UNAVAILABLE'].includes(card.type)) throw new Error('Unsupported disruption type.')
    const start = timestamp(card.start), end = timestamp(card.end)
    if (Date.parse(start) >= Date.parse(end)) throw new Error('Disruption '+(index+1)+': end must be after start.')
    // Resource outages are event-level intervals and may span concurrent activities
    // or gaps. The engine targets affected assignments/bookings by actual overlap.
    if (Date.parse(start) < eventRange.start || Date.parse(end) > eventRange.end)
      throw new Error('Disruption '+(index+1)+': choose an interval within the selected event schedule (Singapore time).')
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
  const venueMoves = buildVenueMoves(data,disruptions,facilityRecovery,simulated,delayedChanges)
  const crewShifts = buildCrewShifts(data,eventId,simulated,delayedChanges)
  return {memberGroups,facilityRecovery,facilityOptions,delayedChanges,venueMoves,crewShifts}
}

/** Whole-venue moves: when a room is unavailable, offer "move everything held
 * there to one room" instead of a different room per activity (or per Day Ops
 * crew member's copy). Rooms with a confirmed booking in that window rank last;
 * every move is still tentative and evaluated like any other proposal. */
function buildVenueMoves(data,disruptions,facilityRecovery,simulated,delayedChanges) {
  const venues = [...new Set(disruptions.filter(d => d.type === 'FACILITY_UNAVAILABLE').map(d => d.venueName))]
  return venues.map(venue => {
    const recs = facilityRecovery.filter(r => r.issue === 'Facility unavailable' && String(r.originalVenue || '').split(', ').includes(venue))
    if (!recs.length) return null
    const segments = recs.map(r => simulated.get(String(r.segmentId))).filter(Boolean)
    const from = new Date(Math.min(...segments.map(s => Date.parse(s.starts_at)))).toISOString()
    const to = new Date(Math.max(...segments.map(s => Date.parse(s.ends_at)))).toISOString()
    // Rooms every affected activity could move to
    const common = recs.map(r => new Set((r.alternatives || []).map(a => a.venue)))
      .reduce((a,b) => new Set([...a].filter(room => b.has(room))))
    // How long each room is free: confirmed bookings (that this account can see)
    // in the window; activities that clash with one stay where they are.
    const clock = ms => new Intl.DateTimeFormat('en-SG',{timeZone:'Asia/Singapore',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(ms))
    const start = Date.parse(from), end = Date.parse(to)
    const bookedTimes = room => (data.facility_slots || [])
      .filter(slot => !slot.venue_only && slot.venue_name === room && /booked|confirmed/i.test(slot.status || ''))
      .map(slot => simulatorBookingPeriod(slot).map(Date.parse))
      .filter(([a,b]) => Number.isFinite(a) && Number.isFinite(b) && a < end && start < b)
    const activityCount = list => new Set(list.map(activityKey)).size
    const rooms = [...common].map(room => {
      const busy = bookedTimes(room)
      const fits = segments.filter(seg => !busy.some(([a,b]) => Date.parse(seg.starts_at) < b && a < Date.parse(seg.ends_at)))
      const firstBooked = busy.length ? Math.min(...busy.map(b => b[0])) : null
      const lastFree = busy.length ? Math.max(...busy.map(b => b[1])) : null
      const availability = !busy.length ? 'Free the whole time'
        : firstBooked > start ? 'Free until '+clock(firstBooked)
        : lastFree < end ? 'Free from '+clock(lastFree) : 'Mostly booked'
      const left = segments.filter(seg => !fits.includes(seg))
      return { room, fits, availability, leftover:[...new Set(left.map(seg => seg.title))], covered:activityCount(fits), total:activityCount(segments) }
    }).filter(r => r.fits.length).sort((a,b) => b.fits.length - a.fits.length).slice(0,6)
    // For a room that is only free part of the time: rooms that can take the rest
    const fillsFor = r => {
      const left = segments.filter(seg => !r.fits.includes(seg))
      if (!left.length) return []
      const span = clock(Math.min(...left.map(seg => Date.parse(seg.starts_at))))+'–'+clock(Math.max(...left.map(seg => Date.parse(seg.ends_at))))
      return [...common].filter(room => room !== r.room)
        .filter(room => { const busy = bookedTimes(room); return left.every(seg => !busy.some(([a,b]) => Date.parse(seg.starts_at) < b && a < Date.parse(seg.ends_at))) })
        .slice(0,4).map(room => ({ id:'venue-fill-'+venue+'-'+r.room+'-'+room, title:'Move '+[...new Set(left.map(seg => seg.title))].join(', ')+' to '+room, kind:'venue-fill',
          room, span, changes:left.map(seg => ({segmentId:seg.id,venueName:room})), requiresApproval:true }))
    }
    const moved = recs.map(r => String(r.segmentId))
    return { venue, segmentIds:moved, options:rooms.map(r => {
      const changes = new Map(delayedChanges.map(c => [String(c.segmentId),{...c}]))
      for (const seg of r.fits) changes.set(String(seg.id),{...(changes.get(String(seg.id)) || {segmentId:seg.id}),venueName:r.room})
      return { id:'venue-move-'+venue+'-'+r.room, title:'Move '+venue+' activities to '+r.room, kind:'venue-move',
        room:r.room, availability:r.availability, leftover:r.leftover, covered:r.covered, total:r.total, fill:fillsFor(r),
        changes:[...changes.values()], requiresApproval:true,
        note:r.leftover.length?r.availability+'. '+r.leftover.join(', ')+' still need a room.':'Tentative room move; booking, capacity and equipment need confirmation.' }
    }) }
  }).filter(Boolean)
}

/** Delay knock-on, Day-of Ops style, for the crew whose delayed task now runs into
 * their next one (their own task copies only; fixed tasks never move):
 *  - End on time: the delayed activity starts late but keeps its original finish
 *    (needs 15 min left), so nobody's next task is touched.
 *  - Shorten: start their next task when the delayed one ends, same finish time.
 *    Absorbs the delay without moving anything else (needs 15 min left).
 *  - Push back: move their following tasks later just enough; a chain that hits a
 *    fixed task stops there and the remaining clash is left for the evaluator. */
function buildCrewShifts(data,eventId,simulated,delayedChanges) {
  if (!delayedChanges.length) return []
  const original = new Map(data.event_segments.filter(s => same(s.event_id,eventId)).map(s => [String(s.id),s]))
  const delayed = new Map(delayedChanges.map(c => [String(c.segmentId),c]))
  const shifts = new Map(), members = new Set(), blocked = []
  const shortened = new Map(), shortMembers = new Set(), shortTitles = new Set()
  for (const change of delayedChanges) {
    const segment = original.get(String(change.segmentId))
    if (segment?.source_table !== 'ops_tasks') continue
    for (const assignment of data.segment_assignments.filter(a => same(a.segment_id,segment.id))) {
      const later = data.segment_assignments
        .filter(a => same(a.member_id,assignment.member_id) && !same(a.segment_id,segment.id))
        .map(a => original.get(String(a.segment_id)))
        .filter(s => s && !delayed.has(String(s.id)) && Date.parse(s.starts_at) >= Date.parse(segment.starts_at))
        .sort((a,b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
      let cursor = Date.parse(change.ends_at)
      const first = later.find(next => Date.parse(next.starts_at) < cursor)
      if (first && !first.is_fixed && Date.parse(first.ends_at) - cursor >= 15 * 60000) {
        shortened.set(String(first.id),{segmentId:first.id,starts_at:new Date(cursor).toISOString(),ends_at:first.ends_at})
        shortMembers.add(String(assignment.member_id)); shortTitles.add(first.title)
      }
      for (const next of later) {
        const start = Date.parse(next.starts_at), end = Date.parse(next.ends_at)
        if (start >= cursor) break
        if (next.is_fixed) { blocked.push(next.title); break }
        const shift = cursor - start
        shifts.set(String(next.id),{segmentId:next.id,starts_at:new Date(start+shift).toISOString(),ends_at:new Date(end+shift).toISOString()})
        members.add(String(assignment.member_id))
        cursor = end + shift
      }
    }
  }
  const who = ids => { const names = [...ids].map(id => data.members.find(m => same(m.id,id))?.full_name || 'Member '+id); return names.length > 2 ? names.length+' crew members' : names.join(' and ') }
  const options = []
  // End on time: every delayed Day Ops activity keeps its original end
  const endOnTime = delayedChanges.map(c => ({c, s:original.get(String(c.segmentId))}))
    .filter(({s}) => s?.source_table === 'ops_tasks')
  if (endOnTime.length && endOnTime.every(({c,s}) => !s.is_fixed && Date.parse(s.ends_at) - Date.parse(c.starts_at) >= 15 * 60000)) {
    const clock = iso => new Intl.DateTimeFormat('en-SG',{timeZone:'Asia/Singapore',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(iso))
    const titles = [...new Map(endOnTime.map(({c,s}) => [s.title+'|'+c.starts_at,s.title+' to '+clock(c.starts_at)+'–'+clock(s.ends_at)])).values()]
    options.push({ id:'delay-end-on-time', title:'Shorten '+titles.join(', ')+' (ends on time)', kind:'crew-shift',
      changes:endOnTime.map(({c,s}) => ({segmentId:c.segmentId,starts_at:c.starts_at,ends_at:s.ends_at})), requiresApproval:true,
      note:'The delayed activity gets shorter so everyone still makes their next task.' })
  }
  if (shortened.size) options.push({ id:'crew-shorten', title:'Start '+who(shortMembers)+"'s "+[...shortTitles].join(', ')+' later (same finish time)', kind:'crew-shift',
    changes:[...delayedChanges,...shortened.values()], requiresApproval:true, note:'Their next task gets shorter so nothing else moves.' })
  if (shifts.size) options.push({ id:'crew-shift', title:'Push back '+who(members)+"'s next "+(shifts.size===1?'task':'tasks'), kind:'crew-shift',
    changes:[...delayedChanges,...shifts.values()], requiresApproval:true,
    note:blocked.length?'Fixed tasks ('+[...new Set(blocked)].join(', ')+') cannot move; check those clashes.':'Only the affected crew members\' own tasks move.' })
  return options
}

/** Retain individual building blocks and a custom preview, then enumerate a
 * bounded product of candidate and facility/time choices for whole-plan ranking.
 * Every proposal still requires evaluation against ALL disruptions. */
export function buildCombinedRecoveryOptions(assessment,selections={},facilityOptionIds=[],generate=true) {
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
  // Activities covered by a whole-venue move skip the per-activity room options
  const venueMoveOptions = (assessment.venueMoves || []).flatMap(v => v.options)
  const covered = new Set((assessment.venueMoves || []).flatMap(v => v.segmentIds))
  // "Rest of the time" rooms are only picked alongside a partly-free room, never ranked alone
  const allFacilityOptions = [...assessment.facilityOptions, ...venueMoveOptions, ...venueMoveOptions.flatMap(o => o.fill || [])]
  for (const option of assessment.facilityOptions)
    if (!option.changes.some(c => covered.has(String(c.segmentId)) && (c.venueName || c.starts_at))) add(option)
  for (const option of venueMoveOptions) add(option)
  for (const option of assessment.crewShifts || []) add(option)
  for (const group of assessment.memberGroups) {
    for (const candidate of group.eligible) add({
      id:'member-'+group.memberId+'-candidate-'+candidate.id,
      title:'Replace '+group.memberName+' with '+candidate.name,
      changes:[...assessment.delayedChanges,...memberChanges(group,candidate)], requiresApproval:true
    })
  }
  const requestedIds = Array.isArray(facilityOptionIds) ? facilityOptionIds : [facilityOptionIds]
  const facilities = allFacilityOptions.filter(o => requestedIds.includes(o.id))
  const delayedById = new Map(assessment.delayedChanges.map(c => [String(c.segmentId),c]))
  const merged = new Map(assessment.delayedChanges.map(c => [String(c.segmentId),{...c}]))
  // Conflicting room/time choices are recorded as invalid instead of letting
  // the last selected option silently overwrite an earlier choice.
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
    const combined = {id:'combined-selected',title:'Custom combined recovery preview',changes,selectionIssues,sourceFacilityOptionIds:facilities.map(o=>o.id),kind:'custom',
      requiresApproval:true,note:'All remaining conflicts and unselected replacements still require resolution.'}
    // An explicitly selected plan replaces an identical individual option,
    // rather than showing duplicate proposals under different titles.
    const duplicate = options.findIndex(option => optionKey(option) === optionKey(combined))
    if (duplicate >= 0) options.splice(duplicate,1)
    options.push(combined)
  }
  if (generate) {
    // Bounded search over actual building blocks, never synthetic approvals.
    const dimensions = assessment.memberGroups.filter(g=>g.affectedAssignments.length).map(group=>
      group.eligible.slice(0,4).map(candidate=>({member:[String(group.memberId),candidate.id]})))
    const base = new Map(assessment.delayedChanges.map(c=>[String(c.segmentId),c]))
    for (const venueMove of assessment.venueMoves || [])
      dimensions.push(venueMove.options.slice(0,4).map(option=>({facility:option.id})))
    for (const recommendation of assessment.facilityRecovery) {
      if (covered.has(String(recommendation.segmentId))) continue
      const choices=assessment.facilityOptions.filter(option=>option.changes.some(c=>
        same(c.segmentId,recommendation.segmentId) && (c.venueName ||
        (c.starts_at && c.starts_at!==base.get(String(c.segmentId))?.starts_at))))
      dimensions.push(choices.slice(0,4).map(option=>({facility:option.id})))
    }
    // Cap the Cartesian search so several disrupted members/rooms do not
    // freeze the UI. Generated options still pass the full plan evaluator.
    let count=0
    // Name a generated plan by what it does, e.g. "Move Main Hall activities to X + Replace A with B"
    const describe=(members,rooms)=>[
      ...rooms.map(id=>allFacilityOptions.find(o=>o.id===id)?.title),
      ...Object.entries(members).map(([memberId,candidateId])=>{const group=assessment.memberGroups.find(g=>same(g.memberId,memberId));const candidate=group?.eligible.find(c=>same(c.id,candidateId));return group&&candidate?'Replace '+group.memberName+' with '+candidate.name:null})
    ].filter(Boolean).join(' + ')
    const visit=(index,members,rooms)=>{
      if(count>=64)return
      if(index===dimensions.length){
        count++
        const proposal=buildCombinedRecoveryOptions(assessment,members,rooms,false).find(o=>o.id==='combined-selected')
        if(proposal && !proposal.selectionIssues.length)add({...proposal,
          id:'overall-'+JSON.stringify([Object.entries(members),rooms]),title:describe(members,rooms) || 'Combined recovery option '+count,
          kind:'combined',sourceFacilityOptionIds:rooms})
        return
      }
      for(const choice of dimensions[index])visit(index+1,choice.member?{...members,[choice.member[0]]:choice.member[1]}:members,choice.facility?[...rooms,choice.facility]:rooms)
    }
    if(dimensions.length && dimensions.every(d=>d.length))visit(0,{},[])
  }
  return options
}
