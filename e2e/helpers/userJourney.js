// Shared real-app browser steps. Use the visible login/navigation controls and
// auto-wait for page state; never fabricate a session or use fixed sleep delays.
import {expect} from '@playwright/test'
export async function signIn(page,name='Rachel Tan'){
 await page.goto('/')
 await page.evaluate(()=>{
  localStorage.clear()
  sessionStorage.clear()
 })
 await page.reload()
 const drawer = page.getByRole('button',{name:/Try a demo account/i})
 await expect(drawer).toBeVisible({timeout:45000})
 await drawer.click()
 await page.getByRole('button',{name:new RegExp(name)}).click()
 await expect(page).toHaveURL(/\/facilities$/,{timeout:45000})
 await expect(page.getByRole('heading',{name:'Pulse - Master Facility Calendar',exact:true})).toBeVisible({timeout:45000})
}
export async function navigate(page,desktop,mobile){
 const bar=page.getByRole('navigation',{name:'Mobile PULSE navigation',exact:true})
 if(page.viewportSize().width<1024)await bar.getByRole('button',{name:mobile}).click()
 else {
  // The compact desktop header omits prefixes while retaining the same route action.
  const names={'Day-of Operations':/^(Day-of )?Operations$/,'Personal Schedule':/^(Personal )?Schedule$/,'Master Facility Calendar':/^(Master )?Facility Calendar$/,'Availability Heatmap':/^(Availability )?Heatmap$/,'Event Risk Planning':/^(Event )?Risk Planning$/}
  await page.getByRole('button',{name:names[desktop]||desktop,exact:true}).click()
 }
}
export async function fits(page,label){
 await expect.poll(()=>page.evaluate(()=>Math.max(document.documentElement.scrollWidth,
  document.body.scrollWidth)<=innerWidth+1),{message:label+' must fit the viewport'}).toBe(true)
}
