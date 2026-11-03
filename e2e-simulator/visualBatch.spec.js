import {test,expect} from '@playwright/test'
import {bootRefinement,runScenario,openHeatmap} from './helpers/refinementHarness.js'
import {bootRecovery} from './helpers/recoveryHarness.js'

// Real Vue components and engine, synthetic loader/RPC records only. Geometry
// assertions measure rendered content, so an attractive but empty view cannot pass.
for(const shape of ['branch','independent','single'])test('fit centres actual booth bounds: '+shape,async({page})=>{
 await bootRefinement(page,{shape,single:shape==='single'});await runScenario(page)
 await page.getByRole('button',{name:'Fit whole map',exact:true}).click()
 const map=page.getByRole('region',{name:'Scrollable Event Village',exact:true})
 await expect.poll(()=>map.evaluate(e=>{const r=e.getBoundingClientRect(),g=e.querySelector('[aria-label="Activity booths"]').getBoundingClientRect();return g.x>=r.x && g.right<=r.right+1 && g.y>=r.y && g.bottom<=r.bottom+1})).toBe(true)
 const geometry=await map.evaluate(e=>{const r=e.getBoundingClientRect(),g=e.querySelector('[aria-label="Activity booths"]').getBoundingClientRect();return {dx:Math.abs(g.x+g.width/2-r.x-r.width/2),dy:Math.abs(g.y+g.height/2-r.y-r.height/2),w:r.width,h:r.height}})
 expect(geometry.dx).toBeLessThan(geometry.w*.15);expect(geometry.dy).toBeLessThan(geometry.h*.25)
 await expect(page.getByTestId('village-cats')).toBeVisible()
 if(shape!=='branch'){await expect(page.getByRole('button',{name:'View all dependencies',exact:true})).toHaveCount(0)}
})

test('direct arrows support keyboard inspection and modal endpoints focus linked booths',async({page})=>{
 await bootRefinement(page,{shape:'branch'});await runScenario(page)
 const arrow=page.getByRole('button',{name:'Dependency: Fixture activity 1 to Fixture activity 2',exact:true})
 await arrow.focus();await page.keyboard.press('Enter');await expect(page.getByRole('region',{name:'Selected dependency',exact:true})).toContainText('Recorded direct dependency')
 await page.getByRole('button',{name:'View all dependencies',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'All recorded dependencies',exact:true});await expect(dialog.getByRole('listitem')).toHaveCount(4);await expect(dialog).toContainText('cascade risk does not add edges')
 await dialog.getByRole('button',{name:'Fixture activity 2',exact:true}).first().click();await expect(dialog).toBeHidden()
 const booth=page.getByRole('group',{name:'Activity booths',exact:true}).getByRole('button').nth(1);await expect(booth).toBeFocused();await expect(booth).toHaveAttribute('aria-pressed','true')
 const selected=page.getByRole('region',{name:'Selected Activity',exact:true});await expect(selected).toContainText('Immediate prerequisites');await expect(selected).toContainText('Immediate dependents');await expect(selected).toContainText('Schedule unchanged')
 await expect(page.getByText(/^Technical dependency evidence/)).toHaveCount(0)
 await page.getByRole('button',{name:'View all dependencies',exact:true}).click();await page.keyboard.press('Escape');await expect(dialog).toBeHidden()
})

test('timeline header, impact legend, active selection and labelled heatmap preserve playback',async({page})=>{
 await bootRefinement(page);await runScenario(page)
 const time=page.locator('#impact-timeline'),slider=time.getByRole('slider'),active=time.getByRole('region',{name:'Activities at selected time',exact:true})
 await expect(time.getByRole('group',{name:'Timeline impact colours'})).toContainText('Downstream risk');await expect(time).toContainText('Playback marker')
 await slider.fill('15');const before=await slider.inputValue();await active.getByRole('button').first().click();await expect(slider).toHaveValue(before)
 const title=(await active.getByRole('button').first().locator('strong').textContent()).trim();await expect(page.getByRole('region',{name:'Selected Activity',exact:true})).toContainText(title)
 await time.getByRole('button',{name:'Play timeline',exact:true}).click();await active.getByRole('button').first().click();await expect(time.getByRole('button',{name:'Pause timeline',exact:true})).toBeVisible();await time.getByRole('button',{name:'Pause timeline',exact:true}).click()
 await slider.fill(await slider.getAttribute('max'));await expect(active).toContainText('No activities at this time.')
 await openHeatmap(page);const heat=page.locator('#impact-facilities');await expect(time.locator('header').getByRole('button',{name:'Hide heatmap',exact:true})).toBeVisible();await expect(heat.getByLabel('Heatmap states')).toContainText('Event use')
 const cell=heat.locator('.sim-heat-cell').first();await cell.click();await expect(cell).toHaveAttribute('aria-pressed','true');await expect(heat.getByRole('status',{name:'Selected facility slot'})).toContainText('Selected slot');await expect(cell.locator('[aria-hidden=true]')).not.toHaveText(/^[!xo-]$/)
 const position=await slider.inputValue();await time.getByRole('button',{name:'Hide heatmap',exact:true}).click();await expect(slider).toHaveValue(position);await expect(heat).toBeHidden()
})

test('compact alternatives separate preview from calendar actions and preserve original timings',async({page})=>{
 await bootRefinement(page,{many:true});await runScenario(page,'FACILITY_UNAVAILABLE')
 const id=await page.getByTestId('facility-alternative').first().getAttribute('data-facility-option');const card=page.locator('[data-facility-option="'+id+'"]');await expect(card).toContainText('Schedule unchanged');await expect(card.getByLabel('Overall recovery score')).toContainText(/100|unavailable/)
 const preview=card.getByRole('button',{name:'Use this alternative',exact:true});await expect(preview).toBeVisible();await expect(card.getByRole('link',{name:'View / Request this facility',exact:true})).toBeHidden();await expect(card.getByRole('button',{name:'Check / refresh actual slot status',exact:true})).toBeHidden()
 await card.getByText('View details',{exact:true}).click();await expect(card.getByRole('link',{name:'View / Request this facility',exact:true})).toBeVisible();await expect(card.getByRole('button',{name:'Check / refresh actual slot status',exact:true})).toBeVisible();await expect(card).toContainText('Equipment and facilities');await expect(card).toContainText('do not confirm availability')
 await preview.click();await expect(card.getByRole('button',{name:'Selected alternative',exact:true})).toHaveAttribute('aria-pressed','true')
 const bookings=page.getByRole('region',{name:'Facility Bookings',exact:true});await expect(bookings).toContainText('8 of 8 linked');const gap=await bookings.evaluate(e=>parseFloat(getComputedStyle(e).marginTop));expect(gap).toBeGreaterThanOrEqual(16);expect(gap).toBeLessThanOrEqual(24)
})

test('empty saved recoveries hide filters; candidate inspection is pink without preview mutation',async({page})=>{
 await bootRefinement(page,{many:true});await runScenario(page)
 const workflow=page.getByRole('region',{name:'Persisted recovery workflow',exact:true});await expect(workflow.getByRole('group',{name:'Saved recovery views'})).toHaveCount(0);await expect(workflow).toContainText('No saved recoveries')
 const row=page.locator('.candidate-row').nth(1);await row.click();await expect(row).toHaveCSS('background-color','rgb(255, 241, 242)');await expect(workflow).toHaveAttribute('data-selected-recovery','')
 const first=page.getByRole('article',{name:'Recovery plan 1',exact:true});await first.getByText('Scoring evidence',{exact:true}).click();await expect(first.locator('pre')).toHaveCount(0)
})

test('saved summary groups repeated replacements and permission failure remains actionable',async({page})=>{
 const panel=await bootRecovery(page,{acknowledge:false})
 await page.evaluate(()=>{const c=window.__localPlan.changes.find(c=>c.replacementMemberId!=null);window.__localPlan.changes.push({...c,segmentId:2})});await panel.getByRole('button',{name:'Refresh statuses',exact:true}).click()
 const summary=panel.getByRole('region',{name:'Selected Recovery',exact:true});await expect(summary.locator('details')).toHaveCount(3);await expect(summary.locator('summary').filter({hasText:/^2 affected activities$/})).toHaveCount(1);await expect(summary).toContainText('2 affected activities')
 await page.evaluate(()=>{window.__denyHistory=true});await panel.getByRole('button',{name:'Refresh statuses',exact:true}).click();await expect(panel).toContainText('Contact the club manager');await expect(panel).toContainText('changing the calendar acting club does not grant this permission')
})
