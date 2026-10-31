import {test,expect} from '@playwright/test'
// IN-MEMORY RPC RESPONSES ONLY. This tests real Vue handlers and the real adapter,
// not Supabase persistence or database authorization. All external traffic is blocked.
async function boot(page){
 await page.route('https://**',route=>route.abort())
 await page.route('**/src/services/simulatorWorkflowService.js*',async route=>{
  const response=await route.fetch()
  await route.fulfill({response,body:(await response.text()).replace(/export const SIMULATOR_WORKFLOW_VERIFIED = [^\n]+/,'export const SIMULATOR_WORKFLOW_VERIFIED = true')})
 })
 await page.route('**/src/services/simulationDataService.js*',route=>route.fulfill({contentType:'application/javascript',body:
  "export async function loadSimulationData(){window.__localLoads=(window.__localLoads||0)+1;return structuredClone(window.__localDb)}"}))
 await page.route('**/src/supabase.js*',route=>route.fulfill({contentType:'application/javascript',body:`
  import {campusConnectFixture} from '/e2e-simulator/fixtures/campusConnect.js';
  import {captureSimulatorState,projectRecoveryPreview,invitationTerms} from '/src/services/simulatorWorkflowService.js';
  const d=campusConnectFixture();const first=d.event_segments.find(s=>s.event_id===990001);
  d.event_segments=d.event_segments.filter(s=>s.event_id!==990001||s.id===first.id);
  d.events[0].ends_at=first.ends_at;d.segment_dependencies=[];
  d.segment_assignments=d.segment_assignments.filter(a=>!Array.from({length:7},(_,i)=>i+2).includes(a.segment_id));
  d.segment_facility_bookings=[{segment_id:1,booking_id:1}];d.segment_facility_slots=[{segment_id:1,facility_slot_id:1}];
  window.__localDb=d;window.__localCalls=[];window.__localLoads=0;window.__resolved=false;window.__audit=[];
  const before=captureSimulatorState(d,990001);
  const plan={id:'00000000-0000-4000-8000-000000000777',event_id:990001,title:'ISOLATED accepted recovery fixture',
   version:1,lifecycle:'In Progress',application_status:'Draft',before_state:before,before_fingerprint:'a'.repeat(64),
   changes:[{segmentId:1,assignmentId:1,replacedMemberId:1,replacementMemberId:2,roleName:'Performer'},
    {segmentId:1,starts_at:'2026-11-02T02:30:00.000000Z',ends_at:'2026-11-02T03:00:00.000000Z'}],
   disruptions:[{type:'MEMBER_UNAVAILABLE',memberId:1,start:'2026-11-02T10:00:00+08:00',end:'2026-11-02T10:30:00+08:00'},
    {type:'SCHEDULE_DELAY',segmentId:1,delayMinutes:30}],actions:[{kind:'Member',segmentId:1,status:'Accepted'}]};
  window.__localPlan=plan;window.__localOriginal=structuredClone(before);
  const invitation={id:'fixture-invite',plan_id:plan.id,recipient_member_id:2,replaced_member_id:1,
   status:'Accepted',expires_at:'2099-11-02T00:00:00Z',assignment_snapshot:invitationTerms(plan,1)};
  window.__localInvitation=invitation;
  function restore(state){
   d.events=d.events.map(e=>e.id===990001?{...e,...state.event}:e);
   d.event_segments=d.event_segments.map(s=>state.segments.some(t=>t.id===s.id)?{...s,...state.segments.find(t=>t.id===s.id)}:s);
   d.segment_assignments=d.segment_assignments.map(a=>state.assignments.some(t=>t.id===a.id)?{...a,...state.assignments.find(t=>t.id===a.id)}:a);
   d.segment_facility_bookings=structuredClone(state.links);
   d.segment_facility_slots=state.links.map(l=>({segment_id:l.segment_id,facility_slot_id:l.booking_id}));
  }
  const result=data=>({data:structuredClone(data),error:null});
  export const isSupabaseConfigured=()=>true;
  export const supabase={auth:{onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}}},async rpc(name,args){
   window.__localCalls.push({name,args:structuredClone(args)});
   if(name==='rpc_simulator_workflow_capabilities')return result({contract_version:4,application_enabled:true,invitations_enabled:false});
   if(name==='rpc_simulator_my_invitations')return result({invitations:[]});
   if(name==='rpc_simulator_plan_history')return result({plans:[plan],invitations:[invitation],audit:window.__audit});
   if(window.__denyOperation)return {error:{message:'Event management permission required'}};
   if(args.p_plan_id!==plan.id)return {error:{message:'Wrong selected plan'}};
   if(args.p_expected_version!==plan.version)return {error:{message:'Plan revision changed; refresh history'}};
   if(name==='rpc_simulator_apply_plan'){
    if(window.__holdApply)await new Promise(resolve=>{window.__releaseApply=resolve});
    const after=projectRecoveryPreview(before,plan.changes);restore(after);
    plan.after_state=after;plan.after_fingerprint='b'.repeat(64);plan.application_status='Applied';plan.lifecycle='Resolved';plan.version++;
    window.__audit.push({id:1,plan_id:plan.id,action:'APPLY',outcome:'Succeeded'});return result(plan);
   }
   if(name==='rpc_simulator_resolve_disruption'){
    window.__resolved=true;plan.version++;
    window.__audit.push({id:2,plan_id:plan.id,action:'DISRUPTION_RESOLVED',outcome:'Succeeded',
     details:JSON.stringify({disruption_index:1,disruption:plan.disruptions[0],applied_fingerprint:plan.after_fingerprint,reason:args.p_resolution_note})});
    return result({resolved:true,disruption_index:1,plan});
   }
   if(name==='rpc_simulator_undo_plan'){
    if(!window.__resolved)return result({ok:false,error:'Undo blocked: original member is still recorded unavailable. Explicitly resolve relevant disruptions.'});
    restore(before);plan.application_status='Undone';plan.lifecycle='Open';plan.version++;
    window.__audit.push({id:3,plan_id:plan.id,action:'UNDO',outcome:'Succeeded'});return result(plan);
   }
   return {error:{message:'Unexpected isolated RPC: '+name}};
  }};
 `}))
 await page.goto('/e2e-simulator/harness.html')
 await page.getByRole('region',{name:'Persisted recovery workflow',exact:true}).scrollIntoViewIfNeeded()
 await page.locator('[data-saved-plan-id="00000000-0000-4000-8000-000000000777"]').click()
 const panel=page.getByRole('region',{name:'Persisted recovery workflow',exact:true})
 await panel.getByLabel('I manually checked personal availability, qualifications and facility suitability; incomplete data is not proof of availability.',{exact:true}).check()
 return panel
}
async function confirm(panel){
 const action=panel.getByLabel('Action confirmation',{exact:true})
 await action.getByRole('checkbox').check()
 await action.getByRole('button',{name:'Confirm selected action',exact:true}).click()
}
test('local Apply refreshes schedule; blocked Undo resolves explicitly then restores original schedule',async({page})=>{
 const panel=await boot(page)
 await page.evaluate(()=>{window.__holdApply=true})
 await panel.getByRole('button',{name:'Apply selected recovery',exact:true}).click()
 expect(await page.evaluate(()=>window.__localCalls.filter(c=>c.name==='rpc_simulator_apply_plan').length)).toBe(0)
 await confirm(panel)
 await expect(panel.getByText(/Running Apply selected recovery;/)).toBeVisible()
 await expect(panel.getByRole('button',{name:'Apply selected recovery',exact:true})).toBeDisabled()
 await page.evaluate(()=>window.__releaseApply())
 await expect(panel.getByText('Recovery committed by the server.',{exact:true})).toBeVisible()
 await expect.poll(()=>page.evaluate(()=>window.__localLoads)).toBeGreaterThan(1)
 const comparison=page.getByRole('heading',{name:'Plan Comparison',exact:true}).locator('..').locator('..')
 await expect(comparison).toContainText('11:00')
 await expect(panel.getByRole('button',{name:'Undo Recovery Plan',exact:true})).toBeEnabled()
 await panel.getByRole('button',{name:'Undo Recovery Plan',exact:true}).click();await confirm(panel)
 await expect(panel.getByRole('alert')).toContainText('Explicitly resolve')
 expect(await page.evaluate(()=>window.__localPlan.application_status)).toBe('Applied')
 await panel.locator('#resolution-1').fill('Original member independently confirmed availability.')
 await panel.getByRole('button',{name:'Mark disruption 1 resolved',exact:true}).click();await confirm(panel)
 await expect(panel.getByText(/Explicitly resolved/)).toBeVisible()
 await panel.getByRole('button',{name:'Undo Recovery Plan',exact:true}).click();await confirm(panel)
 await expect(panel.getByText('Recovery reversed by the server; review the reopened issue.',{exact:true})).toBeVisible()
 await expect(comparison).not.toContainText('11:00')
 expect(await page.evaluate(()=>window.__localDb.segment_assignments.find(a=>a.id===1).member_id)).toBe(1)
 const calls=await page.evaluate(()=>window.__localCalls.filter(c=>['rpc_simulator_apply_plan','rpc_simulator_resolve_disruption','rpc_simulator_undo_plan'].includes(c.name)))
 expect(calls.map(c=>c.args.p_expected_version)).toEqual([1,2,2,3])
 expect(calls.every(c=>c.args.p_plan_id==='00000000-0000-4000-8000-000000000777')).toBe(true)
 expect(await page.evaluate(()=>window.__audit.map(a=>a.action))).toEqual(['APPLY','DISRUPTION_RESOLVED','UNDO'])
})
test('stale revision refreshes plan history without retrying or claiming success',async({page})=>{
 const panel=await boot(page)
 await page.evaluate(()=>{window.__localPlan.version=2})
 await panel.getByRole('button',{name:'Apply selected recovery',exact:true}).click();await confirm(panel)
 await expect(panel.getByRole('alert')).toContainText('Plan revision changed')
 await expect(panel.getByText(/Revision 2/)).toHaveCount(1)
 expect(await page.evaluate(()=>window.__localCalls.filter(c=>c.name==='rpc_simulator_apply_plan').length)).toBe(1)
 expect(await page.evaluate(()=>window.__localPlan.application_status)).toBe('Draft')
 await expect(panel.getByText('Recovery committed by the server.',{exact:true})).toHaveCount(0)
})
test('authorization failure leaves local records unchanged and reports the backend rejection',async({page})=>{
 const panel=await boot(page);await page.evaluate(()=>{window.__denyOperation=true})
 await panel.getByRole('button',{name:'Apply selected recovery',exact:true}).click();await confirm(panel)
 await expect(panel.getByRole('alert')).toContainText('Event management permission required')
 expect(await page.evaluate(()=>window.__localPlan.application_status)).toBe('Draft')
 expect(await page.evaluate(()=>window.__localDb.segment_assignments.find(a=>a.id===1).member_id)).toBe(1)
})


test('pending acceptance and facility approval block Apply until authoritative fixture statuses refresh',async({page})=>{
 const panel=await boot(page)
 await page.evaluate(()=>{window.__localInvitation.status='Pending';window.__localPlan.actions[0].status='Pending'})
 await panel.getByRole('button',{name:'Refresh persisted history',exact:true}).click()
 const tracker=panel.getByRole('region',{name:'Pending recovery requirements',exact:true})
 await expect(tracker).toContainText('Awaiting response')
 await expect(panel.getByRole('button',{name:'Apply selected recovery',exact:true})).toHaveCount(0)
 await page.evaluate(()=>{window.__localInvitation.status='Accepted';window.__localPlan.actions[0].status='Accepted';window.__localPlan.changes.push({segmentId:1,venueName:'Fixture Original Room',facilityBookingId:1});window.__localPlan.actions.push({kind:'Room',segmentId:1,status:'Pending Approval'})})
 await panel.getByRole('button',{name:'Refresh persisted history',exact:true}).click()
 await expect(tracker).toContainText('Pending Approval')
 await expect(panel.getByRole('button',{name:'Apply selected recovery',exact:true})).toHaveCount(0)
 await page.evaluate(()=>{window.__localPlan.actions.find(a=>a.kind==='Room').status='Approved'})
 await panel.getByRole('button',{name:'Refresh persisted history',exact:true}).click()
 await expect(tracker).toContainText('Ready to apply')
 await expect(panel.getByRole('button',{name:'Apply selected recovery',exact:true})).toBeEnabled()
 expect(await page.evaluate(()=>window.__localCalls.filter(c=>c.name==='rpc_simulator_apply_plan').length)).toBe(0)
 await page.getByRole('button',{name:'Original Plan',exact:true}).click()
 await page.waitForTimeout(1200)
 await expect(page.getByRole('button',{name:'Original Plan',exact:true})).toHaveClass(/btn-secondary/)
})


test('saved recovery views derive readiness and rejection from actual fixture requirements',async({page})=>{
 const panel=await boot(page),views=panel.getByRole('group',{name:'Saved recovery views',exact:true})
 await views.getByRole('button',{name:'Ready to Apply',exact:true}).click()
 await expect(panel.getByRole('button',{name:'Review saved recovery',exact:true})).toHaveCount(1)
 await views.getByRole('button',{name:'Pending',exact:true}).click()
 await expect(panel).toContainText('No recoveries in this view.')
 await page.evaluate(()=>{window.__localInvitation.status='Declined';window.__localPlan.actions[0].status='Declined'})
 await panel.getByRole('button',{name:'Refresh persisted history',exact:true}).click()
 await views.getByRole('button',{name:'Other',exact:true}).click()
 await expect(panel.getByRole('button',{name:'Review saved recovery',exact:true})).toHaveCount(1)
 await expect(panel.getByRole('region',{name:'Pending recovery requirements',exact:true})).toContainText('Declined')
 await expect(panel.getByRole('button',{name:'Apply selected recovery',exact:true})).toHaveCount(0)
})
