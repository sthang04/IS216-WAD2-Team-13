import {test,expect} from '@playwright/test'
import {allowedStagingRequest,LOCAL_ORIGIN,STAGING_URL} from './stagingSafety.js'

test('authenticated staging event 990001 loads; Apply/Undo stay gated and schedule is unchanged',async({page,context})=>{
 const blocked=[]
 await context.route('**/*',async route=>{
  const request=route.request()
  if(!allowedStagingRequest(request.url(),request.method())){
   blocked.push({url:new URL(request.url()).origin+new URL(request.url()).pathname,method:request.method()})
   return route.abort()
  }
  return route.continue()
 })
 // Close all sockets: this read-only test needs neither Realtime nor Vite HMR.
 await context.routeWebSocket('**/*',socket=>socket.close())
 await page.goto('/events')
 const authenticated=await page.evaluate(async stagingURL=>{
  const {supabase}=await import('/src/supabase.js')
  if(supabase?.supabaseUrl?.replace(/\/$/,'')!==stagingURL)throw Error('Staging project mismatch; no test operations permitted.')
  const {data,error}=await supabase.auth.getUser()
  return !error&&!!data.user
 },STAGING_URL)
 expect(authenticated,'A valid normal staging login is required; anonymous results are not evidence.').toBe(true)
 await expect(page.locator('#simulation-event option[value="990001"]')).toHaveCount(1)
 await page.locator('#simulation-event').selectOption('990001')
 const snapshot=()=>page.evaluate(async()=>{
  const {supabase}=await import('/src/supabase.js')
  const {data,error}=await supabase.from('event_segments').select('id,starts_at,ends_at').eq('event_id',990001).order('id')
  if(error)throw Error('Staging schedule read was denied or failed.')
  return data
 })
 const before=await snapshot()
 expect(before.length).toBeGreaterThan(0)
 await page.getByRole('link',{name:'Review Update / Undo',exact:true}).click()
 const panel=page.getByRole('region',{name:'Persisted recovery workflow',exact:true})
 await expect(panel).toContainText('Live updates are awaiting backend activation')
 await expect(panel.getByRole('button',{name:'Confirm Recovery',exact:true})).toBeDisabled()
 await expect(panel.getByRole('button',{name:'Undo Recovery Plan',exact:true})).toBeDisabled()
 const historyResponse=page.waitForResponse(r=>r.url()===STAGING_URL+'/rest/v1/rpc/rpc_simulator_plan_history'&&r.request().postDataJSON()?.p_event_id==990001)
 await panel.getByRole('button',{name:'Refresh persisted history',exact:true}).click()
 const response=await historyResponse
 expect(response.ok(),'Staging history RPC must authorize this account.').toBe(true)
 const history=await response.json()
 expect(Array.isArray(history.plans)).toBe(true)
 for(const plan of history.plans){expect(String(plan.event_id)).toBe('990001');expect(Number.isInteger(plan.version)).toBe(true)}
 expect(await snapshot()).toEqual(before)
 expect(blocked,'No production access or mutating endpoint should be requested.').toEqual([])
 test.info().annotations.push({type:'blocked',description:'Actual Apply ? Undo NOT EXECUTED: normal frontend gate remains false; this test verifies authenticated read-only readiness only.'})
})
