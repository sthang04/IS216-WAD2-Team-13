// Real browser -> Vue -> real API/database; setup/actions/assertions.
// No API mocks. Restore the signed-in participant's original response in finally.
import {test,expect} from '@playwright/test'
import {signIn} from './helpers/userJourney.js'

test('real availability response can be undone, survives reload, and allows selecting a time',async({page})=>{
 await signIn(page)
 await page.goto('/availability')
 await expect(page.getByRole('heading',{name:'Weekly Meeting Scheduler',exact:true})).toBeVisible()
 const collecting=page.locator('button.match-card').filter({has:page.getByText('Collecting',{exact:true})})
 await expect(collecting.first(),'An open meeting for this participant is required').toBeVisible()
 await collecting.first().click()
 const none=page.getByRole('button',{name:'None of these days work',exact:true})
 const undo=page.getByRole('button',{name:'Undo',exact:true})
 const grid=page.locator('.scheduler-grid')
 await expect(none.or(undo)).toBeEnabled()
 const selected=await grid.locator('[role=button]').evaluateAll(cells=>cells.flatMap((c,index)=>c.getAttribute('aria-pressed')==='true'?[index]:[]))
 const wasNone=await undo.isVisible()
 const meetingTitle=await page.locator('button.match-card.selected strong').innerText()
 const reopen=async()=>{
  await page.reload()
  await page.locator('button.match-card').filter({has:page.getByText(meetingTitle,{exact:true})}).click()
  await expect(none.or(undo)).toBeEnabled()
 }
 try{
  if(await undo.isVisible())await undo.click()
  await none.click()
  await expect(undo).toBeEnabled()
  await reopen()
  await expect(undo).toBeEnabled()
  await undo.click()
  await expect(page.getByText('Not yet',{exact:true})).toBeVisible()
  await reopen()
  await expect(page.getByText('Not yet',{exact:true})).toBeVisible()
  const cell=grid.locator('[role=button]').first()
  await cell.click()
  await expect(cell).toHaveAttribute('aria-pressed','true')
  await expect(page.getByText('1 hour free',{exact:true})).toBeVisible()
  await reopen()
  await expect(grid.locator('[aria-pressed="true"]')).toHaveCount(1)
 }finally{
  // Clear the test selection, then restore the original visible response.
  if(await none.isVisible())await none.click()
  await expect(undo).toBeEnabled()
  if(!wasNone){
   await undo.click()
   await expect(page.getByText('Not yet',{exact:true})).toBeVisible()
   for(const index of selected){
    const saved=page.waitForResponse(r=>r.url().includes('/rpc/rpc_set_meeting_availability') && r.request().method()==='POST')
    await grid.locator('[role=button]').nth(index).click()
    expect((await saved).ok()).toBe(true)
   }
   await expect(grid.locator('[aria-pressed="true"]')).toHaveCount(selected.length)
  }
 }
})