import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
// Source-level safety regressions, NOT PostgreSQL execution or proof of live RLS.
const sql=readFileSync(new URL('../../supabase/migrations/202610310002_simulator_recovery_workflow.sql',import.meta.url),'utf8')
const body=name=>{
 const text=sql.split('CREATE FUNCTION '+name+'(')[1]
 assert.ok(text,'Function missing: '+name)
 return text.split('END $$;')[0]
}
test('recovery authorization derives unique active identity and independently checks organizer membership',()=>{
 const actor=body('simulator_private.actor'),club=body('simulator_private.event_club')
 for(const text of ['auth.uid() IS NULL','m.auth_user_id=auth.uid()','m.is_active','matches<>1'])assert.ok(actor.includes(text),text)
 for(const text of ['p_event IS NULL OR p_manage IS NULL','e.club_name=c.name OR e.club_name=c.short_name',
  'c.active=true','matches<>1','cm.member_id=actor','cm.club_id=club','cm.is_active=true',
  'r.is_admin_role=false','NOT p_manage OR r.can_manage_members=true'])assert.ok(club.includes(text),text)
 assert.doesNotMatch(club,/rpc_simulator_event_roster|p_demo_member_id|current_member_id/)
 assert.doesNotMatch(sql,/CREATE(?: OR REPLACE)? FUNCTION public.rpc_simulator_event_roster/)
})
test('all recovery management paths require organizer checks, including history and both transitions',()=>{
 for(const name of ['rpc_simulator_start_plan','rpc_simulator_cancel_plan','rpc_simulator_attach_booking',
  'rpc_simulator_save_plan','rpc_simulator_invite','rpc_simulator_cancel_invitation','rpc_simulator_plan_history'])
  assert.match(body('public.'+name),/simulator_private.event_club\([^;]*,true\)/,name)
 const transition=body('simulator_private.transition_plan')
 assert.match(transition,/simulator_private.event_club\(p.event_id,true\)/)
 assert.match(transition,/p_version IS NULL/)
 assert.match(transition,/p.version IS DISTINCT FROM p_version/)
})
test('private invitation responses reject NULL and require the actual recipient, not the organizer',()=>{
 const response=body('public.rpc_simulator_respond_invitation')
 assert.match(response,/i.recipient_member_id<>actor/)
 assert.match(response,/p_response IS NULL OR p_response NOT IN \('Accepted','Declined'\)/)
 assert.match(response,/p.application_status<>'Draft'/)
 assert.match(response,/i.assignment_snapshot IS DISTINCT FROM/)
 assert.match(response,/i.expires_at<=clock_timestamp\(\)/)
 const read=body('public.rpc_simulator_invitation')
 assert.match(read,/IF actor<>i.recipient_member_id THEN PERFORM simulator_private.event_club\(p.event_id,true\)/)
})
test('public notifications remain untouched despite confirmed action_url mapping and push trigger',()=>{
 const executable=sql.replace(/--[^\n]*/g,'')
 assert.doesNotMatch(executable,/\b(?:INSERT INTO|UPDATE|DELETE FROM|ALTER TABLE)\s+(?:public\.)?notifications\b/i)
 assert.doesNotMatch(executable,/notify_club_members\(|rpc_create_notification\(|pulse_mark_push_pending\(/)
 assert.match(sql,/public-read policy would leak private terms/)
 assert.match(sql,/delivery_status text NOT NULL DEFAULT 'Pending Delivery'/)
 for(const table of ['recovery_plans','replacement_invitations','recovery_audit','release_gate'])
  assert.ok(sql.includes('ALTER TABLE simulator_private.'+table+' ENABLE ROW LEVEL SECURITY;'))
 assert.match(sql,/REVOKE ALL ON ALL TABLES IN SCHEMA simulator_private FROM PUBLIC, anon, authenticated/)
 assert.match(sql,/REVOKE ALL ON ALL FUNCTIONS IN SCHEMA simulator_private FROM PUBLIC, anon, authenticated/)
 const grant=sql.split('GRANT EXECUTE ON FUNCTION')[1]
 assert.ok(grant);assert.match(grant.split(';')[0],/TO authenticated$/)
 assert.doesNotMatch(grant.split(';')[0],/TO (?:anon|PUBLIC)/)
})
test('unknown booking status, time or active flag cannot satisfy confirmation validation',()=>{
 const validate=body('simulator_private.validate_event')
 assert.match(validate,/s.starts_at IS NULL OR s.ends_at IS NULL/)
 assert.match(validate,/coalesce\(booking.status,''\) NOT IN/)
 assert.match(validate,/IS NOT TRUE\s*THEN RAISE EXCEPTION 'Facility booking does not cover activity times'/)
 assert.match(validate,/facility->>'is_active' IS DISTINCT FROM 'true'/)
 assert.match(validate,/other_segment.event_id<>p_event/)
 const progress=body('simulator_private.plan_progress')
 assert.match(progress,/coalesce\(b.status,''\) NOT IN/)
 assert.match(progress,/IS NOT TRUE THEN 'Booking does not cover activity'/)
})
test('Confirm retains locked stale-state, room ownership, exact association and conflict guards',()=>{
 const transition=body('simulator_private.transition_plan')
 for(const text of ['LOCK TABLE','FOR UPDATE','p.before_fingerprint','p.after_fingerprint',
  'booking.owner_club_id IS DISTINCT FROM club','An actual replacement booking is required',
  'f.name=v_change->>\'venueName\'','simulator_private.validate_event(p.event_id,club)',
  'Exact replacement invitation has not been accepted or has expired'])
  assert.ok(transition.includes(text),text)
 assert.match(sql,/application_enabled boolean NOT NULL DEFAULT false/)
 assert.match(sql,/invitations_enabled boolean NOT NULL DEFAULT false/)
})

test('loop variables cannot collide with SQL aliases and historical invitations do not reserve members forever',()=>{
 for(const name of ['public.rpc_simulator_save_plan','simulator_private.plan_progress','simulator_private.transition_plan']){
  const fn=body(name)
  assert.doesNotMatch(fn,/\bc jsonb|\bd jsonb/)
  assert.match(fn,/v_change jsonb/)
 }
 assert.match(body('public.rpc_simulator_invite'),/existing_plan.application_status='Draft'/)
})
