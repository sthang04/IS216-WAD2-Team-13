import {createRequire} from 'node:module'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {invitationTerms,createSimulatorWorkflow} from '../../src/services/simulatorWorkflowService.js'
// Actual embedded PostgreSQL, isolated in memory. This minimal CONTRACT FIXTURE
// uses supplied columns/types; it is NOT the target's full DDL, RLS or triggers.
// No network, Supabase credentials, notification delivery or server sessions.
const require=createRequire(import.meta.url)
if(!process.env.PULSE_PGLITE_PATH)throw new Error('Set PULSE_PGLITE_PATH to the separately installed @electric-sql/pglite package; no database credentials are required.')
const {PGlite}=require(process.env.PULSE_PGLITE_PATH)
const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0')
const migration=readFileSync(new URL('../migrations/202610310002_simulator_recovery_workflow.sql',import.meta.url),'utf8')
const fixture=`
CREATE ROLE anon; CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $auth$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$auth$;
GRANT USAGE ON SCHEMA auth TO authenticated,anon;
CREATE TABLE public.clubs(id bigint PRIMARY KEY,name text UNIQUE,short_name text,active boolean);
CREATE TABLE public.members(id bigint PRIMARY KEY,full_name text,auth_user_id uuid,is_active boolean);
CREATE TABLE public.exco_roles(id bigint PRIMARY KEY,role_code text,can_manage_members boolean,is_admin_role boolean);
CREATE TABLE public.club_memberships(member_id bigint REFERENCES members,club_id bigint REFERENCES clubs,role_id bigint REFERENCES exco_roles,is_active boolean,academic_year text);
CREATE TABLE public.events(id bigint PRIMARY KEY,name text,club_name text,starts_at timestamptz,ends_at timestamptz);
CREATE TABLE public.event_segments(id bigint PRIMARY KEY,event_id bigint REFERENCES events,title text,segment_type text,starts_at timestamptz,ends_at timestamptz);
CREATE TABLE public.segment_assignments(id bigint PRIMARY KEY,segment_id bigint REFERENCES event_segments,member_id bigint REFERENCES members,role_name text,is_required boolean,UNIQUE(segment_id,member_id,role_name));
CREATE TABLE public.segment_dependencies(prerequisite_segment_id bigint REFERENCES event_segments,dependent_segment_id bigint REFERENCES event_segments);
CREATE TABLE public.facilities(id bigint PRIMARY KEY,name text,is_active boolean,capacity integer);
CREATE TABLE public.facility_bookings(id bigint PRIMARY KEY,facility_id bigint REFERENCES facilities,booking_date date,start_time time,end_time time,owner_club_id bigint REFERENCES clubs,status text);
CREATE TABLE public.segment_facility_bookings(segment_id bigint REFERENCES event_segments,booking_id bigint REFERENCES facility_bookings,PRIMARY KEY(segment_id,booking_id));
CREATE TABLE public.notifications(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,recipient_member_id bigint,title text,body text,action_url text);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixture_public_read ON public.notifications FOR SELECT USING(true);
GRANT SELECT ON public.notifications TO anon,authenticated;
CREATE FUNCTION public.pulse_mark_push_pending() RETURNS trigger LANGUAGE plpgsql AS $trigger$
 BEGIN RAISE EXCEPTION 'Notification insertion forbidden during simulator tests'; END
$trigger$;
CREATE TRIGGER fixture_no_notification BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.pulse_mark_push_pending();
CREATE FUNCTION public.rpc_simulator_event_roster(bigint) RETURNS jsonb LANGUAGE sql AS $roster$ SELECT '{"existing":"untouched"}'::jsonb $roster$;
INSERT INTO clubs VALUES(1,'Club One','ONE',true),(2,'Club Two','TWO',true);
INSERT INTO exco_roles VALUES(1,'MANAGER',true,false),(2,'MEMBER',false,false),(3,'ADMIN',true,true);
INSERT INTO members SELECT n,'Fixture member '||n,('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,true FROM generate_series(1,7) n;
INSERT INTO club_memberships SELECT n,CASE WHEN n=4 THEN 2 ELSE 1 END,CASE WHEN n IN(1,4) THEN 1 WHEN n=5 THEN 3 ELSE 2 END,true,'2026/27' FROM generate_series(1,7) n;
INSERT INTO events VALUES(1,'Fixture Event','Club One','2026-11-02T10:00:00.123456Z','2026-11-02T11:00:00.654321Z'),(2,'Other Event','Club Two','2026-11-02T12:00:00Z','2026-11-02T13:00:00Z');
INSERT INTO event_segments VALUES(1,1,'Fixture Activity','Performance','2026-11-02T10:00:00.123456Z','2026-11-02T11:00:00.654321Z'),(2,2,'Other Activity','Performance','2026-11-02T12:00:00Z','2026-11-02T13:00:00Z');
INSERT INTO segment_assignments VALUES(1,1,3,'Performer',true);
INSERT INTO facilities VALUES(1,'Original Room',true,50),(2,'Replacement Room',true,50),(3,'Other Room',true,50);
INSERT INTO facility_bookings VALUES(1,1,'2026-11-02','17:00','22:00',1,'Booked'),(2,2,'2026-11-02','17:00','22:00',1,'Pending Admin Sign-off'),(3,3,'2026-11-02','17:00','22:00',2,'Booked');
INSERT INTO segment_facility_bookings VALUES(1,1);
`
test('isolated PostgreSQL contract-fixture validation (not live Supabase or concurrent server sessions)',async t=>{
 const db=new PGlite()
 const q=async(sql,args=[])=>db.query(sql,args)
 const scalar=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0])[0]
 const user=async(n,sql,args=[])=>{
  await db.exec('RESET ROLE')
  await q("SELECT set_config('request.jwt.claim.sub',$1,false)",[n?uid(n):''])
  await db.exec('SET ROLE '+(n?'authenticated':'anon'))
  try{return await scalar(sql,args)}finally{await db.exec('RESET ROLE')}
 }
 const member={segmentId:1,assignmentId:1,replacedMemberId:3,replacementMemberId:2,roleName:'Performer'}
 const delay={segmentId:1,starts_at:'2026-11-02T10:30:00.123456Z',ends_at:'2026-11-02T11:30:00.654321Z'}
 const disruptions=[{type:'MEMBER_UNAVAILABLE',memberId:3,start:'2026-11-02T10:00:00Z',end:'2026-11-02T14:00:00Z'},{type:'SCHEDULE_DELAY',segmentId:1,delayMinutes:30}]
 let request=0
 const start=async(changes=[member,delay],ds=disruptions)=>{
  const capture=await user(1,'SELECT public.rpc_simulator_capture_state(1)')
  const args=[1,'SQL fixture plan',JSON.stringify(changes),JSON.stringify(capture.state),capture.fingerprint,JSON.stringify(ds),uid(100+ ++request)]
  const plan=await user(1,'SELECT public.rpc_simulator_start_plan($1,$2,$3::jsonb,$4::jsonb,$5,$6::jsonb,$7::uuid)',args)
  return {plan,args,capture}
 }
 const confirm=p=>user(1,'SELECT public.rpc_simulator_apply_plan($1,$2,true)',[p.id,p.version])
 const undo=p=>user(1,'SELECT public.rpc_simulator_undo_plan($1,$2,true)',[p.id,p.version])
 const invite=p=>scalar('SELECT to_jsonb(i) FROM simulator_private.replacement_invitations i WHERE plan_id=$1',[p.id])
 const accept=async p=>{const i=await invite(p);return user(2,"SELECT public.rpc_simulator_respond_invitation($1,'Accepted')",[i.id])}
 try{
  await db.exec(fixture)
  console.log('Embedded engine: '+await scalar('SELECT version()'))
  await t.test('complete migration compiles and preserves roster RPC and disabled gates',async()=>{
   await db.exec(migration)
   await db.exec(readFileSync(new URL('../migrations/202610310003_simulator_original_booking_links.sql',import.meta.url),'utf8'))
   assert.deepEqual(await scalar('SELECT public.rpc_simulator_event_roster(1)'),{existing:'untouched'})
   assert.equal(await scalar('SELECT application_enabled OR invitations_enabled FROM simulator_private.release_gate'),false)
   await assert.rejects(user(1,'SELECT public.rpc_simulator_apply_plan($1,1,true)',[uid(99)]),/not released/)
  })
  // Test-only toggles in THIS ephemeral database; migration and UI remain OFF.
  await db.exec('UPDATE simulator_private.release_gate SET application_enabled=true,invitations_enabled=true')
  await t.test('anonymous, cross-club, admin-only and ordinary members cannot manage recovery',async()=>{
   for(const n of [null,2,4,5])await assert.rejects(user(n,'SELECT public.rpc_simulator_capture_state(1)'),/permission denied|Authentication|not authorised|permission required/i)
  })
  let first
  await t.test('Start persists pending actions without changing originals; duplicate UUID returns same plan',async()=>{
   first=await start()
   assert.equal(first.plan.lifecycle,'In Progress')
   assert.equal(await scalar('SELECT member_id FROM segment_assignments WHERE id=1'),3)
   assert.equal(await scalar('SELECT simulator_private.iso(starts_at) FROM event_segments WHERE id=1'),'2026-11-02T10:00:00.123456Z')
   const duplicate=await user(1,'SELECT public.rpc_simulator_start_plan($1,$2,$3::jsonb,$4::jsonb,$5,$6::jsonb,$7::uuid)',first.args)
   assert.equal(duplicate.id,first.plan.id)
   assert.equal(await scalar('SELECT count(*)::integer FROM simulator_private.replacement_invitations WHERE plan_id=$1',[first.plan.id]),1)
   const i=await invite(first.plan);assert.equal(i.delivery_status,'Pending Delivery')
   assert.deepEqual(i.assignment_snapshot,invitationTerms(first.plan,3))
   assert.equal(i.assignment_snapshot[0].starts_at,delay.starts_at)
   assert.equal(await scalar('SELECT count(*)::integer FROM public.notifications'),0)
  })
  await t.test('pending consent blocks Confirm and non-recipient cannot accept or view private terms',async()=>{
   const result=await confirm(first.plan);assert.equal(result.ok,false);assert.match(result.error,/not been accepted/)
   const i=await invite(first.plan)
   await assert.rejects(user(1,"SELECT public.rpc_simulator_respond_invitation($1,'Accepted')",[i.id]),/Only the invited/)
   await assert.rejects(user(6,'SELECT public.rpc_simulator_invitation($1)',[i.id]),/permission required/)
   await accept(first.plan)
  })
  await t.test('combined Confirm changes real fixture records once and Undo restores exact microseconds',async()=>{
   const applied=await confirm(first.plan);assert.equal(applied.application_status,'Applied',applied.error)
   assert.equal(await scalar('SELECT member_id FROM segment_assignments WHERE id=1'),2)
   assert.equal(await scalar('SELECT simulator_private.iso(starts_at) FROM event_segments WHERE id=1'),delay.starts_at)
   assert.equal((await confirm(applied)).version,applied.version)
   const reverted=await undo(applied);assert.equal(reverted.application_status,'Undone',reverted.error)
   assert.equal(await scalar('SELECT member_id FROM segment_assignments WHERE id=1'),3)
   assert.deepEqual(await scalar('SELECT simulator_private.event_state(1)'),first.capture.state)
   assert.equal((await undo(reverted)).version,reverted.version)
  })
  await t.test('decline blocks Confirm; Cancel preserves original records and audit',async()=>{
   const {plan}=await start();const i=await invite(plan)
   await user(2,"SELECT public.rpc_simulator_respond_invitation($1,'Declined')",[i.id])
   assert.equal((await confirm(plan)).ok,false)
   const cancelled=await user(1,'SELECT public.rpc_simulator_cancel_plan($1,$2)',[plan.id,plan.version])
   assert.equal(cancelled.application_status,'Cancelled')
   assert.equal(await scalar('SELECT member_id FROM segment_assignments WHERE id=1'),3)
   assert.ok(await scalar('SELECT count(*)>0 FROM simulator_private.recovery_audit WHERE plan_id=$1',[plan.id]))
  })
  await t.test('expired consent and NULL revisions cannot bypass checks',async()=>{
   const {plan}=await start();await accept(plan)
   await q("UPDATE simulator_private.replacement_invitations SET expires_at=clock_timestamp()-interval '1 microsecond' WHERE plan_id=$1",[plan.id])
   assert.equal((await confirm(plan)).ok,false)
   await assert.rejects(user(1,'SELECT public.rpc_simulator_apply_plan($1,NULL,true)',[plan.id]),/positive plan revision/)
   await user(1,'SELECT public.rpc_simulator_cancel_plan($1,$2)',[plan.id,plan.version])
  })
  await t.test('late cross-event assignment conflict rolls back all event mutations and records blocked audit',async()=>{
   const {plan}=await start();await accept(plan)
   await db.exec("UPDATE event_segments SET starts_at='2026-11-02T10:45:00Z',ends_at='2026-11-02T11:45:00Z' WHERE id=2; INSERT INTO segment_assignments VALUES(2,2,2,'Performer',true)")
   const result=await confirm(plan);assert.equal(result.ok,false);assert.match(result.error,/overlapping event assignment/)
   assert.deepEqual(await scalar('SELECT simulator_private.event_state(1)'),plan.before_state)
   assert.ok(await scalar("SELECT count(*)>0 FROM simulator_private.recovery_audit WHERE plan_id=$1 AND outcome='Blocked'",[plan.id]))
   await db.exec("DELETE FROM segment_assignments WHERE id=2; UPDATE event_segments SET starts_at='2026-11-02T12:00:00Z',ends_at='2026-11-02T13:00:00Z' WHERE id=2")
   await user(1,'SELECT public.rpc_simulator_cancel_plan($1,$2)',[plan.id,plan.version])
  })
  await t.test('schedule-only plan requires no invitation; later edits block Undo without overwrite',async()=>{
   const {plan}=await start([delay],[{type:'SCHEDULE_DELAY',segmentId:1,delayMinutes:30}])
   const applied=await confirm(plan);assert.equal(applied.application_status,'Applied',applied.error)
   await db.exec("UPDATE event_segments SET title='Later team edit' WHERE id=1")
   const result=await undo(applied);assert.equal(result.ok,false);assert.match(result.error,/records changed/)
   assert.equal(await scalar('SELECT title FROM event_segments WHERE id=1'),'Later team edit')
   await db.exec("UPDATE event_segments SET title='Fixture Activity' WHERE id=1")
   assert.equal((await undo(applied)).application_status,'Undone')
  })
  await t.test('pending approval blocks room recovery; approved booking allows confirmation and safe Undo',async()=>{
   const {plan}=await start([{segmentId:1,venueName:'Replacement Room',facilityBookingId:2}],[{type:'FACILITY_UNAVAILABLE',venueName:'Original Room',start:'2026-11-02T10:00:00Z',end:'2026-11-02T12:00:00Z'}])
   assert.equal((await confirm(plan)).ok,false)
   await db.exec("UPDATE facility_bookings SET status='Officially Confirmed Booking' WHERE id=2")
   const applied=await confirm(plan);assert.equal(applied.application_status,'Applied',applied.error)
   assert.equal(await scalar('SELECT booking_id FROM segment_facility_bookings WHERE segment_id=1'),2)
   assert.equal((await undo(applied)).application_status,'Undone')
   assert.equal(await scalar('SELECT booking_id FROM segment_facility_bookings WHERE segment_id=1'),1)
  })

  await t.test('all four mutation entrypoints reject ordinary and unrelated-club callers',async()=>{
   for(const n of [null,2,4,5]){
    await assert.rejects(user(n,'SELECT public.rpc_simulator_start_plan($1,$2,$3::jsonb,$4::jsonb,$5,$6::jsonb,$7::uuid)',first.args),/permission denied|Authentication|permission required|not authorised/i)
    for(const sql of ['SELECT public.rpc_simulator_apply_plan($1,$2,true)','SELECT public.rpc_simulator_undo_plan($1,$2,true)','SELECT public.rpc_simulator_cancel_plan($1,$2)'])
     await assert.rejects(user(n,sql,[first.plan.id,1]),/permission denied|Authentication|permission required|not authorised/i)
   }
  })
  await t.test('stale non-NULL revision is rejected without changing event state',async()=>{
   const {plan}=await start([delay],[{type:'SCHEDULE_DELAY',segmentId:1,delayMinutes:30}])
   const before=await scalar('SELECT simulator_private.event_state(1)')
   const result=await confirm({...plan,version:plan.version+1})
   assert.equal(result.ok,false);assert.match(result.error,/revision changed/)
   assert.deepEqual(await scalar('SELECT simulator_private.event_state(1)'),before)
   await user(1,'SELECT public.rpc_simulator_cancel_plan($1,$2)',[plan.id,plan.version])
  })
  await t.test('wall-clock expiry advances within an open transaction, not just transaction-start now()',async()=>{
   const {plan}=await start();const i=await invite(plan)
   await db.exec('BEGIN')
   try{
    await q("UPDATE simulator_private.replacement_invitations SET expires_at=clock_timestamp()+interval '20 milliseconds' WHERE id=$1",[i.id])
    await q("SELECT set_config('request.jwt.claim.sub',$1,true)",[uid(2)])
    await db.exec("SET LOCAL ROLE authenticated; SELECT pg_sleep(0.04)")
    await assert.rejects(scalar("SELECT public.rpc_simulator_respond_invitation($1,'Accepted')",[i.id]),/Invitation expired/)
   }finally{await db.exec('ROLLBACK')}
   assert.equal((await invite(plan)).status,'Pending')
   await user(1,'SELECT public.rpc_simulator_cancel_plan($1,$2)',[plan.id,plan.version])
  })
  await t.test('wrong room and another event allocation cannot be attached to a recovery plan',async()=>{
   const {plan}=await start([{segmentId:1,venueName:'Replacement Room'}],[{type:'FACILITY_UNAVAILABLE',venueName:'Original Room',start:'2026-11-02T10:00:00Z',end:'2026-11-02T12:00:00Z'}])
   await assert.rejects(user(1,'SELECT public.rpc_simulator_attach_booking($1,$2,1,3)',[plan.id,plan.version]),/match the proposed room/)
   await db.exec('INSERT INTO segment_facility_bookings VALUES(2,2)')
   await assert.rejects(user(1,'SELECT public.rpc_simulator_attach_booking($1,$2,1,2)',[plan.id,plan.version]),/another event/)
   await db.exec('DELETE FROM segment_facility_bookings WHERE segment_id=2')
   await user(1,'SELECT public.rpc_simulator_cancel_plan($1,$2)',[plan.id,plan.version])
  })


  await t.test('a one-microsecond source edit is stale and one-microsecond consent change is not equivalent',async()=>{
   const pending=await start();await accept(pending.plan)
   await q("UPDATE simulator_private.recovery_plans SET changes=jsonb_set(changes,'{1,starts_at}',to_jsonb('2026-11-02T10:30:00.123457Z'::text)) WHERE id=$1",[pending.plan.id])
   assert.match((await confirm(pending.plan)).error,/not been accepted/)
   assert.equal(await scalar('SELECT member_id FROM segment_assignments WHERE id=1'),3)
   await user(1,'SELECT public.rpc_simulator_cancel_plan($1,$2)',[pending.plan.id,pending.plan.version])
   const {plan}=await start([delay],[{type:'SCHEDULE_DELAY',segmentId:1,delayMinutes:30}])
   await db.exec("UPDATE event_segments SET starts_at=starts_at+interval '1 microsecond' WHERE id=1")
   assert.match((await confirm(plan)).error,/records changed/)
   await db.exec("UPDATE event_segments SET starts_at=starts_at-interval '1 microsecond' WHERE id=1")
   await user(1,'SELECT public.rpc_simulator_cancel_plan($1,$2)',[plan.id,plan.version])
  })

  await t.test('private tables and helper functions deny direct authenticated access',async()=>{
   await assert.rejects(user(2,'SELECT count(*) FROM simulator_private.replacement_invitations'),/permission denied/)
   await assert.rejects(user(2,'SELECT simulator_private.actor()'),/permission denied/)
  })

  await t.test('installed fixture function ownership, fixed search_path and effective ACLs match the migration',async()=>{
   const functions=(await q(`SELECT n.nspname,p.proname,pg_get_userbyid(p.proowner) AS owner,
    p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
    has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
    EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
      WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE') AS public_execute,
    current_user AS installer
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='simulator_private' OR (n.nspname='public'
      AND p.proname LIKE 'rpc_simulator_%' AND p.proname<>'rpc_simulator_event_roster')`)).rows
   assert.equal(functions.length,27)
   for(const fn of functions){
    assert.equal(fn.owner,fn.installer,fn.proname)
    assert.ok(fn.proconfig.includes('search_path=pg_catalog'),fn.proname)
    assert.equal(fn.anon_execute,false,fn.proname)
    assert.equal(fn.public_execute,false,fn.proname)
    assert.equal(fn.authenticated_execute,fn.nspname==='public',fn.proname)
    if(fn.nspname==='public')assert.equal(fn.prosecdef,true,fn.proname)
   }
   for(const role of ['anon','authenticated']){
    assert.equal(await scalar("SELECT has_schema_privilege($1,'simulator_private','USAGE')",[role]),false)
    assert.equal(await scalar("SELECT has_table_privilege($1,'simulator_private.recovery_audit','DELETE')",[role]),false)
   }
   console.log('Verified installed fixture ACLs/search_path/owners for '+functions.length+' functions; not target-project ownership.')
  })
  await t.test('historical foreign keys are immediate NO ACTION and failed deletes preserve audit history',async()=>{
   const keys=(await q(`SELECT k.conname,k.confdeltype,k.condeferrable,k.condeferred
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='simulator_private' AND k.contype='f'`)).rows
   assert.ok(keys.length>=9)
   for(const key of keys){
    assert.equal(key.confdeltype,'a',key.conname)
    assert.equal(key.condeferrable,false,key.conname)
    assert.equal(key.condeferred,false,key.conname)
   }
   const counts=()=>scalar(`SELECT jsonb_build_object(
    'plans',(SELECT count(*) FROM simulator_private.recovery_plans),
    'invitations',(SELECT count(*) FROM simulator_private.replacement_invitations),
    'audit',(SELECT count(*) FROM simulator_private.recovery_audit))`)
   const before=await counts()
   await assert.rejects(q('DELETE FROM public.events WHERE id=1'),/foreign key constraint/)
   await assert.rejects(q('DELETE FROM public.members WHERE id=2'),/foreign key constraint/)
   await assert.rejects(q('DELETE FROM simulator_private.recovery_plans WHERE id=$1',[first.plan.id]),/foreign key constraint/)
   assert.deepEqual(await counts(),before)
   console.log('Verified '+keys.length+' simulator history FKs use NO ACTION; rejected deletes preserved fixture history.')
  })

  await t.test('real frontend adapter integrates Start, recipient consent, Confirm, Undo and Cancel with embedded SQL',async()=>{
   // This uses actual SQL and authenticated database roles with fixture auth.uid,
   // not HTTP/Supabase authentication and not independent server sessions.
   let identity=1
   const contracts={
    rpc_simulator_capture_state:[['p_event_id','bigint']],
    rpc_simulator_start_plan:[['p_event_id','bigint'],['p_title','text'],['p_changes','jsonb'],['p_expected_state','jsonb'],['p_expected_fingerprint','text'],['p_disruptions','jsonb'],['p_request_id','uuid']],
    rpc_simulator_plan_history:[['p_event_id','bigint']],
    rpc_simulator_respond_invitation:[['p_invitation_id','uuid'],['p_response','text']],
    rpc_simulator_apply_plan:[['p_plan_id','uuid'],['p_expected_version','integer'],['p_accept_unverified','boolean']],
    rpc_simulator_undo_plan:[['p_plan_id','uuid'],['p_expected_version','integer'],['p_accept_unverified','boolean']],
    rpc_simulator_cancel_plan:[['p_plan_id','uuid'],['p_expected_version','integer']]
   }
   const api=createSimulatorWorkflow({rpc:async(name,args)=>{
    const signature=contracts[name]
    assert.ok(signature,'Unknown test-only RPC '+name)
    const values=signature.map(([key,type])=>type==='jsonb'?JSON.stringify(args[key]):args[key])
    const placeholders=signature.map(([,type],index)=>'$'+(index+1)+'::'+type).join(',')
    try{return {data:await user(identity,'SELECT public.'+name+'('+placeholders+')',values)}}
    catch(error){return {error:{message:error.message}}}
   }},{enabled:true})
   const before=await api.captureState(1)
   const original=before.state.assignments.find(a=>a.segment_id===1)
   const changes=[{...member,replacedMemberId:original.member_id,roleName:original.role_name}]
   const draft={eventId:1,title:'Real adapter / isolated SQL',changes,disruptions:[{...disruptions[0],memberId:original.member_id}],
    expectedState:before.state,requestId:uid(9000)}
   const plan=await api.start(draft,true)
   assert.deepEqual((await api.captureState(1)).state,before.state)
   const history=await api.history(1),invitation=history.invitations.find(i=>i.plan_id===plan.id)
   assert.ok(invitation)
   identity=2
   assert.equal((await api.respond(invitation.id,'Accepted',true)).status,'Accepted')
   identity=1
   const applied=await api.confirm(plan,true,true)
   assert.equal(applied.application_status,'Applied')
   assert.equal((await api.captureState(1)).state.assignments.find(a=>a.id===original.id).member_id,2)
   const undone=await api.undo(applied,true,true)
   assert.equal(undone.application_status,'Undone')
   assert.deepEqual((await api.captureState(1)).state,before.state)
   const pending=await api.start({...draft,title:'Cancel integration',requestId:uid(9001)},true)
   assert.equal((await api.cancelPlan(pending,true)).application_status,'Cancelled')
   assert.deepEqual((await api.captureState(1)).state,before.state)
   identity=4
   await assert.rejects(api.history(1),/permission|authorised/)
   identity=1
   assert.equal(await scalar('SELECT count(*)::integer FROM notifications'),0)
  })
  await t.test('original-booking contracts enforce ownership, approval, coverage and a separate disabled gate',async()=>{
   const result=await user(1,'SELECT public.rpc_simulator_original_booking_candidates(1,1)')
   assert.equal(result.bookings.find(b=>b.booking_id===1).eligible,false)
   assert.match(result.bookings.find(b=>b.booking_id===1).reasons.join('; '),/Booked alone/)
   assert.ok(result.bookings.every(b=>b.owner_club_id===1))
   const booking=result.bookings.find(b=>b.booking_id===1)
   await assert.rejects(user(1,'SELECT public.rpc_simulator_link_original_booking(1,1,1,$1,$2,true)',[result.event_fingerprint,booking.booking_fingerprint]),/not deployed and verified/)
   await assert.rejects(user(2,'SELECT public.rpc_simulator_original_booking_candidates(1,1)'),/permission required/)
   await assert.rejects(user(4,'SELECT public.rpc_simulator_original_booking_candidates(1,1)'),/permission required/)
   await assert.rejects(user(1,'SELECT public.rpc_simulator_original_booking_candidates(1,2)'),/does not belong/)
  })
  await t.test('original association rejects missing and malformed fingerprint evidence before linking',async()=>{
   await db.exec('UPDATE simulator_private.release_gate SET original_booking_linking_enabled=true')
   for(const args of [[null,'a'.repeat(64)],['a'.repeat(64),null],['','a'.repeat(64)],['a'.repeat(64),'bad'],['A'.repeat(64),'a'.repeat(64)]])
    await assert.rejects(user(1,'SELECT public.rpc_simulator_link_original_booking(1,1,2,$1,$2,true)',args),/Refresh the booking evidence/)
   assert.equal(await scalar('SELECT count(*)::integer FROM simulator_private.original_booking_link_audit'),0)
  })
  await t.test('original association persists only a legitimate link, rejects stale evidence and retries without duplicate audit',async()=>{
   await db.exec('UPDATE simulator_private.release_gate SET original_booking_linking_enabled=true')
   await db.exec('DELETE FROM public.segment_facility_bookings WHERE segment_id=1')
   let result=await user(1,'SELECT public.rpc_simulator_original_booking_candidates(1,1)')
   const booking=result.bookings.find(b=>b.booking_id===2)
   assert.equal(booking.eligible,true)
   await db.exec("UPDATE event_segments SET title='Changed after discovery' WHERE id=1")
   await assert.rejects(user(1,'SELECT public.rpc_simulator_link_original_booking(1,1,2,$1,$2,true)',[result.event_fingerprint,booking.booking_fingerprint]),/(Event|Booking).*changed/)
   assert.equal(await scalar('SELECT count(*)::integer FROM segment_facility_bookings WHERE segment_id=1'),0)
   await db.exec("UPDATE event_segments SET title='Fixture Activity' WHERE id=1")
   const countBefore=await scalar('SELECT count(*)::integer FROM simulator_private.recovery_plans')
   const args=[result.event_fingerprint,booking.booking_fingerprint]
   const linked=await user(1,'SELECT public.rpc_simulator_link_original_booking(1,1,2,$1,$2,true)',args)
   assert.equal(linked.linked,true)
   assert.equal(await scalar('SELECT booking_id FROM segment_facility_bookings WHERE segment_id=1'),2)
   assert.equal((await user(1,'SELECT public.rpc_simulator_link_original_booking(1,1,2,$1,$2,true)',args)).already_linked,true)
   assert.equal(await scalar('SELECT count(*)::integer FROM simulator_private.original_booking_link_audit'),1)
   const originalRole=await scalar('SELECT role_name FROM segment_assignments WHERE id=1')
   await db.exec("UPDATE segment_assignments SET role_name='Edited after original link' WHERE id=1")
   await assert.rejects(user(1,'SELECT public.rpc_simulator_link_original_booking(1,1,2,$1,$2,true)',args),/Event changed/)
   await db.query('UPDATE segment_assignments SET role_name=$1 WHERE id=1',[originalRole])
   assert.equal((await user(1,'SELECT public.rpc_simulator_link_original_booking(1,1,2,$1,$2,true)',args)).already_linked,true)
   assert.equal(await scalar('SELECT count(*)::integer FROM simulator_private.recovery_plans'),countBefore)
   await db.exec('DELETE FROM segment_facility_bookings WHERE segment_id=1; INSERT INTO segment_facility_bookings VALUES(1,1)')
  })
  await t.test('recipient inbox returns only the signed-in member invitations and no auth/contact fields',async()=>{
   const mine=await user(2,'SELECT public.rpc_simulator_my_invitations()')
   assert.ok(mine.invitations.length>0)
   assert.equal((await user(6,'SELECT public.rpc_simulator_my_invitations()')).invitations.length,0)
   assert.doesNotMatch(JSON.stringify(mine),/auth_user_id|student_email|telegram_handle|before_state|after_state/)
   await assert.rejects(user(null,'SELECT public.rpc_simulator_my_invitations()'),/permission denied/)
   assert.equal(await scalar('SELECT count(*)::integer FROM notifications'),0)
  })


  await t.test('original association rejects independently invalid owner, approval, coverage, capacity, active status and allocations',async()=>{
   for(const [setup,reason] of [
    ["UPDATE facility_bookings SET owner_club_id=2 WHERE id=2",/another club/],
    ["UPDATE facility_bookings SET status='Pending Admin Sign-off' WHERE id=2",/final approval/],
    ["UPDATE facility_bookings SET end_time='18:15' WHERE id=2",/complete activity/],
    ["UPDATE facilities SET capacity=0 WHERE id=2",/capacity is below/],
    ["UPDATE facilities SET is_active=false WHERE id=2",/missing or inactive/],
    ["INSERT INTO segment_facility_bookings VALUES(2,2)",/another event/]
   ]){
    await db.exec("DELETE FROM segment_facility_bookings WHERE segment_id=1 OR (segment_id=2 AND booking_id=2); UPDATE facility_bookings SET owner_club_id=1,status='Officially Confirmed Booking',start_time='17:00',end_time='22:00' WHERE id=2; UPDATE facilities SET capacity=50,is_active=true WHERE id=2")
    try{
     await db.exec(setup)
     const evidence=await scalar('SELECT simulator_private.original_booking_evidence(1,2,1)')
     assert.equal(evidence.eligible,false);assert.match(evidence.reasons.join('; '),reason)
     const capture=await user(1,'SELECT public.rpc_simulator_capture_state(1)')
     await assert.rejects(user(1,'SELECT public.rpc_simulator_link_original_booking(1,1,2,$1,$2,true)',[capture.fingerprint,evidence.booking_fingerprint]),/Booking is ineligible/)
     assert.equal(await scalar('SELECT count(*)::integer FROM segment_facility_bookings WHERE segment_id=1'),0)
    }finally{
     await db.exec("DELETE FROM segment_facility_bookings WHERE segment_id=2 AND booking_id=2; UPDATE facility_bookings SET owner_club_id=1,status='Officially Confirmed Booking',start_time='17:00',end_time='22:00' WHERE id=2; UPDATE facilities SET capacity=50,is_active=true WHERE id=2")
    }
   }
   await db.exec('INSERT INTO segment_facility_bookings VALUES(1,1)')
  })


  await t.test('unknown audience and capacity remain manual rather than staff-count certification',async()=>{
   await db.exec('ALTER TABLE public.events ADD COLUMN fixture_audience integer; ALTER TABLE public.event_segments ADD COLUMN fixture_audience integer; ALTER TABLE public.facility_bookings ADD COLUMN fixture_approval text')
   let evidence=await scalar('SELECT simulator_private.original_booking_evidence(1,2,1)')
   assert.equal(evidence.audience_requirement,null)
   assert.equal(evidence.minimum_capacity,1)
   assert.equal(evidence.capacity_verified,false)
   assert.equal(evidence.manual_suitability_required,true)
   assert.ok(evidence.verification_required.some(r=>/Audience requirement is unknown/.test(r)))
   await db.exec('UPDATE facilities SET capacity=NULL WHERE id=2')
   evidence=await scalar('SELECT simulator_private.original_booking_evidence(1,2,1)')
   assert.equal(evidence.capacity_verified,false)
   assert.ok(evidence.verification_required.some(r=>/capacity is unknown/.test(r)))
   await db.exec('UPDATE facilities SET capacity=50 WHERE id=2')
  })
  await t.test('reviewed activity/event audience bindings enforce total capacity with explicit staff semantics',async()=>{
   await db.exec("UPDATE simulator_private.original_booking_review_policy SET activity_audience_column='fixture_audience',event_audience_column='fixture_audience'; UPDATE events SET fixture_audience=100 WHERE id=1; UPDATE event_segments SET fixture_audience=60 WHERE id=1")
   let evidence=await scalar('SELECT simulator_private.original_booking_evidence(1,2,1)')
   assert.equal(evidence.required_capacity,61)
   assert.equal(evidence.capacity_verified,false)
   assert.ok(evidence.reasons.some(r=>/verified total attendance/.test(r)))
   await db.exec('UPDATE event_segments SET fixture_audience=20 WHERE id=1')
   evidence=await scalar('SELECT simulator_private.original_booking_evidence(1,2,1)')
   assert.equal(evidence.required_capacity,21);assert.equal(evidence.capacity_verified,true)
   await db.exec('UPDATE simulator_private.original_booking_review_policy SET audience_includes_staff=true')
   assert.equal((await scalar('SELECT simulator_private.original_booking_evidence(1,2,1)')).required_capacity,20)
   await db.exec('UPDATE event_segments SET fixture_audience=NULL WHERE id=1; UPDATE simulator_private.original_booking_review_policy SET audience_includes_staff=false')
   evidence=await scalar('SELECT simulator_private.original_booking_evidence(1,2,1)')
   assert.equal(evidence.required_capacity,101);assert.equal(evidence.audience_source,'event.fixture_audience')
   await db.exec('UPDATE simulator_private.original_booking_review_policy SET activity_audience_column=NULL,event_audience_column=NULL; UPDATE events SET fixture_audience=NULL WHERE id=1')
  })
  await t.test('Booked requires reviewed per-record approval evidence; other statuses cannot reuse the marker',async()=>{
   await db.exec("UPDATE facility_bookings SET status='Booked' WHERE id=2")
   assert.equal((await scalar('SELECT simulator_private.original_booking_evidence(1,2,1)')).approval_verified,false)
   await db.exec("UPDATE simulator_private.original_booking_review_policy SET booked_approval_column='fixture_approval',booked_approval_value='APPROVED'; UPDATE facility_bookings SET fixture_approval='PENDING' WHERE id=2")
   assert.equal((await scalar('SELECT simulator_private.original_booking_evidence(1,2,1)')).approval_verified,false)
   await db.exec("UPDATE facility_bookings SET fixture_approval='APPROVED' WHERE id=2")
   assert.equal((await scalar('SELECT simulator_private.original_booking_evidence(1,2,1)')).approval_verified,true)
   await db.exec("UPDATE facility_bookings SET status='Pending Admin Sign-off' WHERE id=2")
   assert.equal((await scalar('SELECT simulator_private.original_booking_evidence(1,2,1)')).approval_verified,false)
   await db.exec("UPDATE facility_bookings SET status='Officially Confirmed Booking',fixture_approval=NULL WHERE id=2; UPDATE simulator_private.original_booking_review_policy SET booked_approval_column=NULL,booked_approval_value=NULL")
  })
  await t.test('policy changes stale evidence; unknown audience requires manual confirmation recorded in immutable audit',async()=>{
   await db.exec('DELETE FROM segment_facility_bookings WHERE segment_id=1')
   let result=await user(1,'SELECT public.rpc_simulator_original_booking_candidates(1,1)')
   let b=result.bookings.find(row=>row.booking_id===2)
   await db.exec('UPDATE simulator_private.original_booking_review_policy SET audience_includes_staff=true')
   await assert.rejects(user(1,'SELECT public.rpc_simulator_link_original_booking(1,1,2,$1,$2,true)',[result.event_fingerprint,b.booking_fingerprint]),/Booking changed/)
   result=await user(1,'SELECT public.rpc_simulator_original_booking_candidates(1,1)');b=result.bookings.find(row=>row.booking_id===2)
   await assert.rejects(user(1,'SELECT public.rpc_simulator_link_original_booking(1,1,2,$1,$2,false)',[result.event_fingerprint,b.booking_fingerprint]),/Confirm audience/)
   assert.equal((await user(1,'SELECT public.rpc_simulator_link_original_booking(1,1,2,$1,$2,true)',[result.event_fingerprint,b.booking_fingerprint])).linked,true)
   const audit=await scalar('SELECT to_jsonb(a) FROM simulator_private.original_booking_link_audit a ORDER BY id DESC LIMIT 1')
   assert.equal(audit.manual_suitability_verified,true)
   assert.equal(audit.evidence_snapshot.capacity_verified,false)
   assert.equal(audit.evidence_snapshot.manual_suitability_verified,true)
   assert.ok(audit.snapshot_fingerprint)
  })
  await t.test('migration 004 compiles, preserves separate gates and hardens real booking approval/capacity',async()=>{
   const gates=await scalar('SELECT to_jsonb(g) FROM simulator_private.release_gate g')
   await db.exec(readFileSync(new URL('../migrations/202610310004_simulator_workflow_readiness.sql',import.meta.url),'utf8'))
   assert.deepEqual(await scalar('SELECT to_jsonb(g) FROM simulator_private.release_gate g'),gates)
   const capability=await user(1,'SELECT public.rpc_simulator_workflow_capabilities(1)')
   assert.equal(capability.contract_version,4)
   assert.equal(capability.application_enabled,gates.application_enabled)
   await assert.rejects(user(null,'SELECT public.rpc_simulator_workflow_capabilities(NULL)'),/permission denied/)
   await assert.rejects(user(4,'SELECT public.rpc_simulator_workflow_capabilities(1)'),/permission|authorised/)
   assert.equal((await user(2,'SELECT public.rpc_simulator_workflow_capabilities(NULL)')).contract_version,4)
   await db.exec('BEGIN')
   try{
    await db.exec("UPDATE facility_bookings SET status='Booked' WHERE id=2")
    await assert.rejects(scalar('SELECT simulator_private.validate_event(1,1)'),/approval|evidence/)
   }finally{await db.exec('ROLLBACK')}
   await db.exec('BEGIN')
   try{
    await db.exec("UPDATE facility_bookings SET status='Officially Confirmed Booking' WHERE id=2")
    await scalar('SELECT simulator_private.validate_event(1,1)')
    await db.exec("UPDATE simulator_private.original_booking_review_policy SET activity_audience_column='fixture_audience'; UPDATE event_segments SET fixture_audience=100 WHERE id=1")
    await assert.rejects(scalar('SELECT simulator_private.validate_event(1,1)'),/attendance|evidence/)
   }finally{await db.exec('ROLLBACK')}
   assert.equal(await scalar('SELECT count(*)::integer FROM notifications'),0)
  })
  await t.test('migration 005 preserves Apply and blocks unsafe Undo atomically',async t=>{
   const gates=await scalar('SELECT to_jsonb(g) FROM simulator_private.release_gate g')
   await db.exec(readFileSync(new URL('../migrations/202610310005_simulator_safe_undo.sql',import.meta.url),'utf8'))
   assert.deepEqual(await scalar('SELECT to_jsonb(g) FROM simulator_private.release_gate g'),gates)
   assert.equal(await scalar("SELECT has_function_privilege('authenticated','simulator_private.assert_undo_disruptions_clear(bigint,jsonb)','EXECUTE')"),false)
   const isolated=async operation=>{
    await db.exec('BEGIN')
    try{
     // Synthetic fixture rows only. Both original and replacement bookings must
     // pass migration 004 before disruption safety is tested independently.
     await db.exec("UPDATE facility_bookings SET status='Officially Confirmed Booking' WHERE id IN (1,2)")
     await operation()
    }finally{await db.exec('ROLLBACK')}
   }
   const blockedUnchanged=async(applied,pattern)=>{
    const event=await scalar('SELECT simulator_private.event_state(1)')
    const plan=await scalar('SELECT to_jsonb(p) FROM simulator_private.recovery_plans p WHERE id=$1',[applied.id])
    const audits=await scalar("SELECT count(*)::integer FROM simulator_private.recovery_audit WHERE plan_id=$1 AND action='UNDO' AND outcome='Blocked'",[applied.id])
    const result=await undo(applied)
    assert.equal(result.ok,false);assert.match(result.error,pattern)
    assert.deepEqual(await scalar('SELECT simulator_private.event_state(1)'),event)
    assert.deepEqual(await scalar('SELECT to_jsonb(p) FROM simulator_private.recovery_plans p WHERE id=$1',[applied.id]),plan)
    assert.equal(await scalar("SELECT count(*)::integer FROM simulator_private.recovery_audit WHERE plan_id=$1 AND action='UNDO' AND outcome='Blocked'",[applied.id]),audits+1)
   }
   await t.test('successful schedule Apply and safe Undo restore exact original records',()=>isolated(async()=>{
    const {plan,capture}=await start([delay],[{type:'SCHEDULE_DELAY',segmentId:1,delayMinutes:30}])
    const applied=await confirm(plan)
    assert.equal(applied.application_status,'Applied',applied.error)
    assert.notDeepEqual(await scalar('SELECT simulator_private.event_state(1)'),capture.state)
    const restored=await undo(applied)
    assert.equal(restored.application_status,'Undone',restored.error)
    assert.deepEqual(await scalar('SELECT simulator_private.event_state(1)'),capture.state)
    assert.equal(restored.version,applied.version+1)
   }))
   await t.test('Undo blocks an ongoing member absence and preserves applied event and plan',()=>isolated(async()=>{
    const {plan}=await start();await accept(plan)
    const applied=await confirm(plan);assert.equal(applied.application_status,'Applied',applied.error)
    await blockedUnchanged(applied,/original member is still recorded unavailable/)
   }))
   await t.test('Undo blocks an ongoing original-facility outage and preserves applied links and plan',()=>isolated(async()=>{
    const original=await scalar("SELECT jsonb_build_object('id',b.id,'name',f.name) FROM segment_facility_bookings l JOIN facility_bookings b ON b.id=l.booking_id JOIN facilities f ON f.id=b.facility_id WHERE l.segment_id=1")
    const replacement=await scalar("SELECT jsonb_build_object('id',b.id,'name',f.name) FROM facility_bookings b JOIN facilities f ON f.id=b.facility_id WHERE b.id=$1",[original.id===2?1:2])
    const {plan}=await start([{segmentId:1,venueName:replacement.name,facilityBookingId:replacement.id}],
     [{type:'FACILITY_UNAVAILABLE',venueName:original.name,start:'2026-11-02T10:00:00Z',end:'2026-11-02T12:00:00Z'}])
    const applied=await confirm(plan);assert.equal(applied.application_status,'Applied',applied.error)
    assert.equal(await scalar('SELECT booking_id FROM segment_facility_bookings WHERE segment_id=1'),replacement.id)
    await blockedUnchanged(applied,/original facility is still recorded unavailable/)
    await q("UPDATE facilities SET name='Renamed original facility' WHERE id=(SELECT facility_id FROM facility_bookings WHERE id=$1)",[original.id])
    await blockedUnchanged(applied,/original facility identity changed/)
   }))
   await t.test('Undo blocks intervening event edits without overwriting the later edit',()=>isolated(async()=>{
    const {plan}=await start([delay],[{type:'SCHEDULE_DELAY',segmentId:1,delayMinutes:30}])
    const applied=await confirm(plan);assert.equal(applied.application_status,'Applied',applied.error)
    await db.exec("UPDATE event_segments SET title='Later organizer edit' WHERE id=1")
    await blockedUnchanged(applied,/event records changed after recovery/)
   }))
   await t.test('Undo allows a member replacement when the recorded absence does not overlap original times',()=>isolated(async()=>{
    const {plan,capture}=await start([member],[{type:'MEMBER_UNAVAILABLE',memberId:3,start:'2026-11-02T08:00:00Z',end:'2026-11-02T09:00:00Z'}])
    await accept(plan)
    const applied=await confirm(plan);assert.equal(applied.application_status,'Applied',applied.error)
    const restored=await undo(applied)
    assert.equal(restored.application_status,'Undone',restored.error)
    assert.deepEqual(await scalar('SELECT simulator_private.event_state(1)'),capture.state)
   }))
  })
  await t.test('migration 006 records explicit resolution without changing original disruptions or Apply',async t=>{
   const gates=await scalar('SELECT to_jsonb(g) FROM simulator_private.release_gate g')
   await db.exec(readFileSync(new URL('../migrations/202610310006_simulator_disruption_resolution.sql',import.meta.url),'utf8'))
   assert.deepEqual(await scalar('SELECT to_jsonb(g) FROM simulator_private.release_gate g'),gates)
   assert.equal(await scalar("SELECT has_function_privilege('anon','public.rpc_simulator_resolve_disruption(uuid,integer,integer,text,boolean)','EXECUTE')"),false)
   assert.equal(await scalar("SELECT has_function_privilege('authenticated','public.rpc_simulator_resolve_disruption(uuid,integer,integer,text,boolean)','EXECUTE')"),true)
   const isolated=async work=>{
    await db.exec('BEGIN')
    try{await db.exec("UPDATE facility_bookings SET status='Officially Confirmed Booking' WHERE id IN(1,2)");await work()}
    finally{await db.exec('ROLLBACK')}
   }
   const resolve=(p,index=1)=>user(1,'SELECT public.rpc_simulator_resolve_disruption($1,$2,$3,$4,true)',[p.id,p.version,index,'Organizer independently verified original availability.'])
   const rejectResolution=async(identity,p,version,pattern)=>{
    await db.exec('SAVEPOINT denied_resolution')
    try{
     await q("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid(identity)])
     await db.exec('SET ROLE authenticated')
     await assert.rejects(scalar('SELECT public.rpc_simulator_resolve_disruption($1,$2,1,$3,true)',[p.id,version,'Organizer independently verified availability.']),pattern)
    }finally{await db.exec('ROLLBACK TO SAVEPOINT denied_resolution');await db.exec('RESET ROLE')}
   }
   await t.test('unresolved member blocks Undo; authorized explicit resolution permits exact restoration',()=>isolated(async()=>{
    const {plan,capture}=await start();await accept(plan)
    const applied=await confirm(plan);assert.equal(applied.application_status,'Applied',applied.error)
    const event=await scalar('SELECT simulator_private.event_state(1)')
    const blocked=await undo(applied);assert.equal(blocked.ok,false);assert.match(blocked.error,/Explicitly resolve/)
    assert.deepEqual(await scalar('SELECT simulator_private.event_state(1)'),event)
    const resolution=await resolve(applied);assert.equal(resolution.resolved,true)
    assert.equal(resolution.plan.version,applied.version+1)
    assert.deepEqual(resolution.plan.disruptions,plan.disruptions)
    assert.deepEqual(await scalar('SELECT simulator_private.event_state(1)'),event)
    assert.equal((await undo(applied)).ok,false,'Old revision cannot authorize Undo after resolution.')
    const restored=await undo(resolution.plan);assert.equal(restored.application_status,'Undone',restored.error)
    assert.deepEqual(await scalar('SELECT simulator_private.event_state(1)'),capture.state)
    assert.ok(await scalar("SELECT count(*)>0 FROM simulator_private.recovery_audit WHERE plan_id=$1 AND action='DISRUPTION_RESOLVED'",[plan.id]))
   }))
   await t.test('resolved facility still requires valid original approval; valid booking permits Undo',()=>isolated(async()=>{
    const original=await scalar("SELECT jsonb_build_object('id',b.id,'name',f.name) FROM segment_facility_bookings l JOIN facility_bookings b ON b.id=l.booking_id JOIN facilities f ON f.id=b.facility_id WHERE l.segment_id=1")
    const replacement=await scalar("SELECT jsonb_build_object('id',b.id,'name',f.name) FROM facility_bookings b JOIN facilities f ON f.id=b.facility_id WHERE b.id=$1",[original.id===2?1:2])
    const {plan,capture}=await start([{segmentId:1,venueName:replacement.name,facilityBookingId:replacement.id}],
     [{type:'FACILITY_UNAVAILABLE',venueName:original.name,start:'2026-11-02T10:00:00Z',end:'2026-11-02T12:00:00Z'}])
    const applied=await confirm(plan);assert.equal(applied.application_status,'Applied',applied.error)
    assert.equal((await undo(applied)).ok,false)
    const resolution=await resolve(applied),current=await scalar('SELECT simulator_private.event_state(1)')
    await q("UPDATE facility_bookings SET status='Pending Admin Sign-off' WHERE id=$1",[original.id])
    const blocked=await undo(resolution.plan);assert.equal(blocked.ok,false);assert.match(blocked.error,/approval|evidence/)
    assert.deepEqual(await scalar('SELECT simulator_private.event_state(1)'),current)
    assert.equal(await scalar('SELECT version FROM simulator_private.recovery_plans WHERE id=$1',[plan.id]),resolution.plan.version)
    await q("UPDATE facility_bookings SET status='Officially Confirmed Booking' WHERE id=$1",[original.id])
    const restored=await undo(resolution.plan);assert.equal(restored.application_status,'Undone',restored.error)
    assert.deepEqual(await scalar('SELECT simulator_private.event_state(1)'),capture.state)
   }))
   await t.test('ordinary and other-club users cannot resolve; stale revisions and edited events are rejected',()=>isolated(async()=>{
    const {plan}=await start();await accept(plan)
    const applied=await confirm(plan);assert.equal(applied.application_status,'Applied',applied.error)
    for(const actor of [2,4])await rejectResolution(actor,applied,applied.version,/permission|authorised/)
    await rejectResolution(1,applied,applied.version-1,/revision changed/)
    assert.equal(await scalar("SELECT count(*)::integer FROM simulator_private.recovery_audit WHERE plan_id=$1 AND action='DISRUPTION_RESOLVED'",[plan.id]),0)
    await db.exec("UPDATE event_segments SET title='Later organizer edit before resolution' WHERE id=1")
    await rejectResolution(1,applied,applied.version,/Event changed/)
    assert.equal((await undo(applied)).ok,false)
    assert.equal(await scalar('SELECT version FROM simulator_private.recovery_plans WHERE id=$1',[plan.id]),applied.version)
   }))
  })
  await t.test('new archival audit survives booking deletion and calendar TRUNCATE without new live FKs',async()=>{
   const before=await scalar("SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM simulator_private.original_booking_link_audit a")
   assert.ok(before.length>=2)
   assert.equal(await scalar("SELECT count(*)::integer FROM pg_constraint WHERE conrelid='simulator_private.original_booking_link_audit'::regclass AND contype='f'"),0)
   await db.exec('DELETE FROM segment_facility_bookings WHERE booking_id=2; DELETE FROM facility_bookings WHERE id=2')
   assert.deepEqual(await scalar("SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM simulator_private.original_booking_link_audit a"),before)
   await db.exec('TRUNCATE public.facility_bookings CASCADE')
   assert.deepEqual(await scalar("SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM simulator_private.original_booking_link_audit a"),before)
   await assert.rejects(db.exec("UPDATE simulator_private.original_booking_link_audit SET evidence_snapshot='{}'"),/immutable/)
   await assert.rejects(db.exec('DELETE FROM simulator_private.original_booking_link_audit'),/cannot be erased/)
   await assert.rejects(db.exec('TRUNCATE simulator_private.original_booking_link_audit'),/cannot be erased/)
   assert.deepEqual(await scalar("SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM simulator_private.original_booking_link_audit a"),before)
  })

  await t.test('isolated fixture gates are reset to disabled before disposal',async()=>{
   await db.exec('UPDATE simulator_private.release_gate SET application_enabled=false,invitations_enabled=false,original_booking_linking_enabled=false')
   assert.equal(await scalar('SELECT application_enabled OR invitations_enabled FROM simulator_private.release_gate'),false)
  })

 }finally{await db.close()}
})
