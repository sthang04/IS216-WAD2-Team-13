// BROWSER TEST PURPOSE: simplification user workflows and regression coverage.
// Setup opens the real Vue UI; actions use its controls; assertions check visible results/state.
// Uses isolated fixture responses; passing UI checks do not prove deployed database or delivery integration.
// Purpose: fixture-backed simplification browser regressions for simulator controls and state.
// Use Setup -> Actions -> Assert; real Vue/engine code runs, but these tests do not prove live Supabase integration.
import {test,expect} from '@playwright/test'
import {bootRefinement} from './helpers/refinementHarness.js'
import {openTimeline,openFacilityHeatmap} from './helpers/disclosures.js'

// Setup -> Actions -> Assert. Real Vue and engine, isolated records;
// these browser tests do not prove live Supabase RLS or deliver notifications.
async function simulate(page){
 await bootRefinement(page,{many:true})
 await page.getByRole('button',{name:'Add disruption',exact:true}).click()
 await page.getByLabel('Disruption type',{exact:true}).nth(1).selectOption('FACILITY_UNAVAILABLE')
 for(let i=0;i<2;i++){
  await page.getByLabel('Unavailable from (Singapore)',{exact:true}).nth(i).selectOption('2026-11-02T10:00')
  await page.getByLabel('Unavailable until (Singapore)',{exact:true}).nth(i).selectOption('2026-11-02T10:30')
 }
 await page.getByRole('button',{name:'Run simulation (2)',exact:true}).click()
 await expect(page.getByText('Simulation complete',{exact:true})).toBeVisible()
}

test('secondary panels start closed; either visualization can expand to full width',async({page})=>{
 // Setup: run a combined disruption without opening secondary controls.
 await simulate(page)
 const timeline=page.locator('#impact-timeline'),heatmap=page.locator('#impact-facilities')
 for(const panel of [timeline,heatmap,page.locator('.candidate-verification'),page.locator('.facility-verification'),page.locator('#simulator-saved-recoveries')])await expect(panel).not.toHaveAttribute('open','')
 // Actions: expand only the heatmap, then both panels.
 await openFacilityHeatmap(page)
 const single=await heatmap.boundingBox(),closed=await timeline.boundingBox()
 // Assert: a lone open panel spans the row; a closed header stays compact.
 expect(Math.abs(single.width-closed.width)).toBeLessThan(2)
 expect(closed.height).toBeLessThan(single.height)
 await openTimeline(page)
 if(page.viewportSize().width>=1024){const t=await timeline.boundingBox(),h=await heatmap.boundingBox();expect(Math.abs(t.y-h.y)).toBeLessThan(2);expect(Math.abs(t.height-h.height)).toBeLessThan(2)}
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
})

test('both searchable shortlists retain selections and keep only one detail preview',async({page})=>{
 // Setup: both resource types have more than three evaluated alternatives.
 await simulate(page)
 const members=page.locator('.candidate-chooser'),facilities=page.getByRole('region',{name:'Facility and schedule choices',exact:true})
 await expect(members.locator('[data-candidate-id]')).toHaveCount(3)
 await expect(facilities.locator('.facility-shortlist-option')).toHaveCount(3)
 await expect(facilities.locator('.facility-choice')).toHaveCount(1)
 // Actions: search the complete source list, inspect and explicitly choose it.
 await facilities.getByRole('searchbox').fill('Fixture room 11')
 await expect(facilities.locator('.facility-shortlist-option')).toHaveCount(1)
 await facilities.locator('.facility-shortlist-option').click()
 await facilities.getByRole('button',{name:'Use this alternative',exact:true}).click()
 await facilities.getByRole('searchbox').fill('no matching facility')
 // Assert: filtering is presentation only; the chosen preview is retained.
 await expect(facilities.getByText('No alternatives match your search.',{exact:true})).toBeVisible()
 await expect(facilities.getByRole('button',{name:'Selected alternative',exact:true})).toBeVisible()
 await facilities.getByRole('searchbox').clear()
 await facilities.getByLabel(/Number of facility and schedule alternatives/).selectOption('all')
 expect(await facilities.locator('.facility-shortlist-option').count()).toBeGreaterThan(3)
 await members.getByRole('searchbox').fill('Fixture standby 11')
 await expect(members.locator('[data-candidate-id]')).toHaveCount(1)
 await members.locator('[data-candidate-id]').click()
 await members.getByRole('button',{name:'Use this alternative',exact:true}).click()
 await expect(page.locator('#simulator-comparison')).toContainText('Fixture standby 11')
})

test('ranking starts at top three with only best match expanded and shortcuts use matching text',async({page})=>{
 // Setup: ranking is produced by the existing evaluator, without auto-selection.
 await simulate(page)
 const ranking=page.getByRole('region',{name:'Combined recovery ranking',exact:true}),cards=ranking.getByRole('article')
 await expect(cards).toHaveCount(3)
 await expect(cards.first().getByText('Best match',{exact:false})).toBeVisible()
 await expect(cards.first().locator('.plan-detail-content')).toBeVisible()
 await expect(cards.nth(1).locator('.plan-detail-content')).toBeHidden()
 // Actions: expand the second option without selecting it.
 await cards.nth(1).getByRole('button',{name:'View details for recovery option 2',exact:true}).click()
 await expect(cards.nth(1).locator('.plan-detail-content')).toBeVisible()
 await expect(page.getByRole('region',{name:'Persisted recovery workflow',exact:true})).toHaveAttribute('data-selected-recovery','')
 await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight))
 const top=page.getByRole('button',{name:'Back to top',exact:true}),jump=page.locator('.section-shortcuts > summary')
 await expect(top).toBeVisible()
 const fonts=await Promise.all([top,jump].map(l=>l.evaluate(e=>{const s=getComputedStyle(e);return [s.fontSize,s.fontWeight,s.lineHeight]})))
 expect(fonts[0]).toEqual(fonts[1])
 await top.click()
 await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(0)
})
