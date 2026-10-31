import {test,expect} from '@playwright/test'
// This harness never contacts Supabase. Test-only gates exercise the real
// component; production service files and SQL release flags remain false.
async function boot(page){
 await page.route('https://**',r=>r.abort())
 await page.route('**/src/services/simulatorWorkflowService.js*',async route=>{
  const response=await route.fetch()
  await route.fulfill({response,body:(await response.text()).replace(/export const SIMULATOR_WORKFLOW_VERIFIED = [^\n]+/,'export const SIMULATOR_WORKFLOW_VERIFIED = true')})
 })
 await page.route('**/src/services/simulationDataService.js*',r=>r.fulfill({contentType:'application/javascript',body:
  "import {campusConnectFixture} from '/e2e-simulator/fixtures/campusConnect.js';export async function loadSimulationData(){return campusConnectFixture()}"}))
 await page.route('**/src/supabase.js*',r=>r.fulfill({contentType:'application/javascript',body:`
  import {campusConnectFixture} from '/e2e-simulator/fixtures/campusConnect.js';
  import {captureSimulatorState} from '/src/services/simulatorWorkflowService.js';
  const d=campusConnectFixture();let saved=null,status='Pending',first=true;
  window.__recoveryCalls=[];
  export const isSupabaseConfigured=()=>true;
  export const supabase={auth:{onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}}},async rpc(name,args){
   window.__recoveryCalls.push({name,args});
   if(name==='rpc_simulator_workflow_capabilities')return {data:{contract_version:4,application_enabled:true,invitations_enabled:true}};
   if(name==='rpc_simulator_plan_history')return {data:{plans:saved?[saved]:[],invitations:[],audit:[]}};
   if(name==='rpc_simulator_my_invitations')return {data:{invitations:[{id:'isolated-invite',event_name:'Isolated consent',status,expires_at:'2099-11-02T00:00:00Z',assignment_snapshot:[]}]}};
   if(name==='rpc_simulator_capture_state')return {data:{state:captureSimulatorState(d,args.p_event_id),fingerprint:'a'.repeat(64)}};
   if(name==='rpc_simulator_start_plan'){
    if(first){first=false;return {error:{message:'Response lost'}}}
    saved={id:'isolated-plan',event_id:args.p_event_id,title:'Saved isolated plan',version:1,lifecycle:'In Progress',application_status:'Draft',changes:args.p_changes,actions:[],before_state:args.p_expected_state};
    return {data:saved};
   }
   if(name==='rpc_simulator_respond_invitation'){status=args.p_response;return {data:{id:args.p_invitation_id,status}}}
   return {error:{message:'No fixture for '+name}};
  }};`}))
 await page.goto('/e2e-simulator/harness.html')
}
test('Start explicitly confirms one action and retries lost response with the same captured UUID',async({page})=>{
 await boot(page)
 await page.getByLabel('Disruption type',{exact:true}).selectOption('SCHEDULE_DELAY')
 await page.getByRole('button',{name:'Run combined simulation (1)',exact:true}).click()
 await page.locator('#persisted-option').selectOption({index:1})
 await page.getByRole('button',{name:'Start Recovery Plan',exact:true}).click()
 const dialog=page.getByLabel('Action confirmation',{exact:true})
 await expect(dialog).toContainText('Start Recovery Plan')
 await expect(dialog.getByRole('button',{name:'Confirm selected action',exact:true})).toBeDisabled()
 expect(await page.evaluate(()=>window.__recoveryCalls.filter(c=>c.name==='rpc_simulator_start_plan').length)).toBe(0)
 await dialog.getByRole('checkbox').check()
 await dialog.getByRole('button',{name:'Confirm selected action',exact:true}).click()
 await expect(page.getByRole('alert')).toContainText('Response lost')
 await page.getByRole('button',{name:'Start Recovery Plan',exact:true}).click()
 await dialog.getByRole('checkbox').check()
 await dialog.getByRole('button',{name:'Confirm selected action',exact:true}).click()
 await expect(page.getByText('Recovery started. Actions are pending; event records have not been changed.',{exact:true})).toBeVisible()
 const calls=await page.evaluate(()=>window.__recoveryCalls)
 const starts=calls.filter(c=>c.name==='rpc_simulator_start_plan')
 expect(starts).toHaveLength(2);expect(starts[0].args).toEqual(starts[1].args)
 expect(calls.filter(c=>c.name==='rpc_simulator_capture_state')).toHaveLength(1)
})
test('discoverable recipient inbox confirms exact response and refreshes persisted status',async({page})=>{
 await boot(page)
 await page.getByRole('link',{name:'My replacement invitations',exact:true}).click()
 const inbox=page.getByRole('region',{name:'My replacement invitations',exact:true})
 await expect(inbox).toContainText('Isolated consent')
 await inbox.getByRole('button',{name:'Accept this invitation',exact:true}).click()
 expect(await page.evaluate(()=>window.__recoveryCalls.filter(c=>c.name==='rpc_simulator_respond_invitation').length)).toBe(0)
 await inbox.getByRole('checkbox').check()
 await inbox.getByRole('button',{name:'Confirm invitation response',exact:true}).click()
 await expect(inbox).toContainText('Response persisted.')
 await expect(inbox).toContainText('Accepted')
 await expect(inbox.getByRole('button',{name:'Accept this invitation',exact:true})).toBeDisabled()
 expect(await page.evaluate(()=>window.__recoveryCalls.filter(c=>c.name==='rpc_simulator_respond_invitation').length)).toBe(1)
})
