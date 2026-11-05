// BROWSER TEST PURPOSE: application.mobile user workflows and regression coverage.
// Setup opens the real Vue UI; actions use its controls; assertions check visible results/state.
// Uses isolated fixture responses; passing UI checks do not prove deployed database or delivery integration.
import {test,expect} from './fixtures/app.js'
import {room,eventSelect,runDelay,openScheduleForm,fit} from './fixtures/journeys.js'

test('mobile navigation opens actual events and touch simulation selects an activity',async({page,app})=>{
 await app.open('/facilities',{authenticated:true,simulation:true})
 await app.navigate('risk','Event Risk Planning')
 await expect(eventSelect(page).locator('option')).toHaveCount(2)
 await runDelay(page)
 const node=page.getByRole('region',{name:'Scrollable Event Village',exact:true}).locator('.sim-graph-node').first()
 await node.tap()
 await expect(node).toHaveAttribute('aria-pressed','true')
 await fit(page)
})

test('mobile booking confirmation is operable and updates the actual calendar',async({page,app})=>{
 await app.open('/facilities',{authenticated:true,facilities:true})
 await room(page,'Fixture Music Room').getByRole('button',{name:'Claim',exact:true}).tap()
 const dialog=page.getByRole('dialog',{name:'Claim this slot?',exact:true})
 const bounds=await dialog.boundingBox()
 expect(bounds.x).toBeGreaterThanOrEqual(0)
 expect(bounds.x+bounds.width).toBeLessThanOrEqual(page.viewportSize().width+1)
 await dialog.getByRole('button',{name:'Submit claim',exact:true}).tap()
 await expect(room(page,'Fixture Music Room')).toContainText('Awaiting OSL approval')
 await fit(page)
})

test('mobile custom schedule form can create and then remove an entry',async({page,app})=>{
 await app.open('/personal-schedule',{authenticated:true})
 const modal=await openScheduleForm(page,'Fixture mobile schedule')
 await modal.getByRole('button',{name:'Add to Schedule',exact:true}).tap()
 const card=page.locator('.pulse-card').filter({has:page.getByRole('heading',{name:'Fixture mobile schedule',exact:true})})
 await expect(card).toBeVisible()
 await card.getByRole('button',{name:'Delete',exact:true}).tap()
 await expect(page.getByRole('heading',{name:'Fixture mobile schedule',exact:true})).toHaveCount(0)
})

test('mobile notifications open schedule and return through the actual page menu',async({page,app})=>{
 await app.open('/facilities',{authenticated:true,notifications:true})
 await page.getByRole('button',{name:'Notifications, 2 unread',exact:true}).tap()
 await page.getByRole('button',{name:/Fixture schedule update/}).tap()
 await expect(page).toHaveURL(/personal-schedule$/)
 await app.navigate('facilities','Master Facility Calendar')
 await expect(page).toHaveURL(/facilities$/)
 await expect(page.getByRole('button',{name:'Notifications, 1 unread',exact:true})).toBeVisible()
})

test('mobile heatmap remains scrollable and availability updates by touch',async({page,app})=>{
 await app.open('/availability',{authenticated:true,meetings:true})
 const cell=page.locator('.scheduler-grid [role=button]').first()
 await cell.tap()
 await expect(cell).toHaveClass(/slot-mine/)
 const scroll=page.locator('.table-responsive').filter({has:page.getByRole('columnheader',{name:'Time',exact:true})})
 await scroll.evaluate(e=>{e.scrollLeft=e.scrollWidth})
 expect(await scroll.evaluate(e=>e.scrollLeft)).toBeGreaterThan(0)
 await fit(page)
})

test('the whole week and the page tabs fit on a phone without clipping',async({page,app})=>{
 await app.open('/facilities',{authenticated:true,facilities:true})
 const size=page.viewportSize()
 const days=page.locator('.pulse-cal-day')
 await expect(days).toHaveCount(7)
 for(let i=0;i<7;i++){const b=await days.nth(i).boundingBox();expect(b.x).toBeGreaterThanOrEqual(0);expect(b.x+b.width).toBeLessThanOrEqual(size.width)}
 // Facility page tabs (the old bottom-bar pills were replaced by the ☰ drawer):
 // each tab's label is complete and the tab sits fully on screen.
 const tabs=page.getByRole('link',{name:/^(All Facilities|My Club|Waitlist)/})
 await expect(tabs).toHaveCount(3)
 for(const tab of await tabs.all()){
  expect(await tab.evaluate(el=>el.scrollWidth>el.clientWidth+1)).toBe(false)
  const box=await tab.boundingBox()
  expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(size.width)
 }
 // The ☰ menu button must stay reachable at every phone width (it was pushed off-screen at 320px).
 const menu=await page.getByRole('button',{name:'Toggle Navigation Menu',exact:true}).boundingBox()
 expect(menu.x+menu.width).toBeLessThanOrEqual(size.width)
})
