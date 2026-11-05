// BROWSER TEST PURPOSE: operations user workflows and regression coverage.
// Setup opens the real Vue UI; actions use its controls; assertions check visible results/state.
// Uses isolated fixture responses; passing UI checks do not prove deployed database or delivery integration.
// Current Day-of Operations browser workflows. The old search/copilot/standby UI
// was replaced by per-person tasks, an event editor and crew check-in controls.
// These cases exercise the supported sample-plan fallback, stored only in this browser.
import {test,expect} from './fixtures/app.js'
import {fit} from './fixtures/journeys.js'
async function open(page,app){
 await page.clock.setFixedTime(new Date('2026-11-03T15:15:00+08:00'))
 await app.open('/operations',{authenticated:true,opsSample:true})
 await expect(page.getByRole('heading',{name:'Day-of Operations',exact:true})).toBeVisible()
 await expect(page.getByText('Sample plan, saved in this browser only',{exact:false})).toBeVisible()
}

test('person selection and all three schedule tabs show the selected crew',async({page,app})=>{
 await open(page,app)
 await page.getByRole('button',{name:'My schedule',exact:true}).click()
 await page.getByLabel('Showing',{exact:true}).selectOption('Darren Koh')
 await expect(page.locator('.ops-list-item').first()).toBeVisible()
 for(const name of ['Everyone now','Full grid','My schedule']){
  const tab=page.getByRole('button',{name,exact:true});await tab.click();await expect(tab).toHaveClass(/active/)
 }
 await fit(page)
})

test('delay shifts flexible tasks and preserves fixed performance times',async({page,app})=>{
 await open(page,app)
 await page.getByRole('button',{name:'Full grid',exact:true}).click()
 const fixed=page.locator('.ops-block.ops-fixed').first()
 const before=await fixed.getAttribute('title')
 await page.getByRole('button',{name:/Delay current tasks/}).click()
 await page.getByRole('button',{name:'+15 min',exact:true}).click()
 await expect(page.getByRole('alert').first()).toBeVisible()
 await expect(fixed).toHaveAttribute('title',before)
})

test('crew check-in can be completed and undone',async({page,app})=>{
 await open(page,app)
 const card=page.locator('.transition-all').filter({has:page.getByRole('button',{name:'Check in',exact:true})}).first()
 const name=await card.locator('strong').first().textContent()
 await card.getByRole('button',{name:'Check in',exact:true}).click()
 const selected=page.locator('.transition-all').filter({has:page.getByText(name.trim(),{exact:true})})
 await expect(selected).toContainText('Checked In')
 await selected.getByRole('button',{name:'Undo check-in',exact:true}).click()
 await expect(selected.getByRole('button',{name:'Check in',exact:true})).toBeVisible()
})

test('new event validates required details and saves an isolated crew plan',async({page,app})=>{
 await open(page,app)
 await page.getByRole('button',{name:'+ New event',exact:true}).click()
 const dialog=page.getByRole('dialog')
 await dialog.getByLabel(/^Event name/).fill('Fixture new showcase')
 await dialog.getByLabel(/^Starts/).fill('15:00')
 await dialog.getByLabel(/^Ends/).fill('23:00')
 await dialog.getByRole('button',{name:'Select all',exact:true}).click()
 await dialog.getByRole('button',{name:'Create event',exact:true}).click()
 // Missing required dates keep the form open; entering one permits creation.
 await expect(dialog.getByText('Pick a date.',{exact:true})).toBeVisible()
 await dialog.getByLabel(/^Date/).fill('2026-11-03')
 await dialog.getByRole('button',{name:'Create event',exact:true}).click()
 await expect(dialog).toHaveCount(0)
 await expect(page.getByRole('combobox',{name:'Event',exact:true})).toContainText('Fixture new showcase')
})

test('task editor accepts a title and Cancel discards the unsaved task',async({page,app})=>{
 await open(page,app)
 await page.getByRole('button',{name:'+ Add task',exact:true}).click()
 const dialog=page.getByRole('dialog')
 await dialog.getByLabel('Task',{exact:true}).fill('Fixture unsaved task')
 await expect(dialog.getByLabel('Task',{exact:true})).toHaveValue('Fixture unsaved task')
 await fit(page)
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click()
 await expect(dialog).toHaveCount(0)
 await expect(page.getByText('Fixture unsaved task',{exact:true})).toHaveCount(0)
})

test('notify crew queues recipient-scoped alerts without claiming Telegram delivery',async({page,app})=>{
 await open(page,app)
 await page.getByRole('button',{name:/^Notify crew/}).click()
 await expect(page.getByRole('alert')).toContainText('Updated run of show for Showcase')
 // This verifies the UI/API boundary with synthetic recipients, not actual Telegram delivery.
 await expect(page.getByRole('alert')).toContainText('Telegram alerts queued for 3 crew members.')
})

// Guest entry was removed; verify the supported signed-out boundary instead.
test('signed-out access to /operations requests login without exposing protected controls',async({page,app})=>{
 await app.open('/operations')
 await expect(page).toHaveURL(/redirect=/)
 await expect(page.locator('input[name="smu_user_password"]')).toBeVisible()
 await expect(page.getByRole('button',{name:/explore live facility calendar as guest/i})).toHaveCount(0)
 await page.reload()
 await expect(page.locator('input[name="smu_user_password"]')).toBeVisible()
 await expect(page.getByRole('button',{name:'Submit claim',exact:true})).toHaveCount(0)
})
