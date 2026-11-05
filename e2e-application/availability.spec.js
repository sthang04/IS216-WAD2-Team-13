// BROWSER TEST PURPOSE: availability user workflows and regression coverage.
// Setup opens the real Vue UI; actions use its controls; assertions check visible results/state.
// Uses isolated fixture responses; passing UI checks do not prove deployed database or delivery integration.
// Meeting scheduler browser regressions: use real forms and controls with isolated API data.
// Every case follows setup -> actions -> visible assertions; no service is called directly.
import {test,expect} from './fixtures/app.js'
import {downloadText,guest} from './fixtures/journeys.js'
const open=async(page,app,options={})=>{
 await app.open('/availability',{authenticated:true,meetings:true,...options})
 await expect(page.getByRole('heading',{name:'Weekly Meeting Scheduler',exact:true})).toBeVisible()
}

test('heatmap toggles availability and restores the unselected state',async({page,app})=>{
 await open(page,app)
 const cell=page.locator('.scheduler-grid [role=button]').first()
 await expect(cell).toHaveAttribute('aria-pressed','false')
 await cell.click()
 await expect(cell).toHaveAttribute('aria-pressed','true')
 await expect(cell.getByText('You',{exact:true})).toBeVisible()
 await cell.click()
 await expect(cell).toHaveAttribute('aria-pressed','false')
})

test('heatmap selects blocks one by one, without dragging, in the legend colours',async({page,app})=>{
 await open(page,app)
 const cells=page.locator('.scheduler-grid [role=button]')
 const [first,second,third]=[cells.nth(0),cells.nth(1),cells.nth(2)]
 await first.click()
 await second.click()
 await expect(first).toHaveAttribute('aria-pressed','true')
 await expect(second).toHaveAttribute('aria-pressed','true')
 await expect(third).toHaveAttribute('aria-pressed','false')
 // 1 of 2 fixture participants is amber; check the selected block has no brighter colour of its own
 const legendColour=await page.locator('.legend .avail-amber').evaluate(el=>getComputedStyle(el).backgroundColor)
 await expect(first).toHaveCSS('background-color',legendColour)
 await expect(page.locator('.legend')).not.toContainText(/\bYou\b/)
 // Holding the button across blocks must not paint them
 const box=await third.boundingBox()
 await first.hover();await page.mouse.down()
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2,{steps:5});await page.mouse.up()
 await expect(third).toHaveAttribute('aria-pressed','false')
 await expect(first).toHaveAttribute('aria-pressed','true')
})

test('week navigation changes the visible week and returns to this week',async({page,app})=>{
 await open(page,app)
 await page.getByRole('button',{name:'Next week',exact:true}).click()
 await expect(page.getByRole('columnheader',{name:'Mon 9 Nov',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'This week',exact:true}).click()
 await expect(page.getByRole('columnheader',{name:'Mon 2 Nov',exact:true})).toBeVisible()
})

test('create a meeting request, confirm its time and download its agenda',async({page,app})=>{
 await open(page,app,{emptyMeeting:true})
 await page.getByRole('button',{name:'Schedule Meeting',exact:true}).click()
 await page.getByLabel('Title',{exact:true}).fill('Fixture ExCo meeting')
 await page.getByLabel('Agenda (optional)',{exact:true}).fill('Review fixture rehearsal schedule')
 await page.getByRole('button',{name:'Everyone',exact:true}).click()
 await page.getByRole('button',{name:'Send Meeting Request',exact:true}).click()
 await expect(page.getByText('Fixture ExCo meeting',{exact:true}).first()).toBeVisible()
 await page.getByRole('button',{name:'Choose Meeting Day & Confirm',exact:true}).click()
 await page.getByLabel('Day',{exact:true}).selectOption('2026-11-04')
 await page.getByLabel('From',{exact:true}).selectOption('10')
 await page.getByLabel('To',{exact:true}).selectOption('11')
 await page.getByRole('button',{name:'Confirm & Notify Participants',exact:true}).click()
 const {text}=await downloadText(page,()=>page.getByRole('button',{name:'Add to Calendar (.ics)',exact:true}).click())
 expect(text).toContain('Fixture ExCo meeting')
 expect(text).toContain('Review fixture rehearsal schedule')
 // This confirms only the synthetic API contract, not real Telegram delivery.
})

test('closing an unsent meeting form discards its title and selected participants',async({page,app})=>{
 await open(page,app,{emptyMeeting:true})
 await page.getByRole('button',{name:'Schedule Meeting',exact:true}).click()
 await page.getByLabel('Title',{exact:true}).fill('Fixture discarded meeting')
 await page.getByRole('button',{name:'Dancers',exact:true}).click()
 await page.getByRole('button',{name:'Close',exact:true}).click()
 await expect(page.getByLabel('Title',{exact:true})).toHaveCount(0)
 await expect(page.getByText('Fixture discarded meeting',{exact:true})).toHaveCount(0)
})

test('a none-work response updates visible scheduling feedback and survives reload',async({page,app})=>{
 await open(page,app)
 await page.getByRole('button',{name:'None of these times work',exact:true}).click()
 await expect(page.getByRole('alert')).toContainText('Response saved: none of these times work for you.')
 await page.reload()
 await expect(page.getByText('None work',{exact:true})).toBeVisible()
})

test('guest cannot vote or schedule a meeting',async({page,app})=>{
 await guest(page,app,'/availability')
 await expect(page.getByText('Sign in as a CCA ExCo to schedule meetings.',{exact:true})).toBeVisible()
 await expect(page.locator('.scheduler-grid [role=button]')).toHaveCount(0)
 await expect(page.getByRole('button',{name:'Send Meeting Request',exact:true})).toHaveCount(0)
})
