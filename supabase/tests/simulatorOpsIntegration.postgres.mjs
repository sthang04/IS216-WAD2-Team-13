import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './fixtures/simulatorSchema.mjs'
import {
  adaptOpsSimulationData,
  opsTaskTimestamp
} from '../../src/services/simulatorOpsDataService.js'
import {evaluateRecoveryPlan} from '../../src/services/recoveryPlanEvaluationService.js'
import { runCompleteSimulation } from '../../src/services/simulationService.js'
import {
  captureSimulatorState,
  createSimulatorWorkflow
} from '../../src/services/simulatorWorkflowService.js'
const require = createRequire(import.meta.url)
if (!process.env.PULSE_PGLITE_PATH)
  throw Error(
    'Set PULSE_PGLITE_PATH to an isolated @electric-sql/pglite installation. No live database is used.'
  )
const { PGlite } = require(process.env.PULSE_PGLITE_PATH)
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0')
const migration = (name) =>
  readFileSync(
    new URL('../migrations/' + name, import.meta.url),
    'utf8'
  ).replace(/^\uFEFF/, '')

test('Ops adapter preserves UUIDs, explicit timezone, fixed tasks and isolated previews', async () => {
  const source = {
    events: [
      {
        id: id(1001),
        club_id: 1,
        name: 'Saved operations event',
        event_date: '2026-11-03',
        venue: 'Room'
      }
    ],
    tasks: [
      {
        id: id(2001),
        event_id: id(1001),
        member_id: 3,
        title: 'Saved task',
        task_type: 'setup',
        start_time: '18:00:00.123456',
        end_time: '19:00:00.654321',
        is_fixed: true
      }
    ],
    crew: [{ event_id: id(1001), member_id: 3 }],
    members: [{ id: 3, full_name: 'Actual member' }],
    clubs: [{ id: 1, name: 'Club One' }]
  }
  const converted = adaptOpsSimulationData(source)
  assert.equal(converted.events[0].id, id(1001))
  assert.equal(converted.event_segments[0].ops_task_id, id(2001))
  assert.equal(
    converted.event_segments[0].starts_at,
    '2026-11-03T18:00:00.123456+08:00'
  )
  assert.equal(converted.event_segments[0].is_fixed, true)
  assert.deepEqual(converted.segment_dependencies, [])
  assert.deepEqual(converted.segment_facility_bookings, [])
  assert.throws(
    () => captureSimulatorState(converted, id(1001)),
    /operations integration/
  )
  let requests = 0
  const api = createSimulatorWorkflow(
    {
      rpc: () => {
        requests++
        throw Error('Unexpected request')
      }
    },
    { enabled: true, eventContext: () => converted.events[0] }
  )
  await assert.rejects(api.history(id(1001)), /integration/)
  assert.equal(requests, 0)
  assert.throws(() => opsTaskTimestamp('2026-02-30', '18:00'), /calendar date/)
  assert.equal(
    opsTaskTimestamp('2026-11-03', '24:00:00'),
    '2026-11-04T00:00:00+08:00'
  )
  const previewData = {
    ...converted,
    facility_slots: [],
    facility_bookings: [],
    facilities: []
  }
  assert.throws(
    () =>
      runCompleteSimulation(previewData, id(1001), [
        { type: 'SCHEDULE_DELAY', segmentId: id(2001), delayMinutes: 10 }
      ]),
    /Fixed Day Ops/
  )
  previewData.event_segments = converted.event_segments.map((s) => ({
    ...s,
    is_fixed: false
  }))
  const preview = runCompleteSimulation(previewData, id(1001), [
    { type: 'SCHEDULE_DELAY', segmentId: id(2001), delayMinutes: 10 }
  ])
  assert.equal(preview.simulatedSegments[0].ops_task_id, id(2001))
  assert.equal(
    converted.event_segments[0].starts_at,
    '2026-11-03T18:00:00.123456+08:00'
  )
  assert.throws(
    () => adaptOpsSimulationData({ ...source, crew: [] }),
    /event crew/
  )
  assert.deepEqual(source.tasks[0].start_time, '18:00:00.123456')
  const evaluation=evaluateRecoveryPlan({data:previewData,eventId:id(1001),disruptions:[],option:{id:'task-only',changes:[{segmentId:id(2001),starts_at:'2026-11-03T10:10:00.123456Z',ends_at:'2026-11-03T11:10:00.654321Z'}]}})
  assert.ok(evaluation.warnings.some(w=>w.includes('task-only updates do not reserve facilities')))
  assert.ok(!evaluation.warnings.some(w=>w.includes('No linked or identifiable facility booking')))
  const roomEvaluation=evaluateRecoveryPlan({data:previewData,eventId:id(1001),disruptions:[],option:{id:'room',changes:[{segmentId:id(2001),facilityBookingId:999}]}})
  assert.ok(roomEvaluation.warnings.some(w=>w.includes('No linked or identifiable facility booking')))
})

test('isolated Ops integration PostgreSQL contracts (no network or E2E)', async (t) => {
  const db = new PGlite()
  const q = (sql, args = []) => db.query(sql, args)
  const scalar = async (sql, args = []) =>
    Object.values((await q(sql, args)).rows[0])[0]
  const user = async (n, sql, args = []) => {
    await db.exec('RESET ROLE')
    await q("SELECT set_config('request.jwt.claim.sub',$1,false)", [
      n ? id(n) : ''
    ])
    await db.exec('SET ROLE ' + (n ? 'authenticated' : 'anon'))
    try {
      return await scalar(sql, args)
    } finally {
      await db.exec('RESET ROLE')
    }
  }
  const source = id(1001),
    task = id(2001)
  let event,
    segment,
    assignment,
    request = 3000
  const capture = () =>
    user(1, 'SELECT public.rpc_simulator_capture_state($1)', [event])
  const start = async (
    changes,
    disruptions = [
      {
        type: 'MEMBER_UNAVAILABLE',
        memberId: 3,
        start: '2026-11-03T09:00:00Z',
        end: '2026-11-03T09:15:00Z'
      }
    ]
  ) => {
    const before = await capture()
    return user(
      1,
      'SELECT public.rpc_simulator_start_plan($1,$2,$3::jsonb,$4::jsonb,$5,$6::jsonb,$7::uuid)',
      [
        event,
        'Isolated Ops plan',
        JSON.stringify(changes),
        JSON.stringify(before.state),
        before.fingerprint,
        JSON.stringify(disruptions),
        id(++request)
      ]
    )
  }
  const apply = (p) =>
    user(1, 'SELECT public.rpc_simulator_apply_plan($1,$2,true)', [
      p.id,
      p.version
    ])
  const undo = (p) =>
    user(1, 'SELECT public.rpc_simulator_undo_plan($1,$2,true)', [
      p.id,
      p.version
    ])
  const schedule = () => [
    {
      segmentId: segment,
      starts_at: '2026-11-03T10:30:00.123456Z',
      ends_at: '2026-11-03T11:30:00.654321Z'
    }
  ]
  try {
    await db.exec(fixture)
    // Include the actual live CHECKs missing from the older minimal fixture.
    await db.exec(
      'ALTER TABLE events ADD CHECK(ends_at>starts_at); ALTER TABLE event_segments ADD CHECK(ends_at>starts_at)'
    )
    for (const name of [
      '202610310002_simulator_recovery_workflow.sql',
      '202610310003_simulator_original_booking_links.sql',
      '202610310004_simulator_workflow_readiness.sql',
      '202610310005_simulator_safe_undo.sql',
      '202610310006_simulator_disruption_resolution.sql',
      '20261104000100_simulator_logistics_recovery_access.sql',
      '20261104000100_pulse_ops_events.sql'
    ])
      await db.exec(migration(name))
    await q(
      "INSERT INTO ops_events(id,club_id,name,event_date,venue) VALUES($1,1,'Saved event','2026-11-03','Original Room')",
      [source]
    )
    await q(
      "INSERT INTO ops_event_crew(event_id,member_id,checked_in_at,late) VALUES($1,3,'17:45','Existing attendance')",
      [source]
    )
    await q(
      "INSERT INTO ops_tasks(id,event_id,member_id,title,task_type,start_time,end_time) VALUES($1,$2,3,'Saved task','setup','18:00:00.123456','19:00:00.654321')",
      [task, source]
    )
    await t.test(
      'migration compiles, backfills and leaves release flags unchanged',
      async () => {
        const gates = await scalar(
          'SELECT to_jsonb(g) FROM simulator_private.release_gate g'
        )
        await db.exec(migration('20261104083807_simulator_ops_integration.sql'))
        await db.exec(migration('20261104093436_simulator_ops_task_only_validation.sql'))
        await db.exec(migration('20261104121747_simulator_event_source_catalog.sql'))
        assert.deepEqual(
          await scalar(
            'SELECT to_jsonb(g) FROM simulator_private.release_gate g'
          ),
          gates
        )
        const ctx = await user(1, 'SELECT public.rpc_simulator_ops_context()')
        event = ctx.event_links[0].event_id
        segment = ctx.task_links[0].segment_id
        assignment = ctx.task_links[0].assignment_id
        assert.equal(ctx.task_links[0].ops_task_id, task)
        assert.equal(
          await scalar(
            'SELECT member_id FROM segment_assignments WHERE id=$1',
            [assignment]
          ),
          3
        )
      }
    )
    await t.test(
      'private mappings, anonymous callers and unrelated clubs stay protected',
      async () => {
        assert.equal(
          (await user(4, 'SELECT public.rpc_simulator_ops_context()'))
            .event_links.length,
          0
        )
        await assert.rejects(
          user(null, 'SELECT public.rpc_simulator_ops_context()'),
          /permission denied/
        )
        await assert.rejects(
          user(1, 'SELECT count(*) FROM simulator_private.ops_task_links'),
          /permission denied/
        )
        await assert.rejects(
          user(4, 'SELECT public.rpc_simulator_ops_roster($1)', [event]),
          /permission/
        )
        assert.equal(
          (await user(1, 'SELECT public.rpc_simulator_ops_roster($1)', [event]))
            .club_id,
          1
        )
        await assert.rejects(
          q(
            "UPDATE event_segments SET title='Unrelated legacy edit' WHERE id=$1",
            [segment]
          ),
          /derived from Day Ops/
        )
      }
    )
    await t.test('event catalog uses exact links, hides other clubs and denies anonymous access',async()=>{
      const catalog=await user(1,'SELECT public.rpc_simulator_event_sources()')
      assert.equal(catalog.contract_version,1)
      assert.deepEqual(catalog.links,[{event_id:event,ops_event_id:source,source_event_uuid:source,archived:false}])
      assert.deepEqual((await user(4,'SELECT public.rpc_simulator_event_sources()')).links,[])
      await assert.rejects(user(null,'SELECT public.rpc_simulator_event_sources()'),/permission denied/)
    })
    await t.test(
      'Day Ops edits and reassignments preserve stable mappings',
      async () => {
        await q('INSERT INTO ops_event_crew(event_id,member_id) VALUES($1,2)', [
          source
        ])
        await q(
          "UPDATE ops_tasks SET title='Edited task',member_id=2,start_time='18:05' WHERE id=$1",
          [task]
        )
        assert.equal(
          await scalar('SELECT title FROM event_segments WHERE id=$1', [
            segment
          ]),
          'Edited task'
        )
        assert.equal(
          await scalar(
            'SELECT segment_id FROM simulator_private.ops_task_links WHERE ops_task_id=$1',
            [task]
          ),
          segment
        )
        await q(
          "UPDATE ops_tasks SET title='Saved task',member_id=3,start_time='18:00:00.123456' WHERE id=$1",
          [task]
        )
      }
    )
    await db.exec(
      "UPDATE simulator_private.release_gate SET application_enabled=true,invitations_enabled=true; INSERT INTO facility_bookings VALUES(4,1,'2026-11-03','17:00','22:00',1,'Officially Confirmed Booking')"
    )
    await t.test('unbooked Ops schedule Apply and Undo restore actual tasks exactly',async()=>{
      const before=await scalar('SELECT simulator_private.ops_state($1)',[source])
      const plan=await start(schedule(),[{type:'SCHEDULE_DELAY',segmentId:segment,delayMinutes:30}])
      const applied=await apply(plan);assert.equal(applied.application_status,'Applied',applied.error)
      assert.equal(await scalar('SELECT start_time::text FROM ops_tasks WHERE id=$1',[task]),'18:30:00.123456')
      assert.equal(await scalar('SELECT count(*)::integer FROM segment_facility_bookings WHERE segment_id=$1',[segment]),0)
      assert.equal((await undo(applied)).application_status,'Undone')
      assert.deepEqual(await scalar('SELECT simulator_private.ops_state($1)',[source]),before)
    })
    await t.test('unbooked Ops replacement still requires exact consent and restores assignments',async()=>{
      const plan=await start([{segmentId:segment,assignmentId:assignment,replacedMemberId:3,replacementMemberId:2,roleName:'setup'}])
      const blocked=await apply(plan);assert.equal(blocked.ok,false);assert.match(blocked.error,/invitation.*accepted/i)
      const invitation=await scalar('SELECT id FROM simulator_private.replacement_invitations WHERE plan_id=$1',[plan.id])
      await user(2,"SELECT public.rpc_simulator_respond_invitation($1,'Accepted')",[invitation])
      const applied=await apply(plan);assert.equal(applied.application_status,'Applied',applied.error)
      assert.equal(await scalar('SELECT member_id FROM ops_tasks WHERE id=$1',[task]),2)
      assert.equal((await undo(applied)).application_status,'Undone')
      assert.equal(await scalar('SELECT member_id FROM ops_tasks WHERE id=$1',[task]),3)
    })
    await t.test('unbooked Ops room changes cannot bypass missing or pending booking approval',async()=>{
      const before=(await capture()).state
      const missing=await start([{segmentId:segment,venueName:'Original Room'}])
      assert.match((await apply(missing)).error,/actual replacement booking/)
      await db.exec("UPDATE facility_bookings SET status='Pending Admin Sign-off' WHERE id=4")
      const pending=await start([{segmentId:segment,venueName:'Original Room',facilityBookingId:4}])
      assert.match((await apply(pending)).error,/not approved/)
      assert.deepEqual((await capture()).state,before)
      await db.exec("UPDATE facility_bookings SET status='Officially Confirmed Booking' WHERE id=4")
      const approved=await start([{segmentId:segment,venueName:'Original Room',facilityBookingId:4}])
      const applied=await apply(approved);assert.equal(applied.application_status,'Applied',applied.error)
      assert.equal(await scalar('SELECT venue FROM ops_tasks WHERE id=$1',[task]),'Original Room')
      assert.equal((await undo(applied)).application_status,'Undone')
      assert.deepEqual((await capture()).state,before)
      assert.equal(await scalar('SELECT venue FROM ops_tasks WHERE id=$1',[task]),null)
    })
    await t.test('legacy unbooked activities retain their original validation',async()=>{
      await db.exec('DELETE FROM segment_facility_bookings WHERE segment_id=1')
      await assert.rejects(scalar('SELECT simulator_private.validate_event(1,1)'),/lacks a verified facility booking/)
      await db.exec('INSERT INTO segment_facility_bookings VALUES(1,1)')
    })
    await q('INSERT INTO segment_facility_bookings VALUES($1,4)', [segment])
    await t.test('existing Ops booking links still block task-only changes when approval or coverage is invalid',async()=>{
      for(const [sql,reason] of [["UPDATE facility_bookings SET status='Pending Admin Sign-off' WHERE id=4",/approval/],["UPDATE facility_bookings SET end_time='19:00' WHERE id=4",/cover/]]){
        await db.exec(sql)
        const plan=await start(schedule());const before=(await capture()).state
        const blocked=await apply(plan);assert.equal(blocked.ok,false);assert.match(blocked.error,reason)
        assert.deepEqual((await capture()).state,before)
        await db.exec("UPDATE facility_bookings SET status='Officially Confirmed Booking',end_time='22:00' WHERE id=4")
      }
    })
    await t.test(
      'Apply and Undo update actual Ops UUID tasks with exact timestamps and preserve attendance',
      async () => {
        const before = await scalar('SELECT simulator_private.ops_state($1)', [
          source
        ])
        const plan = await start(schedule())
        const applied = await apply(plan)
        assert.equal(applied.application_status, 'Applied', applied.error)
        assert.equal(
          await scalar('SELECT start_time::text FROM ops_tasks WHERE id=$1', [
            task
          ]),
          '18:30:00.123456'
        )
        assert.equal((await apply(applied)).version, applied.version)
        await q('UPDATE ops_events SET name=name WHERE id=$1', [source]) // unchanged Day Ops autosave
        assert.equal((await apply(applied)).version, applied.version)
        const undone = await undo(applied)
        assert.equal(undone.application_status, 'Undone', undone.error)
        assert.deepEqual(
          await scalar('SELECT simulator_private.ops_state($1)', [source]),
          before
        )
        assert.equal((await undo(undone)).version, undone.version)
        assert.equal(
          await scalar(
            'SELECT late FROM ops_event_crew WHERE event_id=$1 AND member_id=3',
            [source]
          ),
          'Existing attendance'
        )
      }
    )
    await t.test(
      'accepted replacement writes Ops member UUID mapping and Undo restores it',
      async () => {
        const plan = await start([
          {
            segmentId: segment,
            assignmentId: assignment,
            replacedMemberId: 3,
            replacementMemberId: 2,
            roleName: 'setup'
          }
        ])
        assert.equal((await apply(plan)).ok, false)
        const invitation = await scalar(
          'SELECT id FROM simulator_private.replacement_invitations WHERE plan_id=$1',
          [plan.id]
        )
        await user(
          2,
          "SELECT public.rpc_simulator_respond_invitation($1,'Accepted')",
          [invitation]
        )
        const applied = await apply(plan)
        assert.equal(applied.application_status, 'Applied', applied.error)
        assert.equal(
          await scalar('SELECT member_id FROM ops_tasks WHERE id=$1', [task]),
          2
        )
        const undone = await undo(applied)
        assert.equal(undone.application_status, 'Undone', undone.error)
        assert.equal(
          await scalar('SELECT member_id FROM ops_tasks WHERE id=$1', [task]),
          3
        )
        assert.equal(
          await scalar(
            'SELECT checked_in_at::text FROM ops_event_crew WHERE event_id=$1 AND member_id=3',
            [source]
          ),
          '17:45:00'
        )
      }
    )
    await t.test(
      'fixed flags and source metadata changes block Apply without overwriting tasks',
      async () => {
        const plan = await start(schedule())
        await q('UPDATE ops_tasks SET is_fixed=true WHERE id=$1', [task])
        assert.match((await apply(plan)).error, /Day Ops records changed/)
        const fixed = await start(schedule())
        assert.match((await apply(fixed)).error, /Fixed Day Ops/)
        await q('UPDATE ops_tasks SET is_fixed=false WHERE id=$1', [task])
      }
    )
    await t.test(
      'late writeback failures roll back both stores and successful audit',
      async () => {
        const plan = await start(schedule())
        // A real trigger failure occurs after the legacy validator succeeds.
        await db.exec(
          `CREATE FUNCTION public.fixture_block_writeback() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'Fixture writeback blocked'; END $f$; CREATE TRIGGER fixture_block_writeback BEFORE UPDATE ON ops_tasks FOR EACH ROW EXECUTE FUNCTION public.fixture_block_writeback()`
        )
        const before = (await capture()).state
        const result = await apply(plan)
        assert.equal(result.ok, false)
        assert.match(result.error, /Fixture writeback blocked/)
        assert.deepEqual((await capture()).state, before)
        assert.equal(
          await scalar(
            'SELECT application_status FROM simulator_private.recovery_plans WHERE id=$1',
            [plan.id]
          ),
          'Draft'
        )
        assert.equal(
          await scalar(
            "SELECT count(*)::integer FROM simulator_private.recovery_audit WHERE plan_id=$1 AND action='APPLY' AND outcome='Succeeded'",
            [plan.id]
          ),
          0
        )
        await db.exec(
          'DROP TRIGGER fixture_block_writeback ON ops_tasks; DROP FUNCTION public.fixture_block_writeback()'
        )
      }
    )
    await t.test(
      'room recovery uses approved booking and restores actual task venue',
      async () => {
        await db.exec(
          "INSERT INTO facility_bookings VALUES(5,2,'2026-11-03','17:00','22:00',1,'Officially Confirmed Booking')"
        )
        const plan = await start([
          {
            segmentId: segment,
            venueName: 'Replacement Room',
            facilityBookingId: 5
          }
        ])
        const applied = await apply(plan)
        assert.equal(applied.application_status, 'Applied', applied.error)
        assert.equal(
          await scalar('SELECT venue FROM ops_tasks WHERE id=$1', [task]),
          'Replacement Room'
        )
        assert.equal((await undo(applied)).application_status, 'Undone')
        assert.equal(
          await scalar('SELECT venue FROM ops_tasks WHERE id=$1', [task]),
          null
        )
      }
    )
    await t.test('real Ops RLS permits same-club edits and hides other clubs',async()=>{
   assert.equal(await user(1,'SELECT count(*)::integer FROM ops_tasks WHERE id=$1',[task]),1)
   assert.equal(await user(4,'SELECT count(*)::integer FROM ops_tasks WHERE id=$1',[task]),0)
   assert.equal(await user(1,"UPDATE ops_tasks SET title=title WHERE id=$1 RETURNING title",[task]),'Saved task')
   assert.equal(await scalar("SELECT bool_and(NOT has_function_privilege('authenticated',p.oid,'EXECUTE') AND NOT has_function_privilege('anon',p.oid,'EXECUTE')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='simulator_private'"),true)
  })
  await t.test('a changed persisted dependency blocks an otherwise unchanged plan',async()=>{
   const second=id(2003)
   await q("INSERT INTO ops_tasks(id,event_id,member_id,title,task_type,start_time,end_time) VALUES($1,$2,3,'Earlier task','setup','17:00','17:30')",[second,source])
   const other=await scalar('SELECT segment_id FROM simulator_private.ops_task_links WHERE ops_task_id=$1',[second])
   const plan=await start(schedule())
   await q('INSERT INTO segment_dependencies VALUES($1,$2)',[other,segment])
   assert.match((await apply(plan)).error,/Day Ops records changed/)
   await q('DELETE FROM ops_tasks WHERE id=$1',[second])
  })
  await t.test(
      'new tasks, empty events and event cascades preserve canonical IDs and isolated history',
      async () => {
        const event2 = id(1002),
          task2 = id(2002)
        await q(
          "INSERT INTO ops_events(id,club_id,name,event_date) VALUES($1,1,'New empty event','2026-11-05')",
          [event2]
        )
        assert.equal(
          await scalar(
            'SELECT count(*)::integer FROM simulator_private.ops_event_links WHERE ops_event_id=$1',
            [event2]
          ),
          0
        )
        await q('INSERT INTO ops_event_crew(event_id,member_id) VALUES($1,3)', [
          event2
        ])
        await q(
          "INSERT INTO ops_tasks(id,event_id,member_id,title,task_type,start_time,end_time) VALUES($1,$2,3,'New task','meal','23:00','24:00')",
          [task2, event2]
        )
        const mapped = await scalar(
          'SELECT segment_id FROM simulator_private.ops_task_links WHERE ops_task_id=$1',
          [task2]
        )
        assert.ok(mapped)
        await q('DELETE FROM ops_events WHERE id=$1', [event2])
        assert.ok((await user(1,'SELECT public.rpc_simulator_event_sources()')).links.some(l=>l.source_event_uuid===event2 && l.ops_event_id===null && l.archived===true))
        assert.equal(
          await scalar(
            'SELECT count(*)::integer FROM event_segments WHERE id=$1',
            [mapped]
          ),
          0
        )
        assert.equal(
          await scalar(
            'SELECT count(*)::integer FROM simulator_private.ops_event_links WHERE source_event_uuid=$1 AND ops_event_id IS NULL',
            [event2]
          ),
          1
        )
      }
    )
    await t.test(
      'later Day Ops edits block Undo and deleted tasks remove live projections while keeping plans',
      async () => {
        const plan = await start(schedule())
        const applied = await apply(plan)
        assert.equal(applied.application_status, 'Applied', applied.error)
        await q("UPDATE ops_tasks SET title='Later ops edit' WHERE id=$1", [
          task
        ])
        assert.match((await undo(applied)).error, /Day Ops records changed/)
        await q('DELETE FROM ops_tasks WHERE id=$1', [task])
        assert.equal(
          await scalar(
            'SELECT count(*)::integer FROM event_segments WHERE id=$1',
            [segment]
          ),
          0
        )
        assert.ok(
          await scalar(
            'SELECT count(*)>0 FROM simulator_private.recovery_plans WHERE event_id=$1',
            [event]
          )
        )
        await q('DELETE FROM ops_events WHERE id=$1', [source])
        assert.match((await undo(applied)).error, /deleted/)
      }
    )
  } finally {
    await db.close()
  }
})
