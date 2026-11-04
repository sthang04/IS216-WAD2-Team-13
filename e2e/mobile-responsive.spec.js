// Retained responsive journey: viewport sizes come from configuration, including
// all desktop and mobile sizes. A matching heading prevents login redirects passing.
import {test,expect} from '@playwright/test'
import {signIn,fits,navigate} from './helpers/userJourney.js'

test('public and authenticated views fit the configured screen and remain navigable',async({page})=>{
 await page.goto('/')
 await expect(page.locator('input[name="smu_user_login_email"]')).toBeVisible()
 await fits(page,'Landing')
 await signIn(page)
 const pages=[
  ['/facilities','Pulse - Master Facility Calendar'],
  ['/facilities/my-club','My Assigned Bookings'],
  ['/facilities/waitlist','In the queue'],
  ['/personal-schedule',/here is your daily schedule/],
  ['/availability','Weekly Meeting Scheduler'],
  ['/operations','Day-of Operations'],
  ['/events','Scenario Builder'],
 ]
 for(const [path,heading]of pages){
  await page.goto(path)
  await expect(page).toHaveURL(new RegExp(path+'$'))
  await expect(page.getByRole('heading',{name:heading,exact:typeof heading==='string'})).toBeVisible()
  await fits(page,path)
 }
 // Normal clicks verify that the fixed mobile bar leaves header controls reachable.
 await page.getByRole('button',{name:/^Account menu for /}).click()
 await expect(page.getByRole('button',{name:'Sign Out to Landing',exact:true})).toBeVisible()
 await fits(page,'Account menu')
})
