// Retained responsive journey: viewport sizes come from configuration, including
// all desktop and mobile sizes. A matching heading prevents login redirects passing.
import {test,expect} from './helpers/browserUi.js'
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
  ['/personal-schedule',/here is your daily schedule/,'Personal Schedule',/My Schedule/],
  ['/availability','Weekly Meeting Scheduler','Availability Heatmap',/Heatmap/],
  ['/operations','Day-of Operations','Day-of Operations',/Day-of Ops/],
  ['/events','Scenario Builder','Event Risk Planning',/Risk Sandbox/],
 ]
 for(const [path,heading,desktop,mobile]of pages){
  // Follow visible controls in one session instead of repeatedly rebuilding the app.
  if(desktop)await navigate(page,desktop,mobile)
  else if(path.endsWith('my-club'))await page.getByRole('link',{name:'My Club',exact:true}).click()
  else if(path.endsWith('waitlist'))await page.getByRole('link',{name:/^Waitlist/}).click()
  await expect(page).toHaveURL(new RegExp(path+'$'))
  await expect(page.getByRole('heading',{name:heading,exact:typeof heading==='string'})).toBeVisible()
  await fits(page,path)
 }
 // Normal clicks verify that responsive navigation leaves header controls reachable.
 await page.getByRole('button',{name:/^Account menu for /}).click()
 await expect(page.getByRole('button',{name:'Sign Out to Landing',exact:true})).toBeVisible()
 await fits(page,'Account menu')
})
