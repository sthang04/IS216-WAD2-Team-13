// BROWSER TEST PURPOSE: read Only user workflows and regression coverage.
// Setup opens the real Vue UI; actions use its controls; assertions check visible results/state.
// Uses the configured application/backend; do not replace missing evidence with a passing skip.
import {test,expect} from '@playwright/test'
import {loadEnv} from 'vite'
import {guardReadOnlyBackend} from '../helpers/readOnlyBackend.js'

// Genuine app/browser/backend journeys. No module replacements or fulfilled
// API responses. Environment values are never written to reports or traces.
const env=loadEnv('development',process.cwd(),'VITE_')
const backend=env.VITE_SUPABASE_URL?.trim(),publicKey=env.VITE_SUPABASE_ANON_KEY?.trim()
const hasCredentials=!!(process.env.PULSE_E2E_EMAIL&&process.env.PULSE_E2E_PASSWORD)
let blocked

test.beforeEach(async({context},info)=>{blocked=await guardReadOnlyBackend(context,info.config.metadata.backendOrigin)})
test.afterEach(()=>expect(blocked,'Read-only journeys must never request operational writes').toEqual([]))
// Use normal browser fetch against the configured public Data API. The bearer
// token, when present, comes only from the app's real sign-in/storage state.
async function read(page,path){
 return page.evaluate(async({backend,publicKey,path})=>{
  const ref=new URL(backend).hostname.split('.')[0]
  let session
  try{session=JSON.parse(localStorage.getItem('sb-'+ref+'-auth-token')||'null')}catch{}
  const response=await fetch(backend+path,{headers:{apikey:publicKey,Authorization:'Bearer '+(session?.access_token||publicKey)}})
  return {ok:response.ok,status:response.status,data:await response.json()}
 },{backend,publicKey,path})
}
async function authenticated(page){const result=await read(page,'/auth/v1/user');return result.ok&&!!result.data?.id}
async function signInNormally(page){
 if(await authenticated(page))return true
 if(hasCredentials){
  await page.locator('input[name="smu_user_login_email"]').fill(process.env.PULSE_E2E_EMAIL)
  await page.locator('input[name="smu_user_password"]').fill(process.env.PULSE_E2E_PASSWORD)
  await page.locator('form button[type="submit"]').click()
  await expect.poll(()=>authenticated(page),{message:'Configured account must obtain a genuine Supabase Auth session.'}).toBe(true)
 }else{
  // The app publicly offers a normal one-click demo-account login. Exercise
  // that UI if present; its local-persona fallback is NEVER accepted as auth.
  const drawer=page.getByRole('button',{name:/Click here for 1-Click Login/})
  if(!await drawer.isVisible())return false
  await drawer.click()
  const account=page.getByRole('button',{name:/Rachel Tan/})
  if(!await account.isVisible())return false
  const completed=page.waitForResponse(r=>r.url().startsWith(backend+'/auth/v1/token')).catch(()=>null)
  await account.click()
  const response=await completed
  if(!response?.ok())return false
  await expect.poll(()=>authenticated(page)).toBe(true)
 }
 // Wait for the app to finish applying the session before the next page load.
 await expect(page).toHaveURL(/\/facilities$/)
 return authenticated(page)
}

test('actual Vue application exposes its normal sign-in UI',async({page})=>{
 // Setup: launch the actual Vue app at the supplied URL.
 await page.goto('/')
 // Actions: inspect the real initial UI; no fixture app is loaded.
 // Assert: sign-in or an existing authenticated application shell is present.
 await expect(page.locator('#app')).not.toBeEmpty()
 if(!process.env.PULSE_E2E_STORAGE_STATE)await expect(page.locator('input[name="smu_user_login_email"]')).toBeVisible()
})

test('browser reads actual accessible facility records from configured Supabase [backend smoke]',async({page})=>{
 // Setup: browser uses the app's configured project and public API key.
 expect(backend && publicKey, 'Configured backend URL/key are required').toBeTruthy()
 await page.goto('/')
 // Actions: perform a genuine anonymous or signed-in read, never a mock.
 const response=await read(page,'/rest/v1/facilities?select=id,name&is_active=eq.true')
 // Assert: real backend records; this smoke check is not a simulator workflow.
 expect(response.ok,'Actual facilities Data API read must succeed').toBe(true)
 expect(Array.isArray(response.data)).toBe(true)
 expect(response.data.length).toBeGreaterThan(0)
 for(const row of response.data){expect(row.id).toBeTruthy();expect(typeof row.name).toBe('string')}
})

test('real authenticated event selection and history refresh use accessible backend records',async({page})=>{
 // Setup: the real app obtains its normal Supabase session.
 expect(backend && publicKey, 'Configured backend URL/key are required').toBeTruthy()
 await page.goto('/')
 expect(await signInNormally(page), 'Authorized backend session is required').toBe(true)
 await page.goto('/events')
 const picker=page.getByRole('region',{name:'Scenario builder',exact:true}).getByLabel('Event',{exact:true})
 await expect(picker).toBeEnabled()
 // Actions: select a persisted event through the UI, without a fixed event ID.
 const ids=await picker.locator('option:not([disabled])').evaluateAll(options=>options.map(o=>o.value).filter(Boolean))
 expect(ids.length, 'Account needs an accessible saved event').toBeGreaterThan(0)
 await picker.selectOption(ids[0])
 // Assert: that exact engine event identity exists in actual Supabase records.
 const records=await read(page,'/rest/v1/events?select=id&order=id')
 expect(records.ok).toBe(true)
 expect(records.data.some(e=>String(e.id)===ids[0])).toBe(true)
 const saved=page.locator('#simulator-saved-recoveries')
 if(await saved.count())await saved.locator(':scope > summary').click()
 const received=page.waitForResponse(r=>r.url().startsWith(backend+'/rest/v1/rpc/rpc_simulator_plan_history'))
 await page.getByRole('button',{name:/^Refresh (statuses|persisted history)$/}).click()
 const response=await received
 expect(response.ok()).toBe(true)
 const history=await response.json()
 expect(Array.isArray(history.plans)).toBe(true)
 for(const plan of history.plans)expect(String(plan.event_id)).toBe(ids[0])
})

test('real authenticated simulator loads events, calculates a preview and refreshes history without task writes',async({page})=>{
 // Setup: normal sign-in or supplied storage state. No fabricated credentials.
 expect(backend && publicKey, 'Configured backend URL/key are required').toBeTruthy()
 await page.goto('/')
 const signedIn=await signInNormally(page)
 expect(signedIn, 'Genuine backend authentication is required').toBe(true)
 await page.goto('/events')
 await expect(page.getByRole('heading',{name:'Scenario Builder',exact:true})).toBeVisible()
 const picker=page.getByRole('region',{name:'Scenario builder',exact:true}).getByLabel('Event',{exact:true})
 await expect(picker).toBeEnabled()
 await expect(picker.locator('option')).not.toHaveCount(0)
 const source=await read(page,'/rest/v1/ops_tasks?select=*&order=id')
 const originalSegments=await read(page,'/rest/v1/event_segments?select=id,starts_at,ends_at&order=id')
 expect(originalSegments.ok).toBe(true)
 expect(source.ok).toBe(true)
 // Actions: select an actual accessible event with real activity choices.
 const events=await picker.locator('option').evaluateAll(options=>options.map(o=>o.value).filter(Boolean))
 test.info().annotations.push({type:'data-evidence',description:JSON.stringify({events:events.length,opsTasks:source.data.length,activities:originalSegments.data.length})})
 // Moving to another event discards only these hypothetical inputs. Accept
 // the app's normal discard prompt; no database confirmation is requested.
 const discard=dialog=>dialog.accept()
 page.on('dialog',discard)
 let task
 for(const id of events){
  await picker.selectOption(id)
  await page.getByLabel('Disruption type',{exact:true}).selectOption('SCHEDULE_DELAY')
  const options=page.getByLabel('Delayed activity',{exact:true}).locator('option:not([disabled])').filter({hasNotText:/^Select /})
  if(await options.count()){task=await options.first().getAttribute('value');break}
 }
 page.off('dialog',discard)
 expect(task, 'Account needs an event with movable activities').toBeTruthy()
 await page.getByLabel('Delayed activity',{exact:true}).selectOption(task)
 await page.getByLabel('Delay (minutes)',{exact:true}).fill('15')
 await page.getByRole('button',{name:/^Run (combined )?simulation \(1\)$/}).click()
 // Assert: actual Vue calculation is visible and persisted Ops tasks unchanged.
 await expect(page.getByText('Simulation complete',{exact:true})).toBeVisible()
 await expect(page.getByTestId('impact-total')).toBeVisible()
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),{message:'The actual simulator page must fit its desktop/mobile viewport.'}).toBe(true)
 await page.getByRole('button',{name:'Activity List',exact:true}).click()
 await expect(page.getByRole('group',{name:'Activity List',exact:true}).getByRole('button').first()).toBeVisible()
 await page.getByRole('button',{name:'Village',exact:true}).click()
 const timeline=page.locator('#impact-timeline')
 if(await timeline.evaluate(e=>e.tagName==='DETAILS'&&!e.open))await timeline.locator(':scope > summary').click()
 await expect(page.getByRole('slider',{name:'Timeline playback time',exact:true})).toBeVisible()
 const after=await read(page,'/rest/v1/ops_tasks?select=*&order=id')
 expect(after.ok).toBe(true);expect(after.data).toEqual(source.data)
 const afterSegments=await read(page,'/rest/v1/event_segments?select=id,starts_at,ends_at&order=id')
 expect(afterSegments.ok).toBe(true);expect(afterSegments.data).toEqual(originalSegments.data)
 // Actions: request real history using the visible workflow control.
 const saved=page.locator('#simulator-saved-recoveries')
 if(await saved.count())await saved.locator(':scope > summary').click()
 const historyResponse=page.waitForResponse(r=>r.url().startsWith(backend+'/rest/v1/rpc/rpc_simulator_plan_history'))
 await page.getByRole('button',{name:/^Refresh (statuses|persisted history)$/}).click()
 // Assert: this user's real backend permissions authorize history reads.
 const history=await historyResponse
 expect(history.ok()).toBe(true)
 expect(Array.isArray((await history.json()).plans)).toBe(true)
})
