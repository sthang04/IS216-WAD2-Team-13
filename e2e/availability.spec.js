// Real browser -> Vue -> real API/database; setup/actions/assertions.
// No API mocks. The signed-in participant's original votes are restored in finally,
// because this runs against shared data.
// (The old "None of these days work" step was removed with that button.)
import {test,expect} from '@playwright/test'
import {signIn} from './helpers/userJourney.js'

test('real availability vote survives reload and can be put back',async({page})=>{
 // Setup: sign in through the demo drawer and open an open (collecting) meeting.
 await signIn(page)
 await page.goto('/availability')
 await expect(page.getByRole('heading',{name:'Weekly Meeting Scheduler',exact:true})).toBeVisible()
 const collecting=page.locator('button.match-card').filter({has:page.getByText('Collecting',{exact:true})})
 await expect(collecting.first(),'An open meeting for this participant is required').toBeVisible()
 await collecting.first().click()
 const meetingTitle=await page.locator('button.match-card.selected strong').innerText()
 const grid=page.locator('.scheduler-grid')
 const cells=grid.locator('[role=button][aria-pressed]')
 await expect(cells.first()).toBeVisible()
 const reopen=async()=>{
  await page.reload()
  await page.locator('button.match-card').filter({has:page.getByText(meetingTitle,{exact:true})}).click()
  await expect(cells.first()).toBeVisible()
 }
 // Pick the first block that is currently NOT selected, so the test only adds one vote.
 const index=await cells.evaluateAll(list=>list.findIndex(c=>c.getAttribute('aria-pressed')==='false'))
 expect(index,'The meeting needs at least one unselected time block').toBeGreaterThanOrEqual(0)
 const cell=cells.nth(index)
 // Remember whether the participant had responded at all, to restore that exactly.
 const hadNoResponse=await page.getByText('No response yet',{exact:true}).isVisible()
 let added=false
 try{
  // Action: vote for that block and wait for the real save.
  const saved=page.waitForResponse(r=>r.url().includes('/rpc/rpc_set_meeting_availability')&&r.request().method()==='POST')
  await cell.click()
  expect((await saved).ok()).toBe(true)
  added=true
  await expect(cell).toHaveAttribute('aria-pressed','true')
  // Assert: the vote is stored in the database, so it is still selected after a reload.
  await reopen()
  await expect(cells.nth(index)).toHaveAttribute('aria-pressed','true')
 }finally{
  // Restore: remove only the vote this test added.
  if(added){
   const removed=page.waitForResponse(r=>r.url().includes('/rpc/rpc_set_meeting_availability')&&r.request().method()==='POST')
   await cells.nth(index).click()
   expect((await removed).ok()).toBe(true)
   await expect(cells.nth(index)).toHaveAttribute('aria-pressed','false')
   // Removing the vote still leaves an (empty) response on record; Undo clears it if there was none.
   if(hadNoResponse){
    await page.getByRole('button',{name:'Undo',exact:true}).click()
    await expect(page.getByText('No response yet',{exact:true})).toBeVisible()
   }
  }
 }
})
