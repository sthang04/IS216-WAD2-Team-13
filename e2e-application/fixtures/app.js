// SUPPORT FILE PURPOSE: app.js supplies shared setup or controlled data for the browser workflows.
// Keep this support code: the Playwright tests depend on consistent setup and isolated state.
import {test as base,expect} from '../../e2e/helpers/browserUi.js'
import {readFileSync} from 'node:fs'
import {openPage} from '../../e2e/helpers/navigation.js'

const client=readFileSync(new URL('./client.js',import.meta.url),'utf8')
const ORIGIN='http://127.0.0.1:5188'

export const test=base.extend({
 // Automatic so a future test cannot accidentally omit the network guard.
 app:[async({page,context},use)=>{
  const external=[],errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await context.route('**/*',route=>{
   const url=new URL(route.request().url())
   // Supply external font CSS locally; never forward it to Google.
   if(url.hostname==='fonts.googleapis.com' && route.request().method()==='GET'){
    return route.fulfill({contentType:'text/css',body:''})
   }
   // OneMap geocoding is a public third-party API called from the schedule's walk-time feature.
   // Answer it locally with a deterministic coordinate per venue name, so walk times are
   // stable and offline; the onemap-walk Edge Function stub in client.js returns the route.
   if(url.hostname==='www.onemap.gov.sg' && url.pathname==='/api/common/elastic/search' && route.request().method()==='GET'){
    const name=url.searchParams.get('searchVal')||''
    const offset=[...name].reduce((sum,char)=>sum+char.charCodeAt(0),0)%50/10000
    return route.fulfill({contentType:'application/json',
     body:JSON.stringify({found:1,results:[{SEARCHVAL:name,LATITUDE:String(1.2960+offset),LONGITUDE:String(103.8500+offset)}]})})
   }
   if(url.origin===ORIGIN && ['GET','HEAD'].includes(route.request().method())){
    return route.continue()
   }
   external.push({origin:url.origin,method:route.request().method()})
   return route.abort()
  })
  await context.routeWebSocket('**/*',socket=>socket.close())
  await context.route(url=>url.origin===ORIGIN && url.pathname==='/src/supabase.js',
   route=>route.fulfill({contentType:'application/javascript',body:client}))
  await page.clock.setFixedTime(new Date('2026-11-03T10:00:00+08:00'))
  const app={
   async open(path='/',config={}){
    await page.addInitScript(config=>{
     if(!sessionStorage.getItem('pulse-foundation-initialized')){
      sessionStorage.setItem('pulse-foundation-initialized','true')
      sessionStorage.setItem('pulse-foundation-config',JSON.stringify(config))
      if(!config.collapsedFacilities)sessionStorage.setItem('pulse-open-facilities','"all"')
      if(config.authenticated){
       sessionStorage.setItem('pulse-foundation-session',JSON.stringify({
        id:'fixture-user',email:config.email||'fixture.exco@smu.edu.sg'}))
      }
     }
    },config)
    await page.goto(path)
   },
   async login(password='FixturePass123!'){
    // Product login labels are not associated with inputs.
    await page.locator('input[name="smu_user_login_email"]').fill('fixture.exco@smu.edu.sg')
    await page.locator('input[name="smu_user_password"]').fill(password)
    await page.locator('form button[type="submit"]').click()
   },
   async account(){
    await page.getByRole('button',{name:'Account menu for Fixture Exco',exact:true}).click()
   },
   // Navigate the way a real user would at the current screen size.
   async navigate(view,label){
    await openPage(page,view,label)
   },
  }
  try{await use(app)}
  finally{
   expect(external,'No external or HTTP mutation requests are permitted').toEqual([])
   expect(errors,'Unhandled application errors').toEqual([])
   if(!page.isClosed()){
    const faults=await page.evaluate(()=>window.__foundation?.unexpected() || [])
    expect(faults,'Unimplemented synthetic backend requests must not silently pass').toEqual([])
   }
  }
 },{auto:true}],
})
export {expect}
