// BROWSER TEST PURPOSE: refinements Impact user workflows and regression coverage.
// Setup opens the real Vue UI; actions use its controls; assertions check visible results/state.
// Uses isolated fixture responses; passing UI checks do not prove deployed database or delivery integration.
// Purpose: fixture-backed refinements Impact browser regressions for simulator controls and state.
// Use Setup -> Actions -> Assert; real Vue/engine code runs, but these tests do not prove live Supabase integration.
import {test,expect} from '@playwright/test'
import {bootRefinement,runScenario,openHeatmap} from './helpers/refinementHarness.js'
// Exercise the real Vue page and existing engine. Fixture graph edges are
// explicit so a scheduled sequence cannot accidentally masquerade as a dependency.
for(const shape of ['branch','linear','independent'])test('integrated overview and recorded '+shape+' graph',async({page})=>{
 await bootRefinement(page,{shape});await runScenario(page)
 await expect(page.getByRole('region',{name:'Impact Overview',exact:true})).toHaveCount(1)
 await expect(page.getByRole('region',{name:'Simulation Overview',exact:true})).toHaveCount(0)
 await expect(page.getByRole('group',{name:'Impact view',exact:true})).toHaveCount(0)
 const expected=await page.evaluate(async()=>{const {runCompleteSimulation}=await import('/src/services/simulationService.js');const {fixtureAbsence}=await import('/e2e-simulator/fixtures/campusConnect.js');const r=runCompleteSimulation(window.__fixtureData,990001,[fixtureAbsence]);return {direct:new Set(r.directImpacts.map(x=>x.segmentId)).size,downstream:new Set(r.downstreamRisks.map(x=>x.segmentId)).size,conflicts:r.conflictCounts.total}})
 await expect(page.getByTestId('impact-total')).toHaveText('8');await expect(page.getByTestId('impact-direct')).toHaveText(String(expected.direct));await expect(page.getByTestId('impact-downstream')).toHaveText(String(expected.downstream));await expect(page.getByTestId('impact-conflicts')).toHaveText(String(expected.conflicts))
 await expect(page.locator('.village-path')).toHaveCount(shape==='branch'?4:shape==='linear'?3:0)
 await expect(page.getByText('Dependency relationships (0)',{exact:true})).toHaveCount(0)
 await page.getByRole('button',{name:'Fixture activity 1: Direct impact',exact:true}).click()
 const inspector=page.getByRole('region',{name:'Selected Activity',exact:true})
 await expect(inspector).toContainText('Schedule unchanged')
 await page.getByRole('button',{name:'Activity List',exact:true}).click()
 await page.getByRole('group',{name:'Activity List',exact:true}).getByRole('button').nth(1).click()
 await expect(inspector).toContainText('Fixture activity 2')
 await page.getByRole('button',{name:'Village',exact:true}).click()
 await expect(page.getByRole('group',{name:'Activity booths',exact:true}).getByRole('button').nth(1)).toHaveAttribute('aria-pressed','true')
 const builder=await page.getByRole('region',{name:'Scenario builder',exact:true}).boundingBox(),impact=await page.getByRole('region',{name:'Event impact workspace',exact:true}).boundingBox()
 expect(impact.y).toBeGreaterThanOrEqual(builder.y+builder.height)
})
test('replay preserves explore, fit, manual zoom, pan and single-activity selection',async({page})=>{
 await bootRefinement(page,{single:true});await runScenario(page)
 const node=page.getByRole('button',{name:'Fixture activity 1: Direct impact',exact:true}),zoom=page.getByLabel('Map zoom percentage'),replay=page.getByRole('button',{name:'Replay cascade',exact:true})
 await node.click();await replay.click();await expect(node).toHaveAttribute('aria-pressed','true')
 await page.getByRole('button',{name:'Fit whole map',exact:true}).click();const fit=await zoom.textContent();await replay.click();await expect(zoom).toHaveText(fit);await expect(page.getByRole('button',{name:'Explore map',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Zoom in',exact:true}).click();const manual=await zoom.textContent();const map=page.getByRole('region',{name:'Scrollable Event Village',exact:true});await map.evaluate(e=>{e.scrollLeft=100;e.scrollTop=50});const pan=await map.evaluate(e=>[e.scrollLeft,e.scrollTop]);await replay.click();await expect(zoom).toHaveText(manual);expect(await map.evaluate(e=>[e.scrollLeft,e.scrollTop])).toEqual(pan)
 await expect(node).toHaveCSS('animation-name',/^impact-cascade/);await page.getByRole('button',{name:'Zoom out',exact:true}).click();expect(await zoom.textContent()).not.toBe(manual)
 await page.emulateMedia({reducedMotion:'reduce'});await replay.click();await expect(node).toHaveCSS('animation-name','none');await expect(node).toHaveAttribute('aria-pressed','true')
})
for(const type of ['MEMBER_UNAVAILABLE','FACILITY_UNAVAILABLE','SCHEDULE_DELAY'])test('contextual heatmap and schedule details: '+type,async({page})=>{
 await bootRefinement(page);await runScenario(page,type)
 const heat=page.locator('#impact-facilities'),timeline=page.locator('#impact-timeline')
 if(type==='MEMBER_UNAVAILABLE'){await expect(heat).not.toHaveAttribute('open','');const tb=await timeline.boundingBox(),vb=await page.getByRole('region',{name:'Event Village',exact:true}).boundingBox();expect(Math.abs(tb.width-vb.width)).toBeLessThan(2)}else await expect(heat).toBeVisible()
 await openHeatmap(page);await expect(heat).toBeVisible();await expect(heat).toContainText('does not mean a room is available or approved')
 await heat.getByRole('button').first().click();await expect(heat.getByRole('status')).toBeVisible()
 await page.getByRole('button',{name:'Hide heatmap',exact:true}).click();await expect(heat).not.toHaveAttribute('open','')
 await expect(page.getByLabel('Event day (Singapore)',{exact:true})).toHaveCount(0)
 if(type==='SCHEDULE_DELAY'){await page.getByRole('group',{name:'Activity booths',exact:true}).getByRole('button').first().click();await expect(page.getByRole('region',{name:'Selected Activity',exact:true})).toContainText('Schedule changed')}
})
test('multi-day selector lives in Time Machine; modes, playback and scrubbing remain usable',async({page})=>{
 await bootRefinement(page,{multiDay:true});await runScenario(page)
 const timeline=page.locator('#impact-timeline'),day=timeline.getByLabel('Event day (Singapore)',{exact:true});await expect(day).toBeVisible();await day.selectOption('2026-11-03');await expect(timeline).toContainText('Fixture activity 8')
 for(const mode of ['original','simulated','overlay']){await timeline.getByRole('button',{name:mode,exact:true}).click();if(mode==='overlay')await expect(timeline.getByRole('button',{name:/^Original Fixture/})).toHaveCount(1)}
 await timeline.getByRole('button',{name:'Play timeline',exact:true}).click();const slider=timeline.getByRole('slider');await expect.poll(async()=>Number(await slider.inputValue())).toBeGreaterThan(0);await timeline.getByRole('button',{name:'Pause timeline',exact:true}).click();await slider.fill('10');await expect(slider).toHaveValue('10')
})
test('responsive hierarchy, map/sidebar split, 65/35 panels and safe floating controls',async({page})=>{
 await bootRefinement(page);await runScenario(page,'FACILITY_UNAVAILABLE');await openHeatmap(page)
 for(const [width,height] of [[1280,800],[1440,900],[1920,1080],[390,844],[375,667],[320,568]]){
  await page.setViewportSize({width,height});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
  const t=await page.locator('#impact-timeline').boundingBox(),h=await page.locator('#impact-facilities').boundingBox()
  if(width>=1024){expect(Math.abs(t.y-h.y)).toBeLessThan(2);expect(Math.abs(t.height-h.height)).toBeLessThan(2);expect(t.width/(t.width+h.width)).toBeCloseTo(.65,1);const map=await page.locator('.village-map-panel').boundingBox(),side=await page.locator('.impact-sidebar').boundingBox();expect(map.width/(map.width+side.width)).toBeCloseTo(.75,1)}else expect(h.y).toBeGreaterThan(t.y)

 }
 await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));await expect(page.getByRole('button',{name:'Back to top',exact:true})).toBeVisible();await page.getByRole('button',{name:'Back to top',exact:true}).click();await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(0)
})

// Combined scenarios must use one engine result, not two independently drawn
// cascades. Add/remove and delay editing stay available without a shortcut.example
test('combined scenario editing keeps one calculated result and relevant heatmap',async({page})=>{
 await bootRefinement(page)
 await expect(page.getByRole('button',{name:'Add 15-min delay',exact:true})).toHaveCount(0)
 await page.getByRole('button',{name:'Add disruption',exact:true}).click()
 await page.getByLabel('Disruption type',{exact:true}).nth(1).selectOption('SCHEDULE_DELAY');await page.getByLabel('Delay (minutes)',{exact:true}).fill('15')
 await page.getByRole('button',{name:'Run simulation (2)',exact:true}).click();await expect(page.getByTestId('impact-total')).toHaveText('8');await expect(page.locator('#impact-facilities')).toBeVisible()
 await page.getByRole('button',{name:'Remove disruption',exact:true}).last().click();await expect(page.getByRole('button',{name:'Run simulation (1)',exact:true})).toBeVisible();await expect(page.getByTestId('impact-total')).toHaveCount(0)
 await page.getByRole('button',{name:'Reset Simulation',exact:true}).click();await expect(page.getByRole('region',{name:'Start a simulation',exact:true})).toBeVisible()
})

// Long recorded chains can fit below the ordinary manual minimum. Zoom Out
// must still decrease scale, and unabridged labels must not overlap the cats.
test('long graph zoom remains directional and preserves label clearance',async({page})=>{
 await bootRefinement(page,{longGraph:true});await runScenario(page)
 await page.getByRole('button',{name:'Fit whole map',exact:true}).click();const percent=page.getByLabel('Map zoom percentage');const fit=Number((await percent.textContent()).replace('%',''));expect(fit).toBeGreaterThan(0);expect(fit).toBeLessThan(100)
 await page.getByRole('button',{name:'Zoom out',exact:true}).click();const smaller=Number((await percent.textContent()).replace('%',''));expect(smaller).toBeLessThan(fit)
 await page.getByRole('button',{name:'Zoom in',exact:true}).click();expect(Number((await percent.textContent()).replace('%',''))).toBeGreaterThan(smaller)
 const value=await percent.textContent();await page.getByRole('button',{name:'Replay cascade',exact:true}).click();await expect(percent).toHaveText(value)
 await page.getByRole('button',{name:'Fit whole map',exact:true}).click();const last=await page.getByRole('group',{name:'Activity booths',exact:true}).getByRole('button').last().boundingBox(),cats=await page.getByTestId('village-cats').boundingBox();expect(cats.y).toBeGreaterThan(last.y+last.height)
})
