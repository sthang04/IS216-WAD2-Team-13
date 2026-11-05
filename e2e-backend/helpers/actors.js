// Real browser actors and real Data API reads for write E2E journeys.
// Setup/cleanup can use authenticated HTTP; all task actions in specs use the UI.
// No application module, session, response or database result is fabricated.
import {loadEnv} from 'vite'
import {test as base,expect} from '../../e2e/helpers/browserUi.js'
const env=loadEnv('live-e2e',process.cwd(),'')
const backend=env.VITE_SUPABASE_URL||'',key=env.VITE_SUPABASE_ANON_KEY||''
const origin='http://127.0.0.1:5187'
const roles=['owner','claimant','participant','outsider','admin']
export const test=base.extend({
 world:async({browser},use,info)=>{
  expect(backend,'Configure .env.live-e2e.local for the dedicated test backend').toBe('https://xbtauyiinkrxvfrqakbw.supabase.co')
  expect(key,'Staging publishable key is required').toBeTruthy()
  expect(env.PULSE_E2E_PASSWORD,'Dedicated test-account password is required').toBeTruthy()
  const actors=new Map(),forbidden=[],runtimeErrors=[],cleanups=[]
  const index=[[1280,800],[1440,900],[1920,1080],[390,844],[375,667],[320,568]].findIndex(([w,h])=>w===info.project.use.viewport.width&&h===info.project.use.viewport.height)
  expect(index).toBeGreaterThanOrEqual(0)
  async function actor(role){
   if(actors.has(role))return actors.get(role)
   expect(roles).toContain(role)
   const email=env['PULSE_E2E_'+role.toUpperCase()+'_EMAIL']
   expect(email,'Missing dedicated '+role+' test account').toBeTruthy()
   const context=await browser.newContext({baseURL:origin,viewport:info.project.use.viewport,isMobile:!!info.project.use.isMobile,hasTouch:!!info.project.use.hasTouch,timezoneId:'Asia/Singapore',serviceWorkers:'block'})
   // Guard destinations without replacing real backend responses. Delivery is not exercised.
   await context.route('**/*',route=>{
    const url=new URL(route.request().url())
    if((url.hostname.endsWith('.supabase.co')&&url.origin!==backend)||/^\/functions\/v1\/(send-|telegram-webhook)/.test(url.pathname)){forbidden.push(url.origin+url.pathname);return route.abort()}
    return route.continue()
   })
   const page=await context.newPage()
   page.on('pageerror',error=>runtimeErrors.push(error.message))
   const value={page,context,memberId:Number(env['PULSE_E2E_'+role.toUpperCase()+'_MEMBER_ID'])}
   actors.set(role,value)
   await page.goto('/')
   // A real form login must obtain a genuine Supabase Auth token; demo fallback cannot pass.
   const received=page.waitForResponse(r=>r.url().startsWith(backend+'/auth/v1/token')&&r.request().method()==='POST')
   await page.locator('input[name="smu_user_login_email"]').fill(email)
   await page.locator('input[name="smu_user_password"]').fill(env.PULSE_E2E_PASSWORD)
   await page.locator('form button[type=submit]').click()
   const response=await received;expect(response.ok(),'Real test-account sign-in succeeds').toBe(true)
   const session=await response.json();expect(session.user.email).toBe(email)
   const headers={apikey:key,Authorization:'Bearer '+session.access_token}
   const auth=await context.request.get(backend+'/auth/v1/user',{headers})
   expect(auth.ok()).toBe(true);expect((await auth.json()).id).toBe(session.user.id)
   await expect(page).toHaveURL(/\/facilities$/)
   await expect.poll(()=>page.evaluate(()=>localStorage.getItem('pulse_session')),{message:'The app must use authenticated membership, not a local demo persona'}).toBeNull()
   value.get=async path=>{const r=await context.request.get(backend+path,{headers});expect(r.ok(),'Backend read '+path.split('?')[0]).toBe(true);return r.json()}
   value.rpcRaw=(name,data)=>context.request.post(backend+'/rest/v1/rpc/'+name,{headers,data})
   value.rpc=async(name,data)=>{const r=await value.rpcRaw(name,data);if(!r.ok())throw Error(name+' refused: '+await r.text());return r.status()===204?null:r.json()}
   // Test-data preparation uses the same authenticated account and its normal table policies.
   value.insert=async(table,data)=>{const r=await context.request.post(backend+'/rest/v1/'+table,{headers:{...headers,Prefer:'return=representation'},data});if(!r.ok())throw Error(table+' setup refused: '+await r.text());return r.json()}
   value.remove=async(table,query)=>{const r=await context.request.delete(backend+'/rest/v1/'+table+'?'+query,{headers});expect(r.ok()).toBe(true)}
   value.patch=(table,query,data)=>context.request.patch(backend+'/rest/v1/'+table+'?'+query,{headers:{...headers,Prefer:'return=representation'},data})
   return value
  }
  const bookingId=980101+index
  async function booking(){return (await (await actor('owner')).get('/rest/v1/v_master_facility_calendar?booking_id=eq.'+bookingId))[0]}
  async function restoreBooking(){
   // Compensating cleanup uses the normal authorised RPCs and preserves append-only audit history.
   for(let step=0;step<5;step++){
    const row=await booking();if(!row)throw Error('Reserved E2E booking is missing')
    if(row.status==='Pending Admin Sign-off'){await (await actor('admin')).rpc('rpc_reject_transfer',{p_transfer_id:row.transfer_id,p_reason:'Playwright cleanup',p_demo_member_id:null});continue}
    if(row.status==='Proposed Peer Transfer'){await (await actor(row.owner_club_id===5?'owner':'claimant')).rpc('rpc_undo_release',{p_booking_id:bookingId,p_club_id:row.owner_club_id,p_demo_member_id:null});continue}
    if(row.owner_club_id===5&&['Booked','Officially Confirmed Booking'].includes(row.status)){
     // The final UI intentionally offers no re-release on confirmed bookings.
     // A staging-only, administrator-checked fixture helper restores its Booked starting state.
     if(row.status==='Officially Confirmed Booking')await (await actor('admin')).rpc('rpc_e2e_restore_booking',{p_booking_id:bookingId})
     return
    }
    if(row.owner_club_id===10){
     await (await actor('claimant')).rpc('rpc_release_booking',{p_booking_id:bookingId,p_club_id:10,p_demo_member_id:null})
     await (await actor('owner')).rpc('rpc_claim_booking',{p_booking_id:bookingId,p_club_id:5,p_demo_member_id:null})
     const pending=await booking();await (await actor('admin')).rpc('rpc_approve_transfer',{p_transfer_id:pending.transfer_id,p_demo_member_id:null});continue
    }
    throw Error('Unexpected reserved booking state: '+row.status)
   }
   throw Error('Reserved booking could not be restored')
  }
  try{await use({actor,bookingId,booking,restoreBooking,onCleanup:fn=>cleanups.push(fn),origin})}
  finally{
   const failures=[]
   for(const cleanup of cleanups.reverse())try{await cleanup()}catch(error){failures.push(String(error))}
   for(const value of actors.values())await value.context.close()
   expect(forbidden,'No production backend writes or message-delivery calls').toEqual([])
   expect(runtimeErrors,'Real application pages have no uncaught runtime errors').toEqual([])
   expect(failures,'Dedicated test records must be restored through authorised APIs').toEqual([])
  }
 }
})
export {expect}
