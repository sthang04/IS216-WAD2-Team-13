// Browser checks prove the shared detectors catch genuine rendering faults.
// Use the actual landing UI, temporarily introduce a CSS fault, then restore it.
// These are Playwright browser tests, not a separate unit/DOM test framework.
import {test,expect} from './fixtures/app.js'
import {findTextClipping,findElementOverlaps,assertPageLayout} from '../e2e/helpers/browserUi.js'

test('text clipping audit detects a cropped heading and passes after restoration',async({page,app})=>{
 // Setup: load the real page and verify its unmodified layout.
 await page.emulateMedia({reducedMotion:'reduce'});await app.open()
 await assertPageLayout(page)
 const heading=page.getByRole('heading').first()
 await heading.scrollIntoViewIfNeeded()
 const original=await heading.getAttribute('style')
 try{
  // Actions: reproduce a hidden-overflow text crop without changing app data.
  await heading.evaluate(e=>{e.style.cssText+=';display:block!important;width:8px!important;height:5px!important;overflow:hidden!important;white-space:nowrap!important'})
  // Assert: the detector reports rendered text, not merely a visible element box.
  await expect.poll(()=>findTextClipping(page.locator('body'))).not.toEqual([])
 }finally{
  await heading.evaluate((e,style)=>{if(style===null)e.removeAttribute('style');else e.setAttribute('style',style)},original)
 }
 await assertPageLayout(page)
})

test('overlap audit detects colliding preview buttons and passes after restoration',async({page,app})=>{
 // Setup: use the actual peer tab buttons and their normal responsive layout.
 await page.emulateMedia({reducedMotion:'reduce'});await app.open()
 const tabs=page.getByRole('tablist'),first=tabs.getByRole('tab').nth(0),second=tabs.getByRole('tab').nth(1)
 await expect(first).toBeVisible();await expect(second).toBeVisible()
 // Mobile places the preview below the form; inspect it inside the viewport.
 await first.scrollIntoViewIfNeeded()
 await expect.poll(()=>findElementOverlaps(tabs)).toEqual([])
 const original=await second.getAttribute('style'),a=await first.boundingBox(),b=await second.boundingBox()
 try{
  // Actions: move the second real button onto the first, including stacked phone tabs.
  await second.evaluate((e,offset)=>{e.style.transform='translate('+offset.x+'px,'+offset.y+'px)'}, {x:a.x-b.x,y:a.y-b.y})
  // Assert: geometrically colliding controls are detected even when both are visible.
  await expect.poll(()=>findElementOverlaps(tabs)).not.toEqual([])
 }finally{
  await second.evaluate((e,style)=>{if(style===null)e.removeAttribute('style');else e.setAttribute('style',style)},original)
 }
 await assertPageLayout(page)
})
