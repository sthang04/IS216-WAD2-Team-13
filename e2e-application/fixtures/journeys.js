// SUPPORT FILE PURPOSE: journeys.js supplies shared setup or controlled data for the browser workflows.
// Keep this support code: the Playwright tests depend on consistent setup and isolated state.
import {expect} from './app.js'

export const eventSelect=page=>page.getByRole('region',{name:'Scenario builder',exact:true}).getByLabel('Event',{exact:true})
export async function runDelay(page){
 await page.getByLabel('Disruption type',{exact:true}).selectOption('SCHEDULE_DELAY')
 await page.getByLabel('Delay (minutes)',{exact:true}).fill('30')
 await page.getByRole('button',{name:'Run simulation (1)',exact:true}).click()
 await expect(page.getByText('Simulation complete',{exact:true})).toBeVisible()
}
// The disruption interval picker (SimulatorDisruptionInterval.vue) is a date dropdown plus a
// typed time box. value is 'YYYY-MM-DDTHH:MM' in Singapore time; nth picks the disruption row.
export async function chooseDisruptionTime(page,label,value,nth=0){
 const [date,time]=value.split('T')
 const which=label.startsWith('Unavailable from')?'Start':'End'
 await page.getByLabel(new RegExp('^'+which+' date for disruption')).nth(nth).selectOption(date)
 const box=page.getByLabel(label,{exact:true}).nth(nth)
 // The time box stays disabled until a date is chosen; fill then leave it, as a user would.
 await expect(box).toBeEnabled()
 await box.fill(time)
 await box.blur()
}
export const room=(page,name)=>page.locator('article').filter({has:page.getByRole('heading',{name,exact:true})})
export async function openScheduleForm(page,title='Fixture custom rehearsal'){
 // The header button; an empty day also shows a second "Add Event / Class" in its empty-state card.
 await page.getByRole('button',{name:'Add Event / Class',exact:true}).first().click()
 const modal=page.locator('.modal.show')
 await modal.getByPlaceholder('e.g. IS216 Lab, Rehearsal Warmup').fill(title)
 // Same day as the seeded schedule (fixture 'today', 3 Nov) so new entries are upcoming, not overdue.
 await modal.locator('input[type=date]').fill('2026-11-03')
 return modal
}
export const scheduleCard=(page,title)=>page.locator('.pulse-card').filter({has:page.getByRole('heading',{name:title,exact:true})})
export async function downloadText(page,action){
 const waiting=page.waitForEvent('download')
 await action()
 const download=await waiting
 const stream=await download.createReadStream()
 let text=''
 for await(const part of stream)text+=part.toString()
 expect(await download.failure()).toBeNull()
 return {text,name:download.suggestedFilename()}
}
export async function fit(page){
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width+1)
}
