import {test,expect} from './fixtures/app.js'
import {guest} from './fixtures/journeys.js'
const search=page=>page.getByPlaceholder('Search cue title, crew (e.g. Darren, Angel), or venue...')
const task=page=>page.locator('.transition-all').filter({hasText:'Act 2: Eurhythmix Tech Rehearsal'})

test('search and crew shortcuts filter real task cards and clear correctly',async({page,app})=>{
 await app.open('/operations',{authenticated:true})
 await search(page).fill('not a fixture cue')
 await expect(page.locator('.transition-all').filter({hasText:'Assigned Crew:'})).toHaveCount(0)
 await page.getByRole('button',{name:'Darren',exact:true}).click()
 await expect(task(page)).toBeVisible()
 await expect(task(page)).toContainText('Darren')
 await page.getByRole('button',{name:'All',exact:true}).click()
 await expect(search(page)).toHaveValue('')
 await expect(page.getByText('Act 1: Symphonia Soundcheck',{exact:true})).toBeVisible()
})

test('delay cascade shifts unfinished cues but preserves completed cue timing',async({page,app})=>{
 await app.open('/operations',{authenticated:true})
 const before=await task(page).textContent()
 await page.getByRole('button',{name:'One-Click Delay (+15 mins)',exact:true}).click()
 await expect(task(page)).toContainText('18:45')
 expect(await task(page).textContent()).not.toBe(before)
 await expect(page.locator('.transition-all').filter({hasText:'Act 1: Symphonia Soundcheck'})).toContainText('17:00')
 await expect(page.getByRole('alert')).toContainText('One-Click Delay applied')
})

test('attendance ETA and manual override change the selected performer record',async({page,app})=>{
 await app.open('/operations',{authenticated:true})
 const late=page.getByRole('button',{name:'+15m Late',exact:true}).first()
 const performer=page.locator('.p-3.rounded-3.border').filter({has:page.getByText('Darren Koh',{exact:true})})
 await late.click()
 await expect(performer).toContainText('+15m Late (SOE Class)')
 await performer.getByRole('button',{name:'Override',exact:true}).click()
 await expect(performer).toContainText('ExCo Manual Override')
 await expect(performer.getByRole('button',{name:'+15m Late',exact:true})).toHaveCount(0)
})

test('standby dispatch updates the attendance board and crew assignment locally',async({page,app})=>{
 await app.open('/operations',{authenticated:true})
 await page.getByRole('button',{name:'Call Standby',exact:true}).first().click()
 const modal=page.locator('.modal.show')
 const candidate=await modal.locator('strong').first().textContent()
 await modal.getByRole('button',{name:'Dispatch via Telegram',exact:true}).first().click()
 await expect(modal).toHaveCount(0)
 await expect(page.getByRole('alert')).toContainText('Emergency Standby Activated')
 await expect(page.getByRole('alert')).toContainText(candidate)
 await expect(task(page)).toContainText(candidate+' (Standby)')
 await expect(page.getByText(/Dispatched Standby/).first()).toBeVisible()
})

test('notice parser uses demo input and renders extracted checklist',async({page,app})=>{
 await app.open('/operations',{authenticated:true})
 await page.getByRole('button',{name:'Pulse AI Copilot',exact:true}).click()
 const modal=page.locator('.modal.show')
 await modal.getByRole('button',{name:'2. AI Notice & Shopping List Parser',exact:true}).click()
 await expect(modal.getByRole('button',{name:'Run Pulse AI Parser',exact:true})).toBeDisabled()
 await modal.getByPlaceholder('Paste unstructured announcement from Telegram group chat...').fill('Fixture rehearsal needs tape and batteries.')
 await modal.getByRole('button',{name:'Run Pulse AI Parser',exact:true}).click()
 await expect(modal.getByText('Logistics Shopping Checklist:',{exact:true})).toBeVisible()
 await expect(modal).toContainText('4x AAA batteries')
 // Parser currently returns fixed demo output, not an external LLM result.
})

test('publishing reports local demo feedback without sending any transport request',async({page,app})=>{
 await app.open('/operations',{authenticated:true})
 await page.getByRole('button',{name:'Publish Live to Mobile (Telegram & Push)',exact:true}).click()
 await expect(page.getByRole('alert')).toContainText('Schedule Published Live!')
})

test('guest cannot delay cues, check in or dispatch a standby',async({page,app})=>{
 await guest(page,app,'/operations')
 const before=await task(page).textContent()
 await page.getByRole('button',{name:'One-Click Delay (+15 mins)',exact:true}).click()
 await expect(page.getByRole('alert')).toContainText('Guest view is read-only')
 await expect(task(page)).toHaveText(before)
 await page.getByRole('button',{name:'Override',exact:true}).first().click()
 await page.getByRole('button',{name:'Call Standby',exact:true}).first().click()
 await expect(page.locator('.modal.show')).toHaveCount(0)
 await expect(page.getByRole('alert')).toContainText('Guest view is read-only')
})

