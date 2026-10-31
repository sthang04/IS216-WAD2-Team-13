import test from 'node:test'
import assert from 'node:assert/strict'
import {buildRecoveryTracker} from './simulatorRecoveryTracker.js'
import {captureSimulatorState,invitationTerms} from './simulatorWorkflowService.js'
import {campusConnectFixture} from '../../e2e-simulator/fixtures/campusConnect.js'
function fixture(){
 const data=campusConnectFixture(),plan={id:'test-plan',event_id:990001,version:1,application_status:'Draft',lifecycle:'In Progress',before_state:captureSimulatorState(data,990001),created_at:'2026-10-31T01:00:00Z',actions:[{kind:'Room',segmentId:1,status:'Pending Approval'}],changes:[{segmentId:1,assignmentId:1,replacedMemberId:1,replacementMemberId:2,roleName:'Performer'},{segmentId:1,venueName:'Fixture Original Room',facilityBookingId:1}]}
 const invitation={id:'invite',plan_id:plan.id,recipient_member_id:2,replaced_member_id:1,status:'Pending',created_at:'2026-10-31T02:00:00Z',expires_at:'2099-11-02T00:00:00Z',assignment_snapshot:invitationTerms(plan,1),delivery_status:'Pending Delivery'}
 return {data,plan,invitations:[invitation],manualAcknowledged:true,enabled:true}
}
test('pending requirements preserve delivery, acceptance and facility approval as separate evidence',()=>{
 const input=fixture(),before=structuredClone(input),tracker=buildRecoveryTracker(input)
 assert.equal(tracker.status,'Pending requirements')
 assert.equal(tracker.rows[0].status,'Awaiting response');assert.equal(tracker.rows[0].delivery,'Pending Delivery')
 assert.equal(tracker.rows[1].status,'Pending Approval');assert.equal(tracker.rows[1].satisfied,false)
 assert.equal(tracker.rows[0].updated,input.invitations[0].created_at)
 assert.deepEqual(input,before)
})
test('ready requires actual matching acceptance, approved room action and organizer review',()=>{
 const input=fixture();input.invitations[0].status='Accepted';input.plan.actions[0].status='Approved'
 assert.equal(buildRecoveryTracker(input).status,'Ready to apply')
 assert.equal(buildRecoveryTracker({...input,manualAcknowledged:false}).status,'Pending requirements')
 input.invitations[0].assignment_snapshot=[]
 assert.equal(buildRecoveryTracker(input).status,'Pending requirements')
 assert.equal(buildRecoveryTracker(input).rows[0].status,'Consent requires renewed review')
})
test('newer declined or expired consent cannot reuse an old acceptance',()=>{
 const input=fixture();input.plan.actions[0].status='Approved';input.invitations[0].status='Accepted'
 input.invitations.push({...input.invitations[0],id:'newer',created_at:'2026-10-31T03:00:00Z',status:'Declined'})
 assert.equal(buildRecoveryTracker(input).status,'Rejected or expired')
 input.invitations[1].status='Pending';input.invitations[1].expires_at='2020-01-01T00:00:00Z'
 assert.equal(buildRecoveryTracker(input).rows[0].status,'Expired')
})
test('missing authoritative requirements never imply approved; stale and terminal plans are distinct',()=>{
 const input=fixture();input.plan.actions=undefined
 assert.equal(buildRecoveryTracker(input).rows[1].status,'Booking verification unavailable')
 input.plan.blockers=['Source event records changed']
 assert.equal(buildRecoveryTracker(input).status,'Stale or blocked')
 for(const status of ['Applied','Undone','Cancelled']){input.plan.application_status=status;assert.equal(buildRecoveryTracker(input).status,status)}
 assert.equal(buildRecoveryTracker().status,'Draft')
})
test('readiness does not authorize a disabled environment, invent update times or borrow other plan consent',()=>{
 const input=fixture();input.plan.created_at=undefined;input.invitations=[]
 let row=buildRecoveryTracker(input).rows[0];assert.equal(row.updated,null);assert.equal(row.status,'Invitation required')
 input.invitations=[{id:'other',plan_id:'another-plan',status:'Accepted',recipient_member_id:2,replaced_member_id:1}]
 assert.equal(buildRecoveryTracker(input).rows[0].satisfied,false)
})


test('accepted invitation terms include schedule changes split into separate actions',()=>{
 const input=fixture();input.plan.changes.push({segmentId:1,starts_at:'2026-11-02T02:30:00Z',ends_at:'2026-11-02T03:00:00Z'})
 input.invitations[0].status='Accepted';input.invitations[0].assignment_snapshot=invitationTerms(input.plan,1);input.plan.actions[0].status='Approved'
 assert.equal(buildRecoveryTracker(input).status,'Ready to apply')
 input.plan.changes.at(-1).ends_at='2026-11-02T03:10:00Z'
 assert.equal(buildRecoveryTracker(input).rows[0].satisfied,false)
})
