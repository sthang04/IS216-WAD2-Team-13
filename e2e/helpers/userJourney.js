// Shared real-app browser steps. Use the visible login/navigation controls and
// auto-wait for page state; never fabricate a session or use fixed sleep delays.
import {expect} from '@playwright/test'
import {openPage} from './navigation.js'
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
// desktop: the full feature name (e.g. 'Day-of Operations'). The mobile argument is kept
// for existing callers; phones now navigate through the ☰ drawer using the same full name.
export async function navigate(page,desktop,_mobile){
 await openPage(page,desktop)
}
export async function fits(page,label){
 await expect.poll(()=>page.evaluate(()=>Math.max(document.documentElement.scrollWidth,
  document.body.scrollWidth)<=innerWidth+1),{message:label+' must fit the viewport'}).toBe(true)
}
