// UI regressions follow the setup -> Actions -> Assert pattern.
// The real Vue screens run with synthetic API data; these checks do not send messages or real bookings.
import {test,expect} from './app.js'
import {room} from './journeys.js'
import {assertTextNotClipped,assertElementsNotOverlapping} from '../../e2e/helpers/browserUi.js'

// Visibility alone permits clipped elements. Check their complete viewport bounds
// and hit-test their centre so an overlapping layer cannot conceal the control.
async function fitsScreen(page,locator,label){
 await expect(locator).toBeVisible()
 await expect.poll(async()=>{
  const box=await locator.boundingBox(),size=page.viewportSize()
  return !!box && box.x>=0 && box.y>=0 && box.x+box.width<=size.width+1 && box.y+box.height<=size.height+1
 },{message:label+' stays completely inside the screen'}).toBe(true)
 // Inspect the open panel state before the workflow closes it.
 await assertTextNotClipped(page,locator)
 await assertElementsNotOverlapping(page,locator)
}
async function reachable(page,locator,label){
 await fitsScreen(page,locator,label)
 await expect(locator).toBeInViewport({ratio:1})
 await expect.poll(()=>locator.evaluate(element=>{
  const r=element.getBoundingClientRect()
  const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)
  return hit!==null && (element===hit||element.contains(hit))
 }),{message:label+' is not covered by another element'}).toBe(true)
}
const bell=page=>page.getByRole('button',{name:/^Notifications, [0-9]+ unread$/})
const panel=page=>page.getByRole('region',{name:'Notifications',exact:true})

export function registerUiJourneys(){
 test('notification heading, actions and content stay visible in unread, read and empty states',async({page,app},info)=>{
  // Setup: open the actual calendar with two notifications, without real backend writes.
  await app.open('/facilities',{authenticated:true,notifications:true})
  // Actions: open the bell just as the user did in the reported screenshot.
  await bell(page).click()
  // Assert: the open overlay itself fits; page width alone cannot detect this bug.
  await fitsScreen(page,panel(page),'Notification panel')
  await reachable(page,panel(page).getByText('Notifications',{exact:true}),'Notifications heading')
  for(const name of ['Mark all read','Clear all','Close notifications','Connect Telegram']){
   await reachable(page,panel(page).getByRole('button',{name,exact:true}),name)
  }
  await expect(panel(page).getByRole('button',{name:/Fixture schedule update/})).toBeInViewport({ratio:1})
  // Marking read removes one header action; the remaining content must still fit.
  await panel(page).getByRole('button',{name:'Mark all read',exact:true}).click()
  await expect(bell(page)).toHaveAccessibleName('Notifications, 0 unread')
  await fitsScreen(page,panel(page),'Read notification panel')
  await reachable(page,panel(page).getByRole('button',{name:'Clear all',exact:true}),'Read-state Clear all')
  await page.screenshot({path:info.outputPath('notification-panel.png'),animations:'disabled'})
  await panel(page).getByRole('button',{name:'Close notifications',exact:true}).click()
  await expect(panel(page)).toHaveCount(0)
  await bell(page).click()
  page.once('dialog',dialog=>dialog.accept())
  await panel(page).getByRole('button',{name:'Clear all',exact:true}).click()
  await expect(panel(page).getByText('Nothing yet.',{exact:true})).toBeVisible()
  await fitsScreen(page,panel(page),'Empty notification panel')
  await reachable(page,panel(page).getByRole('button',{name:'Connect Telegram',exact:true}),'Empty-state Telegram button')
  await panel(page).getByRole('button',{name:'Close notifications',exact:true}).click()
  await expect(bell(page)).toHaveAttribute('aria-expanded','false')
 })

 test('long notifications scroll inside the panel while its header and footer remain reachable',async({page,app})=>{
  // Setup: enough long content to overflow the available mobile height.
  await app.open('/facilities',{authenticated:true,notifications:true,notificationCount:20})
  await bell(page).click()
  await fitsScreen(page,panel(page),'Long notification panel')
  const list=panel(page).locator('.pulse-notification-list')
  // Actions: scroll the notification list, rather than the entire page.
  await list.evaluate(element=>{element.scrollTop=element.scrollHeight})
  // Assert: the last notification, close action and footer can all be reached.
  const last=panel(page).getByRole('button',{name:/Fixture long notification 20 /})
  // scrollTop is rounded to pixels, so a border may differ by less than one pixel.
  // Check the item against its scrollport with that tolerance, and require all text to be visible.
  await expect.poll(async()=>{
   const item=await last.boundingBox(),viewport=await list.boundingBox()
   return !!item && !!viewport && item.y>=viewport.y-1 && item.y+item.height<=viewport.y+viewport.height+1
  },{message:'Last notification fits inside the scrollable list'}).toBe(true)
  await expect(last.locator('.pulse-tiny.mt-1')).toBeInViewport({ratio:1})
  await reachable(page,panel(page).getByRole('button',{name:'Close notifications',exact:true}),'Long-list close action')
  await reachable(page,panel(page).getByRole('button',{name:'Connect Telegram',exact:true}),'Long-list footer')
  // A normal click also proves the last item is operable after scrolling.
  await last.click()
  await expect(page).toHaveURL(/personal-schedule$/)
  await expect(page.getByRole('heading',{name:/Hi Fixture Exco/})).toBeVisible()
  await expect(panel(page)).toHaveCount(0)
 })

 test('an open notification panel repositions when the viewport changes',async({page,app})=>{
  await app.open('/facilities',{authenticated:true,notifications:true})
  await bell(page).click()
  const original=page.viewportSize()
  // Actions: resize without reopening, so stale positioning cannot pass.
  await page.setViewportSize({width:320,height:568})
  await fitsScreen(page,panel(page),'Resized notification panel')
  await reachable(page,panel(page).getByRole('button',{name:'Close notifications',exact:true}),'Resized close action')
  await page.setViewportSize(original)
  await fitsScreen(page,panel(page),'Restored notification panel')
  await panel(page).getByRole('button',{name:'Close notifications',exact:true}).click()
  await expect(panel(page)).toHaveCount(0)
 })

 test('account menu and booking confirmation keep their actions inside the screen',async({page,app})=>{
  await app.open('/facilities',{authenticated:true,facilities:true})
  await app.account()
  await fitsScreen(page,page.locator('header .card').filter({has:page.getByRole('button',{name:'Sign Out to Landing',exact:true})}),'Account menu')
  await reachable(page,page.getByRole('button',{name:'Sign Out to Landing',exact:true}),'Account sign-out action')
  await page.keyboard.press('Escape')
  await room(page,'Fixture Music Room').getByRole('button',{name:'Claim',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'Claim this slot?',exact:true})
  await fitsScreen(page,dialog,'Booking confirmation')
  for(const name of ['Cancel','Submit claim'])await reachable(page,dialog.getByRole('button',{name,exact:true}),name)
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click()
  await expect(dialog).toHaveCount(0)
  await expect(room(page,'Fixture Music Room').getByRole('button',{name:'Claim',exact:true})).toBeEnabled()
 })
}
