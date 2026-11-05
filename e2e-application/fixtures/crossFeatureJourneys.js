// Cross-feature browser workflows for sign-in, booking conflicts, waitlists and meeting availability.
// Real UI/services run against isolated API data; no real booking or message is sent.
import {test,expect} from './app.js'
import {room,fit,downloadText} from './journeys.js'
export function registerCrossFeatureJourneys(){
 test('landing login and persona drawer fit before a successful sign-in',async({page,app})=>{
  await app.open()
  await fit(page)
  await page.getByRole('button',{name:/Try a demo account/i}).click()
  for(const name of ['Rachel Tan','Marcus Lim','Dev'])await expect(page.getByRole('button',{name:new RegExp(name)})).toBeVisible()
  await fit(page)
  await app.login()
  await expect(page).toHaveURL(/facilities$/)
  await fit(page)
  // Pip is now hidden below the product's 992px breakpoint; navigation remains available.
  const pip=page.locator('.pip-container').first()
  if(page.viewportSize().width<992)await expect(pip).toBeHidden()
  else await expect(pip).toBeVisible()
 })
 for(const [label,options]of [['booked',{}],['approved',{confirmedConflict:true}],['pending claim',{pendingConflict:true}]]){
  test('overlapping '+label+' booking blocks claiming and joining a queue',async({page,app})=>{
   await app.open('/facilities',{authenticated:true,facilities:true,bookingConflict:true,...options})
   for(const name of ['Fixture Music Room','Fixture Sports Hall']){
    const card=room(page,name)
    await expect(card.getByText('Time conflict',{exact:false})).toBeVisible()
    await expect(card.getByRole('button',{name:/^(Claim|Join waitlist)$/})).toHaveCount(0)
   }
   await fit(page)
  })
 }
 test('back-to-back bookings can be claimed without a false overlap',async({page,app})=>{
  await app.open('/facilities',{authenticated:true,facilities:true,adjacentBooking:true})
  const card=room(page,'Fixture Music Room')
  await card.getByRole('button',{name:'Claim',exact:true}).click()
  await page.getByRole('dialog').getByRole('button',{name:'Submit claim',exact:true}).click()
  await expect(card).toContainText('Awaiting OSL approval')
 })
 test('waitlist offer cannot bypass overlapping-booking validation',async({page,app})=>{
  await app.open('/facilities/waitlist',{authenticated:true,facilities:true,bookingConflict:true,offer:true})
  await page.getByRole('button',{name:'Accept and claim',exact:true}).click()
  await page.getByRole('dialog').getByRole('button',{name:'Accept and claim',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'Double booking is not permitted'})).toBeVisible()
  await expect(page.getByRole('button',{name:'Accept and claim',exact:true})).toBeEnabled()
  expect(await page.evaluate(()=>window.__foundation.calls.filter(c=>c.name==='rpc_claim_booking'))).toEqual([])
 })
 test('club name aliases produce one canonical club option after login',async({page,app})=>{
  await app.open('/',{aliasClubs:true})
  await app.login()
  await expect(page).toHaveURL(/facilities$/)
  // A deduplicated single CCA renders a badge rather than a redundant dropdown.
  await expect(page.locator('#clubSwitcher')).toHaveCount(0)
  await expect(page.locator('header').getByText('Eurhythmix',{exact:true})).toHaveCount(1)
 })
 test('keyboard votes persist and rapid toggles keep the last choice',async({page,app})=>{
  await app.open('/availability',{authenticated:true,meetings:true})
  const cell=page.locator('.scheduler-grid [role=button]').first()
  await cell.focus();await page.keyboard.press('Enter')
  await expect(cell).toHaveAttribute('aria-pressed','true')
  await page.keyboard.press('Space')
  await expect(cell).toHaveAttribute('aria-pressed','false')
  await cell.dblclick()
  await expect(cell).toHaveAttribute('aria-pressed','false')
  // Wait for persistence, rather than sleeping through the debounced UI refresh.
  await expect.poll(()=>page.evaluate(()=>window.__foundation.calls.filter(c=>c.name==='rpc_set_meeting_availability').length)).toBe(4)
  await page.reload()
  await expect(page.locator('.scheduler-grid [role=button]').first()).toHaveAttribute('aria-pressed','false')
 })
 test('failed availability vote restores the previous value and reports refusal',async({page,app})=>{
  await app.open('/availability',{authenticated:true,meetings:true,rpcError:'rpc_set_meeting_availability'})
  const cell=page.locator('.scheduler-grid [role=button]').first()
  await cell.click()
  await expect(page.getByRole('alert')).toContainText('Fixture operation denied')
  await expect(cell).toHaveAttribute('aria-pressed','false')
 })
 test('meeting calendar export escapes punctuation and preserves Singapore time',async({page,app})=>{
  await app.open('/availability',{authenticated:true,meetings:true,emptyMeeting:true})
  await page.getByRole('button',{name:'Schedule Meeting',exact:true}).click()
  await page.getByLabel('Title',{exact:true}).fill('Budget, costumes; rehearsal')
  await page.getByLabel('Agenda (optional)',{exact:true}).fill('Review, decide; confirm')
  await page.getByRole('button',{name:'Everyone',exact:true}).click()
  await page.getByRole('button',{name:'Send Meeting Request',exact:true}).click()
  await page.getByRole('button',{name:'Choose Meeting Day & Confirm',exact:true}).click()
  await page.getByLabel('Day',{exact:true}).selectOption('2026-11-04')
  await page.getByLabel('From',{exact:true}).selectOption('10')
  await page.getByLabel('To',{exact:true}).selectOption('11')
  await page.getByRole('button',{name:'Confirm & Notify Participants',exact:true}).click()
  const {text}=await downloadText(page,()=>page.getByRole('button',{name:'Add to Calendar (.ics)',exact:true}).click())
  expect(text).toContain('SUMMARY:Budget\\, costumes\\; rehearsal')
  expect(text).toContain('DESCRIPTION:Review\\, decide\\; confirm')
  expect(text).toContain('DTSTART:20261104T020000Z')
 })
}
