// Shared real-app browser steps. Use the visible login/navigation controls and
// auto-wait for page state; never fabricate a session or use fixed sleep delays.
import {expect} from '@playwright/test'
export async function signIn(page,name='Rachel Tan'){
 await page.goto('/')
 await page.getByRole('button',{name:/Click here for 1-Click Login/i}).click()
 await page.getByRole('button',{name:new RegExp(name)}).click()
 await expect(page).toHaveURL(/\/facilities$/)
 await expect(page.getByRole('heading',{name:'Pulse - Master Facility Calendar',exact:true})).toBeVisible()
}
export async function navigate(page,desktop,mobile){
 const bar=page.getByRole('navigation',{name:'Mobile PULSE navigation',exact:true})
 if(page.viewportSize().width<1024)await bar.getByRole('button',{name:mobile}).click()
 else await page.getByRole('button',{name:desktop,exact:true}).click()
}
export async function fits(page,label){
 await expect.poll(()=>page.evaluate(()=>Math.max(document.documentElement.scrollWidth,
  document.body.scrollWidth)<=innerWidth+1),{message:label+' must fit the viewport'}).toBe(true)
}
