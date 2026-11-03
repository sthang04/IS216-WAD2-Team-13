import {test as base,expect} from '@playwright/test'
import {readFileSync} from 'node:fs'

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
      if(config.authenticated){
       sessionStorage.setItem('pulse-foundation-session',JSON.stringify({
        id:'fixture-user',email:'fixture.exco@smu.edu.sg'}))
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
   async navigate(view,label){
    const mobile=page.getByLabel('Navigate PULSE',{exact:true})
    if(await mobile.isVisible())await mobile.selectOption(view)
    else await page.getByRole('button',{name:label,exact:true}).click()
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
