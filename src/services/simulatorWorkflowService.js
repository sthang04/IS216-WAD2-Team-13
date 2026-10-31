import {simulatorFacilityFacts} from './simulatorFacilityEvidence.js'
import {simulatorWorkflowActivation} from './simulatorWorkflowActivation.js'
// Defaults OFF. Environment activation never changes a database release gate.
export const SIMULATOR_WORKFLOW_VERIFIED = simulatorWorkflowActivation(import.meta.env || {}).enabled

const same = (a,b) => a != null && b != null && String(a) === String(b)
const order = (a,b) => BigInt(String(a)) < BigInt(String(b)) ? -1 : BigInt(String(a)) > BigInt(String(b)) ? 1 : 0
const clone = value => JSON.parse(JSON.stringify(value))
// JSONB key ordering differs from browser object insertion order.
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value==='object'
  ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])) : value
const equal = (a,b) => JSON.stringify(canonical(a))===JSON.stringify(canonical(b))
/** Stable identity for one reviewed Start payload. Equivalent option refreshes do
 * not create a new request; a changed proposal receives a different identity. */
export function simulatorStartRequestKey(draft) {
 if(!draft || draft.eventId==null) throw new Error('Select an event before starting recovery.')
 return JSON.stringify(canonical({eventId:String(draft.eventId),title:draft.title,
  changes:draft.changes,disruptions:draft.disruptions,expectedState:draft.expectedState}))
}
/** Normalize an explicit-offset timestamp WITHOUT passing its fraction through
 * JavaScript Date (which would discard PostgreSQL microseconds). Date converts
 * only the whole second to UTC; six fractional digits are preserved as text. */
export function normalizeSimulatorTimestamp(value) {
  if(typeof value==='number') {
    if(!Number.isSafeInteger(value)) throw new Error('Invalid timestamp milliseconds.')
    value=new Date(value).toISOString()
  }
  const match=String(value || '').replace(' ','T').match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/)
  if(!match) throw new Error('Snapshot requires a finite timestamp with an explicit timezone and at most six fractional digits.')
  const whole=Date.parse(match[1]+match[3])
  if(!Number.isFinite(whole)) throw new Error('Snapshot contains invalid times.')
  return new Date(whole).toISOString().slice(0,19)+'.'+(match[2] || '').padEnd(6,'0')+'Z'
}
const iso=normalizeSimulatorTimestamp
// Exact integer comparisons avoid treating two times within one millisecond as equal.
export function simulatorTimestampMicros(value) {
  const text=iso(value)
  return BigInt(Date.parse(text.slice(0,19)+'Z'))*1000n+BigInt(text.slice(20,26))
}

/** Reject absent/invalid revisions before any RPC. PostgreSQL repeats this check
 * independently, so a caller bypassing the Vue UI cannot bypass revision checks. */
export function validateSimulatorRevision(version) {
  if(!Number.isInteger(version)||version<1||version>2147483647) throw new Error('A positive integer plan revision is required.')
  return version
}

/** Capture only known event/assignment/link fields. SQL builds this same shape.
 * A separate capture RPC supplies a server fingerprint before saving. Browser data is not
 * authoritative. No member contact data or authentication IDs are included. */
export function captureSimulatorState(data,eventId) {
  const event=data?.events?.find(e=>same(e.id,eventId))
  if (!event) throw new Error('Select a loaded event before preparing a plan.')
  const segments=(data.event_segments || []).filter(s=>same(s.event_id,eventId)).map(s=>({
    id:s.id,event_id:s.event_id,title:s.title,segment_type:s.segment_type,starts_at:iso(s.starts_at),ends_at:iso(s.ends_at)
  })).sort((a,b)=>order(a.id,b.id))
  const ids=new Set(segments.map(s=>String(s.id)))
  if((data.segment_assignments || []).some(a=>ids.has(String(a.segment_id))&&!/^[1-9][0-9]*$/.test(String(a.id)))) throw new Error('Assignment snapshot is incomplete. Refresh actual event data.')
  const assignments=(data.segment_assignments || []).filter(a=>ids.has(String(a.segment_id))).map(a=>({
    id:a.id,segment_id:a.segment_id,member_id:a.member_id,role_name:a.role_name,is_required:a.is_required
  })).sort((a,b)=>order(a.id,b.id))
  const links=(data.segment_facility_bookings || data.segment_facility_slots || []).filter(l=>ids.has(String(l.segment_id)))
    .map(l=>({segment_id:l.segment_id,booking_id:l.booking_id ?? l.facility_slot_id}))
    .sort((a,b)=>order(a.segment_id,b.segment_id)||order(a.booking_id,b.booking_id))
  return clone({event:{id:event.id,name:event.name,club_name:event.club_name ?? null,starts_at:iso(event.starts_at),ends_at:iso(event.ends_at)},segments,assignments,links})
}

/** Normalize exact assignment IDs and times for a persisted recovery preview.
 * A proposed room may start pending. Only Confirm requires a real approved booking. */
export function prepareRecoveryDraft(data,eventId,option,disruptions,bookingSelections={}) {
  if (!option?.changes?.length || option.selectionIssues?.length) throw new Error('Select a non-contradictory recovery option.')
  const expected=captureSimulatorState(data,eventId)
  const changes=option.changes.map(change=>{
    const segment=expected.segments.find(s=>same(s.id,change.segmentId))
    if (!segment) throw new Error('Recovery option refers to an unrelated activity.')
    const result={...change,segmentId:segment.id}
    if (change.replacementMemberId != null) {
      const assignments=expected.assignments.filter(a=>same(a.segment_id,segment.id)&&same(a.member_id,change.replacedMemberId)&&
        (change.assignmentId == null || same(a.id,change.assignmentId)) && (change.roleName == null || a.role_name===change.roleName))
      if (assignments.length!==1) throw new Error('An exact assignment ID is required for replacement.')
      result.assignmentId=assignments[0].id; result.roleName=assignments[0].role_name
    }
    if (change.venueName != null) {
      result.facilityBookingId=bookingSelections[String(segment.id)] ?? change.facilityBookingId
      // Start records the proposed room; a booking may be attached after claiming.
      if (!result.facilityBookingId) delete result.facilityBookingId
    }
    const start=change.starts_at ?? segment.starts_at, end=change.ends_at ?? segment.ends_at
    let validPeriod=false
    try {validPeriod=simulatorTimestampMicros(start)<simulatorTimestampMicros(end)} catch {}
    if(!validPeriod) throw new Error('Invalid proposed activity times.')
    return result
  })
  return clone({eventId,title:option.title || 'Recovery preview',changes,disruptions,expectedState:expected})
}

/** Local readiness is explanatory only. The SQL apply/undo RPC repeats all
 * checks against live rows. An Accepted invitation is NOT an applied assignment. */
export function workflowReadiness({enabled=false,plan,invites=[],manualAcknowledged=false}) {
  const reasons=[]
  if (!enabled) reasons.push('Live workflow is disabled until deployment and staging verification.')
  if (!plan || plan.application_status!=='Draft' || plan.lifecycle!=='In Progress') reasons.push('Start a current recovery plan first.')
  if(!Array.isArray(plan?.actions)) reasons.push('Refresh persisted action statuses before confirmation.')
  for(const action of plan?.actions || []) {
    if(action.kind==='Room'&&action.status!=='Approved') reasons.push('Room action '+action.action+': '+action.status+'.')
  }
  if (!manualAcknowledged) reasons.push('Acknowledge incomplete personal timetable and qualification evidence.')
  for(const change of plan?.changes || []) {
    if(change.venueName!=null || change.facilityBookingId!=null) {
      if(!(plan?.actions || []).some(a=>a.kind==='Room'&&same(a.segmentId,change.segmentId)&&a.status==='Approved')) reasons.push('Approved calendar booking is required for activity '+change.segmentId+'.')
    }
    if(change.replacementMemberId==null) continue
    let terms
    try {terms=invitationTerms(plan,change.replacedMemberId)} catch {reasons.push('Invitation terms are incomplete; refresh the saved plan.');continue}
    const invite=invites.find(i=>same(i.plan_id,plan.id)&&same(i.recipient_member_id,change.replacementMemberId)&&
      same(i.replaced_member_id,change.replacedMemberId)&&effectiveInvitationStatus(i)==='Accepted'&&
      equal(i.assignment_snapshot,terms))
    if(!invite) reasons.push('An accepted invitation is required for replacement member '+change.replacementMemberId+'.')
  }
  return {ready:reasons.length===0,reasons:[...new Set(reasons)]}
}

// A missing selected plan must never become a null RPC target.
function selectedPlanId(plan) {
 if(typeof plan?.id!=='string'||!plan.id.trim())throw new Error('Select a saved recovery plan before this operation.')
 return plan.id
}

/** Thin RPC adapter, using the shared authenticated Supabase client. The caller
 * ID is never passed as proof of identity. Disabled means ZERO network requests.
 * All real mutations require explicit confirmation from the UI. */
export function createSimulatorWorkflow(client,{enabled=false,allowReadOnly=false}={}) {
  const startRequests=new Map()
  const call=async(name,args,confirmed=false,write=false)=>{
    if(!enabled && !(allowReadOnly && !write)) throw new Error('Live simulator workflow has not been deployed and verified.')
    if(write&&!confirmed) throw new Error('Confirm the real database operation first.')
    if(!client) throw new Error('Supabase is unavailable.')
    const {data,error}=await client.rpc(name,args)
    if(error) throw new Error(error.message)
    if(data?.ok===false) throw new Error(data.error || 'The server rejected this operation.')
    if(!data || typeof data!=='object' || Array.isArray(data)) throw new Error('The server returned no valid workflow result.')
    // Transport success alone is insufficient. Match the returned record and
    // final status to this exact action before the UI may announce success.
    if(write) {
      const planStatus={rpc_simulator_cancel_plan:'Cancelled',rpc_simulator_apply_plan:'Applied',rpc_simulator_undo_plan:'Undone'}[name]
      let valid=true
      if(planStatus) valid=same(data.id,args.p_plan_id)&&data.application_status===planStatus&&Number.isInteger(data.version)&&data.version>=args.p_expected_version
      if(name==='rpc_simulator_respond_invitation') valid=same(data.id,args.p_invitation_id)&&data.status===args.p_response
      if(name==='rpc_simulator_cancel_invitation') valid=same(data.id,args.p_invitation_id)&&data.status==='Cancelled'
      if(name==='rpc_simulator_invite') valid=!!data.id&&same(data.plan_id,args.p_plan_id)&&same(data.recipient_member_id,args.p_recipient_member_id)&&same(data.replaced_member_id,args.p_replaced_member_id)&&['Pending','Accepted'].includes(data.status)
      if(name==='rpc_simulator_attach_booking') valid=same(data.id,args.p_plan_id)&&data.application_status==='Draft'&&Number.isInteger(data.version)&&data.version>=args.p_expected_version&&Array.isArray(data.changes)&&data.changes.some(c=>same(c.segmentId,args.p_segment_id)&&same(c.facilityBookingId,args.p_booking_id))
      if(name==='rpc_simulator_resolve_disruption') valid=data.resolved===true&&data.disruption_index===args.p_disruption_index&&same(data.plan?.id,args.p_plan_id)&&data.plan?.application_status==='Applied'&&Number.isInteger(data.plan?.version)&&data.plan.version>=args.p_expected_version
      if(!valid) throw new Error('The server did not confirm the selected operation. Refresh persisted history before retrying.')
    }
    return data
  }
  return {
    capabilities:async(eventId=null)=>{
      const result=await call('rpc_simulator_workflow_capabilities',{p_event_id:eventId})
      if(result.contract_version!==4||typeof result.application_enabled!=='boolean'||typeof result.invitations_enabled!=='boolean')
        throw new Error('Reviewed recovery capabilities are unavailable; backend verification is required.')
      return result
    },
    history:async eventId=>{
      const result=await call('rpc_simulator_plan_history',{p_event_id:eventId})
      if(!['plans','invitations','audit'].every(key=>Array.isArray(result[key]))) throw new Error('Malformed recovery history response.')
      return result
    },
    myInvitations:async()=>{
      const result=await call('rpc_simulator_my_invitations',{})
      if(!Array.isArray(result.invitations)||result.invitations.some(i=>!i||!i.id||!Array.isArray(i.assignment_snapshot)))throw new Error('Incomplete invitation inbox response.')
      return result
    },
    invitation:id=>call('rpc_simulator_invitation',{p_invitation_id:id}),
    captureState:eventId=>call('rpc_simulator_capture_state',{p_event_id:eventId}),
    save:async(draft,confirmed)=>{
      // Do not rebase a stale preview onto fresh server data. Compare the exact
      // capture first, then send the SERVER fingerprint unchanged to Save.
      if(!enabled) throw new Error('Live simulator workflow has not been deployed and verified.')
      if(!confirmed) throw new Error('Confirm the real database operation first.')
      const capture=await call('rpc_simulator_capture_state',{p_event_id:draft.eventId})
      if(!capture.state || !/^[a-f0-9]{64}$/.test(capture.fingerprint || '')) throw new Error('Invalid server state capture.')
      if(!equal(capture.state,draft.expectedState)) throw new Error('Event changed; refresh and regenerate the preview.')
      return call('rpc_simulator_save_plan',{p_event_id:draft.eventId,p_title:draft.title,
        p_changes:draft.changes,p_expected_state:capture.state,p_expected_fingerprint:capture.fingerprint,
        p_disruptions:draft.disruptions},confirmed,true)
    },

    // Start uses the same lossless capture as Save, but the server atomically
    // creates pending invitations and returns the real persisted plan ID.
    start:async(draft,confirmed)=>{
      if(!enabled) throw new Error('Live simulator workflow has not been deployed and verified.')
      if(!confirmed) throw new Error('Confirm the real database operation first.')
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(draft.requestId || '')) throw new Error('A start request UUID is required.')
      const key=simulatorStartRequestKey(draft)
      let request=startRequests.get(draft.requestId)
      if(request && request.key!==key) throw new Error('This request ID belongs to different reviewed changes.')
      if(!request) {
        // Freeze the first server capture. A lost write response must retry the
        // SAME payload, not capture a later event state and reuse its old UUID.
        const frozen=clone(draft)
        request={key}
        request.prepared=(async()=>{
          const capture=await call('rpc_simulator_capture_state',{p_event_id:frozen.eventId})
          if(!capture.state || !/^[a-f0-9]{64}$/.test(capture.fingerprint || '')) throw new Error('Invalid server state capture.')
          if(!equal(capture.state,frozen.expectedState)) throw new Error('Event changed; refresh and regenerate the preview.')
          return {p_event_id:frozen.eventId,p_title:frozen.title,p_changes:frozen.changes,
            p_expected_state:capture.state,p_expected_fingerprint:capture.fingerprint,
            p_disruptions:frozen.disruptions,p_request_id:frozen.requestId}
        })()
        startRequests.set(draft.requestId,request)
      }
      let args
      try {args=await request.prepared}
      catch(error){startRequests.delete(draft.requestId);throw error}
      // Keep prepared arguments on ambiguous network failure. The backend's
      // unique request key independently prevents a second persisted plan.
      const result=await call('rpc_simulator_start_plan',clone(args),confirmed,true)
      if(!result.id || result.lifecycle!=='In Progress' && !['Applied','Cancelled','Undone'].includes(result.application_status))
        throw new Error('The server did not confirm a persisted recovery plan.')
      return result
    },
    attachBooking:async(plan,segmentId,bookingId,confirmed)=>call('rpc_simulator_attach_booking',{p_plan_id:selectedPlanId(plan),
      p_expected_version:validateSimulatorRevision(plan?.version),p_segment_id:segmentId,p_booking_id:bookingId},confirmed,true),
    cancelPlan:async(plan,confirmed)=>call('rpc_simulator_cancel_plan',{p_plan_id:selectedPlanId(plan),
      p_expected_version:validateSimulatorRevision(plan?.version)},confirmed,true),
    confirm:(plan,ack,confirmed)=>call('rpc_simulator_apply_plan',{p_plan_id:selectedPlanId(plan),
      p_expected_version:validateSimulatorRevision(plan?.version),p_accept_unverified:ack},confirmed,true),
    invite:(planId,recipient,replaced,confirmed)=>call('rpc_simulator_invite',{p_plan_id:planId,p_recipient_member_id:recipient,p_replaced_member_id:replaced},confirmed,true),
    respond:(id,response,confirmed)=>{
      if(!['Accepted','Declined'].includes(response)) throw new Error('Choose Accept or Decline.')
      return call('rpc_simulator_respond_invitation',{p_invitation_id:id,p_response:response},confirmed,true)
    },
    cancel:(id,confirmed)=>call('rpc_simulator_cancel_invitation',{p_invitation_id:id},confirmed,true),
    apply:async(plan,ack,confirmed)=>call('rpc_simulator_apply_plan',{p_plan_id:selectedPlanId(plan),p_expected_version:validateSimulatorRevision(plan?.version),p_accept_unverified:ack},confirmed,true),
    resolveDisruption:async(plan,index,note,confirmed)=>{
      if(!Number.isInteger(index)||index<1)throw new Error('Select a recorded disruption.')
      const reason=String(note || '').trim()
      if(reason.length<8||reason.length>2000)throw new Error('Provide a resolution reason (8-2000 characters).')
      return call('rpc_simulator_resolve_disruption',{p_plan_id:selectedPlanId(plan),
        p_expected_version:validateSimulatorRevision(plan?.version),p_disruption_index:index,
        p_resolution_note:reason,p_acknowledge_resolution:true},confirmed,true)
    },
    undo:async(plan,ack,confirmed)=>call('rpc_simulator_undo_plan',{p_plan_id:selectedPlanId(plan),p_expected_version:validateSimulatorRevision(plan?.version),p_accept_unverified:ack},confirmed,true)
  }
}

/** Inspect known booking records by physical facility ID. This is display
 * evidence only; the shared calendar and future apply RPC remain authoritative. */
export function bookingEvidence(data,bookingId,eventClubId,start,end,eventId=null) {
  const booking=(data.facility_bookings || []).find(b=>same(b.id,bookingId))
  if(!booking) return {status:'Unverified',reasons:['Booking is not in accessible records.']}
  const facility=(data.facilities || []).find(f=>same(f.id,booking.facility_id))
  const begin=Date.parse(booking.booking_date+'T'+booking.start_time+'+08:00')
  const finish=Date.parse(booking.booking_date+'T'+booking.end_time+'+08:00')
  const reasons=[]
  if(!['Booked','Officially Confirmed Booking'].includes(booking.status)) reasons.push('Booking is not confirmed for use.')
  if(!same(booking.owner_club_id,eventClubId)) reasons.push('Booking belongs to another club.')
  if(!(begin<=Date.parse(start)&&finish>=Date.parse(end))) reasons.push('Booking does not cover the proposed times.')
  // This is visible evidence only; the locked server validator checks ALL links.
  const segmentEvents=new Map((data.event_segments || []).map(segment=>[String(segment.id),String(segment.event_id)]))
  if(eventId!=null&&(data.segment_facility_bookings || []).some(link=>same(link.booking_id,bookingId)&&segmentEvents.has(String(link.segment_id))&&!same(segmentEvents.get(String(link.segment_id)),eventId)))
    reasons.push('Booking is already allocated to another event.')
  const conflicts=(data.facility_bookings || []).filter(b=>!same(b.id,booking.id)&&same(b.facility_id,booking.facility_id)&&
    Date.parse(b.booking_date+'T'+b.start_time+'+08:00')<Date.parse(end)&&Date.parse(start)<Date.parse(b.booking_date+'T'+b.end_time+'+08:00'))
  if(conflicts.length) reasons.push('Another recorded reservation overlaps this physical facility.')
  return {status:booking.status,facilityName:facility?.name || 'Facility details unavailable',reasons,
    capacity:facility?.capacity ?? null,equipment:Array.isArray(facility?.equipment)?facility.equipment:null,
    warning:'Accessible records do not prove vacancy, approval or suitability. Verify in the Master Facility Calendar.'}
}

/** Build a local before/after explanation only. This does not apply or undo data.
 * SQL rechecks the full state and all related conflicts before any real commit. */
export function projectRecoveryPreview(before,changes) {
  const after=clone(before)
  for(const change of changes) {
    const segment=after.segments.find(s=>same(s.id,change.segmentId))
    if(!segment) throw new Error('Unknown activity in recovery preview.')
    if(change.starts_at!=null) segment.starts_at=iso(change.starts_at)
    if(change.ends_at!=null) segment.ends_at=iso(change.ends_at)
    if(simulatorTimestampMicros(segment.starts_at)>=simulatorTimestampMicros(segment.ends_at)) throw new Error('Invalid proposed activity period.')
    if(change.replacementMemberId!=null) {
      const assignment=after.assignments.find(a=>same(a.id,change.assignmentId)&&same(a.member_id,change.replacedMemberId))
      if(!assignment) throw new Error('Original assignment is missing or changed.')
      assignment.member_id=change.replacementMemberId
    }
    if(change.facilityBookingId!=null) {
      after.links=after.links.filter(l=>!same(l.segment_id,segment.id))
      after.links.push({segment_id:segment.id,booking_id:change.facilityBookingId})
    }
  }
  after.links.sort((a,b)=>order(a.segment_id,b.segment_id)||order(a.booking_id,b.booking_id))
  if(after.segments.length) {
    after.event.starts_at=[after.event.starts_at,...after.segments.map(s=>s.starts_at)]
      .reduce((a,b)=>simulatorTimestampMicros(a)<=simulatorTimestampMicros(b)?a:b)
    after.event.ends_at=[after.event.ends_at,...after.segments.map(s=>s.ends_at)]
      .reduce((a,b)=>simulatorTimestampMicros(a)>=simulatorTimestampMicros(b)?a:b)
  }
  return after
}

/** Explain local undo blockers. This only compares a snapshot and server history;
 * restored memberships, facilities and conflicts must still be checked by SQL. */
export function undoReadiness(plan,currentState) {
  if(plan?.application_status!=='Applied') return {ready:false,reason:'Only a successfully applied plan can be undone.'}
  if(!plan.after_state || !equal(plan.after_state,currentState)) return {ready:false,reason:'Undo blocked: this event was edited after recovery. No records were changed. Refresh and review the later edits; automatic Undo must not overwrite them.'}
  return {ready:true,reason:'Snapshot matches. Server must still verify original assignments, approved bookings, schedule and recorded unavailability before restoring anything.'}
}

/** Display expiry accurately. SQL separately checks the server clock. */
export function effectiveInvitationStatus(invitation,now=Date.now()) {
  if(!invitation) return 'Unavailable'
  if(['Pending','Accepted'].includes(invitation.status) &&
    (()=>{try{return simulatorTimestampMicros(invitation.expires_at)<=simulatorTimestampMicros(now)}catch{return true}})()) return 'Expired'
  return invitation.status
}

/** Exact terms include proposed timing. Material changes require renewed consent. */
export function invitationTerms(plan,replacedId) {
  const before=plan?.before_state
  if(!before) return []
  return (plan.changes || []).filter(c=>same(c.replacedMemberId,replacedId)).map(change=>{
    const assignment=before.assignments.find(a=>same(a.id,change.assignmentId))
    const segment=before.segments.find(s=>same(s.id,change.segmentId))
    if(!assignment || !segment) throw new Error('Invitation assignment snapshot is incomplete.')
    const timing=(plan.changes || []).filter(c=>same(c.segmentId,segment.id)).reduce((times,c)=>{
      if(c.starts_at!=null)times.starts_at=c.starts_at; if(c.ends_at!=null)times.ends_at=c.ends_at; return times
    },{})
    return {assignment_id:assignment.id,segment_id:segment.id,activity:segment.title,role_name:assignment.role_name,
      replaced_member_id:assignment.member_id,starts_at:iso(timing.starts_at ?? segment.starts_at),ends_at:iso(timing.ends_at ?? segment.ends_at)}
  }).sort((a,b)=>order(a.assignment_id,b.assignment_id))
}

/** Compare the shared facility inventory, without reserving anything. Capacity
 * uses recorded assignees as a MINIMUM only; attendance/equipment needs are not
 * recorded on verified segment fields and therefore require manual review. */
export function suggestSimulatorFacilities(data,segmentId,start,end) {
  return simulatorFacilityFacts(data,segmentId,start,end).sort((a,b)=>Number(a.blocked)-Number(b.blocked)||String(a.name).localeCompare(String(b.name)))
}

/** Resolution display is read from protected audit history. It is not authority
 * to Undo; SQL validates hashes, original records and the current revision. */
export function recordedDisruptionResolutions(plan,audit=[]) {
 return (plan?.disruptions || []).map((disruption,index)=>{
  const entry=[...audit].reverse().find(item=>{
   if(!same(item.plan_id,plan.id)||item.action!=='DISRUPTION_RESOLVED'||item.outcome!=='Succeeded')return false
   try{
    const proof=JSON.parse(item.details)
    return proof.disruption_index===index+1&&equal(proof.disruption,disruption)&&
      !!plan.after_fingerprint&&proof.applied_fingerprint===plan.after_fingerprint
   }catch{return false}
  })
  let reason=''
  if(entry){try{reason=JSON.parse(entry.details).reason || ''}catch{}}
  return {index:index+1,disruption,resolved:!!entry,reason,resolvedAt:entry?.created_at}
 }).filter(row=>['MEMBER_UNAVAILABLE','FACILITY_UNAVAILABLE'].includes(row.disruption.type))
}
