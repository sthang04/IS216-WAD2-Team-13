import {test,expect} from './fixtures/app.js'
import {downloadText,guest} from './fixtures/journeys.js'

test('heatmap toggles availability and changes the visible total reversibly',async({page,app})=>{
 await app.open('/availability',{authenticated:true})
 const cell=page.locator('.pulse-heat-cell').first()
 const before=await cell.getAttribute('title')
 await cell.click()
 await expect(cell).toHaveClass(/pulse-heat-my-active/)
 await expect(cell.getByText('You',{exact:true})).toBeVisible()
 expect(await cell.getAttribute('title')).not.toBe(before)
 await cell.click()
 await expect(cell).not.toHaveClass(/pulse-heat-my-active/)
 await expect(cell).toHaveAttribute('title',before)
})

test('week navigation and class baseline toggle change the actual heatmap',async({page,app})=>{
 await app.open('/availability',{authenticated:true})
 await expect(page.locator('.pulse-class-pill').first()).toBeVisible()
 await page.getByRole('button',{name:/Show Class Baselines/}).click()
 await expect(page.locator('.pulse-class-pill')).toHaveCount(0)
 await page.getByRole('button',{name:'Next week',exact:true}).click()
 await expect(page.getByRole('columnheader',{name:'Mon 19 Oct',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Back to example week',exact:true}).click()
 await expect(page.getByRole('columnheader',{name:'Mon 12 Oct',exact:true})).toBeVisible()
})

test('select match, choose recipients and confirm a demo meeting with downloadable agenda',async({page,app})=>{
 await app.open('/availability',{authenticated:true})
 await page.locator('.match-card').first().click()
 await page.getByRole('button',{name:'Create Meeting & Broadcast Agenda',exact:true}).click()
 const modal=page.locator('.modal.show')
 await modal.getByPlaceholder('e.g. SMU Arts Festival Opening Night - Run of Show Alignment').fill('Fixture ExCo meeting')
 await modal.getByPlaceholder('List key agenda items...').fill('Review fixture rehearsal schedule')
 await modal.getByRole('button',{name:'Dancers (3)',exact:true}).click()
 await expect(modal.getByText('Telegram Broadcast Target (3 Selected)',{exact:true})).toBeVisible()
 const {text}=await downloadText(page,()=>modal.getByRole('button',{name:'Confirm Meeting & Dispatch Telegram Broadcast',exact:true}).click())
 expect(text).toContain('Fixture ExCo meeting')
 await expect(page.getByText('Meeting Confirmed & Broadcasted!',{exact:true})).toBeVisible()
 await expect(page.getByRole('alert').filter({hasText:'Meeting scheduled!'}).first()).toBeVisible()
 // This page changes local state and downloads ICS; no Telegram transport exists here.
})

test('recipient search and Cancel leave the demo meeting unconfirmed',async({page,app})=>{
 await app.open('/availability',{authenticated:true})
 await page.getByRole('button',{name:'Create Meeting & Broadcast Agenda',exact:true}).click()
 const modal=page.locator('.modal.show')
 await modal.getByPlaceholder('Search member by name, handle (e.g. @angellow), or role...').fill('no fixture member')
 await expect(modal.getByRole('button',{name:/@angellow/})).toHaveCount(0)
 await modal.getByRole('button',{name:'Cancel',exact:true}).click()
 await expect(page.getByText('Meeting Confirmed & Broadcasted!',{exact:true})).toHaveCount(0)
})

test('refresh shows busy state then recalculated scheduling feedback',async({page,app})=>{
 await app.open('/availability',{authenticated:true})
 await page.getByRole('button',{name:'Refresh',exact:true}).click()
 await expect(page.getByRole('button',{name:'Refreshing',exact:true})).toBeDisabled()
 await expect(page.getByRole('alert')).toContainText('Scheduling engine refreshed')
 await expect(page.getByRole('button',{name:'Refresh',exact:true})).toBeEnabled()
})

test('guest availability and meeting actions stay read-only',async({page,app})=>{
 await guest(page,app,'/availability')
 const cell=page.locator('.pulse-heat-cell').first()
 const before=await cell.getAttribute('title')
 await cell.click()
 await expect(page.getByRole('alert')).toContainText('Guest view is read-only')
 await expect(cell).toHaveAttribute('title',before)
 await page.getByRole('button',{name:'Create Meeting & Broadcast Agenda',exact:true}).click()
 await expect(page.locator('.modal.show')).toHaveCount(0)
})
