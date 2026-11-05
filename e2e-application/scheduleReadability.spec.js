// Schedule-card regression for the reported phone screenshot.
// Setup -> Actions -> Assert uses actual controls, including all three status states.
import {test,expect} from './fixtures/app.js'
import {assertSingleLineText,assertControlUsable} from '../e2e/helpers/browserUi.js'

test('schedule titles and whole status labels remain readable at the configured screen size',async({page,app})=>{
 // Setup: use the real sample cards shown in the reported screenshot.
 await app.open('/personal-schedule',{authenticated:true})
 const cards=page.locator('.pulse-card').filter({has:page.locator('.schedule-entry-header')})
 await expect(cards).toHaveCount(5)
 for(const card of await cards.all()){
  // Actions: cycle each card through every state, so label length changes are covered.
  const button=card.locator('.schedule-entry-status')
  const original=(await button.textContent()).trim()
  for(let step=0;step<3;step++){
   // Assert: labels keep complete words and occupy one line at every transition.
   await assertControlUsable(page,button,'Schedule status')
   await assertSingleLineText(button,'Schedule status '+(await button.textContent()).trim())
   await expect(button).toHaveCSS('white-space','nowrap')
   for(const badge of await card.locator('.schedule-entry-title .badge').all())await assertSingleLineText(badge,'Schedule category or clash badge')
   const header=await card.locator('.schedule-entry-header').boundingBox(),title=await card.getByRole('heading').boundingBox(),status=await button.boundingBox()
   expect(title.x).toBeGreaterThanOrEqual(header.x-1)
   expect(title.x+title.width).toBeLessThanOrEqual(header.x+header.width+1)
   expect(title.x<status.x+status.width&&title.x+title.width>status.x&&title.y<status.y+status.height&&title.y+title.height>status.y).toBe(false)
   await button.click()
  }
  await expect(button).toHaveText(original)
 }
 // Assert: a normal reload preserves the final browser-local state.
 await page.reload();await expect(cards).toHaveCount(5)
 for(const button of await cards.locator('.schedule-entry-status').all())await assertSingleLineText(button,'Restored schedule status')
})
