import {test,expect} from '@playwright/test'
// Only this isolated page receives the test flag. Production source stays OFF.
test('original booking discovery, explicit association and refresh enable the real facility input',async({page})=>{
 await page.route('https://**',r=>r.abort())
 await page.route('**/src/services/simulatorOriginalBookingService.js*',async route=>{
  const response=await route.fetch();const body=(await response.text()).replace(/ORIGINAL_BOOKING_LINK_VERIFIED\s*=\s*false/,'ORIGINAL_BOOKING_LINK_VERIFIED=true')
  await route.fulfill({response,body})
 })
 await page.route('**/src/services/simulationDataService.js*',route=>route.fulfill({contentType:'application/javascript',body:
  "import {campusConnectFixture} from '/e2e-simulator/fixtures/campusConnect.js';export async function loadSimulationData(){const d=campusConnectFixture('unlinked');d.facility_bookings[0].status='Officially Confirmed Booking';d.facility_slots[0].status='Officially Confirmed Booking';if(window.__originalLinked){d.segment_facility_slots=[{segment_id:1,facility_slot_id:1}];d.segment_facility_bookings=[{segment_id:1,booking_id:1}]}return d}"}))
 await page.route('**/src/supabase.js*',route=>route.fulfill({contentType:'application/javascript',body:`
  window.__originalWrites=[];
  export const isSupabaseConfigured=()=>true;
  export const supabase={auth:{onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}},async getUser(){return {data:{user:{id:'isolated-fixture'}}}}},async rpc(name,args){
   if(name==='rpc_simulator_original_booking_candidates')return {data:{event_id:args.p_event_id,segment_id:args.p_segment_id,event_fingerprint:'a'.repeat(64),bookings:[{
    booking_id:1,facility_id:1,facility_name:'Fixture Original Room',booking_date:'2026-11-02',start_time:'10:00:00',end_time:'14:00:00',owner_club_id:1,status:'Officially Confirmed Booking',capacity:50,capacity_verified:false,manual_suitability_required:true,verification_required:['Audience requires manual verification'],minimum_capacity:1,eligible:true,reasons:[],booking_fingerprint:'b'.repeat(64)}]}};
   if(name==='rpc_simulator_link_original_booking'){window.__originalWrites.push(args);window.__originalLinked=true;return {data:{linked:true,event_id:args.p_event_id,segment_id:args.p_segment_id,booking_id:args.p_booking_id}}}
   if(name==='rpc_simulator_my_invitations')return {data:{invitations:[{id:'fixture-invitation',event_name:'ISOLATED invitation',status:'Pending',expires_at:'2099-11-02T10:00:00Z',assignment_snapshot:[{assignment_id:1,activity:'Fixture activity',role_name:'Performer',starts_at:'2026-11-02T10:00:00Z',ends_at:'2026-11-02T11:00:00Z'}]}]}};
   return {error:{message:'Unexpected fixture call: '+name}}
  }};`}))
 await page.goto('/e2e-simulator/harness.html')
 await page.getByLabel('Disruption type',{exact:true}).selectOption('FACILITY_UNAVAILABLE')
 await expect(page.getByLabel('Unavailable facility',{exact:true}).locator('option')).toHaveCount(0)
 await page.getByRole('button',{name:'Manage facility setup',exact:true}).click()
 await page.getByRole('button',{name:'Find eligible original bookings',exact:true}).click()
 await page.getByRole('radio').check()
 await expect(page.getByRole('button',{name:'Link approved booking to activity',exact:true})).toBeDisabled()
 expect(await page.evaluate(()=>window.__originalWrites)).toEqual([])
 await page.getByLabel('I confirm this booking and activity, actual audience capacity, required equipment and suitability.',{exact:true}).check()
 await page.getByRole('button',{name:'Link approved booking to activity',exact:true}).click()
 await expect.poll(()=>page.evaluate(()=>window.__originalWrites.length)).toBe(1)
 await page.getByRole('button',{name:'Return to simulator',exact:true}).click()
 await page.getByLabel('Disruption type',{exact:true}).selectOption('FACILITY_UNAVAILABLE')
 await expect(page.getByLabel('Unavailable facility',{exact:true})).toHaveValue('1')
 await page.getByLabel('Unavailable from (Singapore)',{exact:true}).fill('2026-11-02T10:00')
 await page.getByLabel('Unavailable until (Singapore)',{exact:true}).fill('2026-11-02T10:30')
 await page.getByRole('button',{name:'Run combined simulation (1)',exact:true}).click()
 await expect(page.getByTestId('facility-alternative')).toHaveCount(1)
 await expect(page.getByRole('button',{name:'Apply selected recovery',exact:true})).toHaveCount(0)
 await page.goto('/e2e-simulator/harness.html?panel=invitations')
 await page.getByRole('button',{name:'Refresh my invitations',exact:true}).click()
 await expect(page.getByText('ISOLATED invitation',{exact:true})).toBeVisible()
 await expect(page.getByRole('button',{name:'Accept this invitation',exact:true})).toBeDisabled()
 // Inbox navigation starts a new document; earlier assertions verified the single booking write.
})
