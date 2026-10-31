import {test,expect} from '@playwright/test'
async function boot(page,canManage=true){
 page.on('pageerror',error=>console.log('ISOLATED calendar error: '+error.message))
 await page.route('https://**',route=>route.abort())
 await page.route('**/src/services/simulationDataService.js*',route=>route.fulfill({contentType:'application/javascript',
  body:"import {campusConnectFixture} from '/e2e-simulator/fixtures/campusConnect.js'; export async function loadSimulationData(){return campusConnectFixture()}"}))
 // Synthetic session and query client ONLY in this isolated browser harness.
 // The real calendar, bookingActions and confirmation flow still run.
 await page.route('**/src/services/sessionState.js*',route=>route.fulfill({contentType:'application/javascript',body:
  "import {ref,computed} from '/node_modules/.vite/deps/vue.js'; export const session=ref({activeClubId:1,memberId:1,authUserId:'fixture',memberships:[{club_id:1}],isOslAdmin:false});export const activeMembership=ref({club_name:'Fixture Club',can_claim_booking:"+canManage+"});export const activeClubName=ref('Fixture Club');export const canManageActiveClub=ref("+canManage+");export const toast=ref({});export const showToast=()=>{};export const demoMemberId=()=>null;"}))
 await page.route('**/src/supabase.js*',route=>route.fulfill({contentType:'application/javascript',body:`
  import {campusConnectFixture} from '/e2e-simulator/fixtures/campusConnect.js';
  const d=campusConnectFixture();window.__calendarWrites=[];
  const facilities=[...d.facilities,{id:3,name:'Other fixture room',capacity:40,is_active:true}];
  const rows=d.facility_bookings.map(b=>({...b,booking_id:b.id,facility_name:facilities.find(f=>f.id===b.facility_id).name,
    owner_club_id:b.id===2?2:b.owner_club_id,is_transfer_window_open:true}));
  rows.push({...rows[1],booking_id:22,start_time:'15:00:00',end_time:'16:00:00'});
  rows.push({...rows[1],booking_id:33,facility_id:3,facility_name:'Other fixture room'});
  export const isSupabaseConfigured=()=>true;
  export const supabase={
    from(table){const result={data:table==='facilities'?facilities:table==='v_master_facility_calendar'?rows:[],error:null};
      const q={then(resolve,reject){return Promise.resolve(result).then(resolve,reject)}};
      for(const key of ['select','eq','in','gte','lte','order'])q[key]=()=>q;return q},
    async rpc(name,args){if(name==='rpc_simulator_workflow_capabilities')return {data:{contract_version:4,application_enabled:false,invitations_enabled:false}};if(name==='rpc_simulator_plan_history')return {data:{plans:[],invitations:[],audit:[]},error:null};if(name==='rpc_simulator_my_invitations')return {data:{invitations:[]},error:null};if(name==='cfg_text')return {data:'2026-12-31',error:null};window.__calendarWrites.push({name,args});return {data:{},error:null}},
    channel(){const q={on(){return q},subscribe(){return q}};return q},removeChannel(){}
  };`}))
 await page.goto('/e2e-simulator/harness.html')
 await page.getByLabel('Disruption type',{exact:true}).selectOption('FACILITY_UNAVAILABLE')
 await page.getByLabel('Unavailable from (Singapore)',{exact:true}).fill('2026-11-02T10:00')
 await page.getByLabel('Unavailable until (Singapore)',{exact:true}).fill('2026-11-02T10:30')
 await page.getByRole('button',{name:'Run combined simulation (1)',exact:true}).click()
 await page.getByTestId('facility-alternative').getByRole('link',{name:'View / Request this facility',exact:true}).click()
}
test('recommendation opens the real calendar at facility/time; claim still requires normal confirmation',async({page})=>{
 await boot(page)
 await expect(page.getByTestId('simulator-calendar-focus')).toContainText('Fixture Alternative Room')
 await expect(page.getByTestId('simulator-calendar-focus')).toContainText('Requested (Singapore)')
 await expect(page.getByRole('heading',{name:'Fixture Original Room',exact:true})).toHaveCount(0)
 await expect(page.getByRole('heading',{name:'Other fixture room',exact:true})).toHaveCount(0)
 await expect(page.getByRole('heading',{name:'Fixture Alternative Room',exact:true})).toBeVisible()
 await expect(page.getByRole('button',{name:'Claim',exact:true})).toHaveCount(1)
 expect(await page.evaluate(()=>window.__calendarWrites)).toEqual([])
 await page.getByRole('button',{name:'Claim',exact:true}).click()
 await expect(page.getByText('Claim this slot?',{exact:true})).toBeVisible()
 expect(await page.evaluate(()=>window.__calendarWrites)).toEqual([])
 await page.getByRole('button',{name:'Submit claim',exact:true}).click()
 await expect.poll(()=>page.evaluate(()=>window.__calendarWrites.filter(c=>c.name==='rpc_claim_booking').length)).toBe(1)
 const call=await page.evaluate(()=>window.__calendarWrites.find(c=>c.name==='rpc_claim_booking'))
 expect(call.args.p_booking_id).toBe(2);expect(call.args.p_club_id).toBe(1)
})
test('focused calendar cannot grant claim permission and clearing focus restores other rooms',async({page})=>{
 await boot(page,false)
 await expect(page.getByTestId('simulator-calendar-focus')).toBeVisible()
 await expect(page.getByRole('button',{name:'Claim',exact:true})).toHaveCount(0)
 expect(await page.evaluate(()=>window.__calendarWrites)).toEqual([])
 await page.getByRole('button',{name:'Clear simulator focus',exact:true}).click()
 await expect(page.getByTestId('simulator-calendar-focus')).toHaveCount(0)
 await expect(page.getByRole('heading',{name:'Fixture Original Room',exact:true})).toBeVisible()
 expect(await page.evaluate(()=>window.__calendarWrites)).toEqual([])
})
test('combined member/facility recommendations retain the relevant roster warning',async({page})=>{
 await page.route('https://**',route=>route.abort())
 await page.route('**/src/services/simulationDataService.js*',route=>route.fulfill({contentType:'application/javascript',
  body:"import {campusConnectFixture} from '/e2e-simulator/fixtures/campusConnect.js'; export async function loadSimulationData(){return campusConnectFixture()}"}))
 await page.goto('/e2e-simulator/harness.html')
 await page.getByRole('button',{name:'Add disruption',exact:true}).click()
 await page.getByLabel('Disruption type',{exact:true}).nth(1).selectOption('FACILITY_UNAVAILABLE')
 for(const label of ['Unavailable from (Singapore)','Unavailable until (Singapore)']){
  const value=label.startsWith('Unavailable from')?'2026-11-02T10:00':'2026-11-02T10:30'
  await page.getByLabel(label,{exact:true}).nth(0).fill(value);await page.getByLabel(label,{exact:true}).nth(1).fill(value)
 }
 await page.getByRole('button',{name:'Run combined simulation (2)',exact:true}).click()
 await expect(page.getByText(/Club roster loaded. Timetable coverage is incomplete/)).toBeVisible()
 await expect(page.getByTestId('facility-alternative')).toHaveCount(1)
})
