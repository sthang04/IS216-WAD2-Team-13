import {workflowReadiness,effectiveInvitationStatus,invitationTerms} from './simulatorWorkflowService.js'
const same=(a,b)=>a!=null&&b!=null&&String(a)===String(b)
const canonical=v=>Array.isArray(v)?v.map(canonical):v && typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v
function consentMatches(plan,invite,replaced){try{return JSON.stringify(canonical(invite.assignment_snapshot))===JSON.stringify(canonical(invitationTerms(plan,replaced)))}catch{return false}}
const latest=rows=>[...rows].sort((a,b)=>(Date.parse(b.created_at)||0)-(Date.parse(a.created_at)||0)||String(b.id).localeCompare(String(a.id)))[0]
/** Presentation only. Every readiness statement comes from saved requirements;
 * the existing RPC repeats permission, consent, booking and snapshot validation. */
export function buildRecoveryTracker({plan,invitations=[],audit=[],manualAcknowledged=false,enabled=false,data={},now=Date.now()}={}){
 if(!plan)return {status:'Draft',rows:[],satisfied:0,total:0,nextAction:'Select a proposal, compare its changes, then prepare recovery requests.'}
 const activity=id=>(data.event_segments || []).find(s=>same(s.id,id))?.title || 'Activity unavailable'
 const member=id=>(data.members || []).find(m=>same(m.id,id))?.full_name || 'Member unavailable'
 const planAudit=audit.filter(a=>same(a.plan_id,plan.id))
 const updated=latest(planAudit)?.created_at || plan.applied_at || plan.updated_at || plan.created_at || null
 const rows=[],keys=new Set()
 const add=row=>{if(!keys.has(row.key)){keys.add(row.key);rows.push(row)}}
 for(const c of plan.changes || []){
  if(c.replacementMemberId!=null){
   const matching=invitations.filter(i=>same(i.plan_id,plan.id)&&same(i.recipient_member_id,c.replacementMemberId)&&same(i.replaced_member_id,c.replacedMemberId))
   const invite=latest(matching),state=effectiveInvitationStatus(invite,now)
   const accepted=!!invite && state==='Accepted' && consentMatches(plan,invite,c.replacedMemberId)
   const status=!invite?'Invitation required':accepted?'Accepted - organizer confirmation required':state==='Accepted'?'Consent requires renewed review':state==='Pending'?'Awaiting response':state
   add({key:'member:'+c.segmentId+':'+c.replacedMemberId+':'+c.replacementMemberId,kind:'Member acceptance',activity:activity(c.segmentId),change:member(c.replacedMemberId)+' to '+member(c.replacementMemberId),status,satisfied:accepted,
    delivery:invite?(invite.delivery_status || 'Delivery unverified'):'Not requested',nextAction:!invite?'Create invitation below':accepted?'Review and confirm assignment':state==='Pending'?'Wait for the actual recipient to respond':'Review or create a new invitation',updated:invite?.responded_at || invite?.updated_at || invite?.created_at || updated})
  }
  if(c.venueName!=null || c.facilityBookingId!=null){
   const action=(plan.actions || []).find(a=>a.kind==='Room'&&same(a.segmentId,c.segmentId))
   const status=action?.status || 'Booking verification unavailable'
   add({key:'room:'+c.segmentId,kind:'Facility approval',activity:activity(c.segmentId),change:c.venueName || 'Selected facility',status,satisfied:status==='Approved',nextAction:status==='Approved'?'Review before Apply':!c.facilityBookingId?'Arrange booking in Facility Calendar, then associate it below':'Refresh approval status; resolve booking blockers',updated})
  }
  if(c.starts_at!=null || c.ends_at!=null)add({key:'time:'+c.segmentId,kind:'Schedule validation',activity:activity(c.segmentId),change:'Proposed activity timing',status:'Subject to final server validation',satisfied:true,nextAction:'Compare times before Apply',updated})
 }
 add({key:'review',kind:'Organizer verification',activity:'Entire recovery',change:'Availability, qualifications and venue suitability',status:manualAcknowledged?'Review acknowledged':'Organizer review required',satisfied:manualAcknowledged,nextAction:'Review evidence and acknowledge below',updated})
 const readiness=workflowReadiness({enabled:true,plan,invites:invitations,manualAcknowledged})
 let status=plan.application_status==='Applied'?'Applied':plan.application_status==='Undone'?'Undone':plan.application_status==='Cancelled'?'Cancelled':plan.application_status==='Draft' && plan.lifecycle!=='In Progress'?'Draft':
  (plan.blockers || []).length?'Stale or blocked':rows.some(r=>['Declined','Cancelled','Expired'].includes(r.status))?'Rejected or expired':
  readiness.ready && rows.every(r=>r.satisfied)?'Ready to apply':'Pending requirements'
 const nextAction=status==='Draft'?'Prepare recovery requests before tracking approvals.':status==='Applied'?'Review applied changes and original disruption resolution before Undo.':status==='Undone'?'Original schedule restored; review history.':status==='Cancelled'?'View history or prepare another proposal.':status==='Ready to apply'?(enabled?'Review and apply this saved recovery.':'Requirements are recorded; application is unavailable in this environment.'):
  status==='Stale or blocked'?'Review the reported changes; refresh and rerun the simulation.':'Complete outstanding requirements, then refresh their authoritative status.'
 return {status,rows,satisfied:rows.filter(r=>r.satisfied).length,total:rows.length,nextAction}
}
