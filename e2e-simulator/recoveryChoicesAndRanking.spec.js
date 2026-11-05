// BROWSER TEST PURPOSE: recovery choices and ranking user workflows and regression coverage.
// Setup opens the real Vue UI; actions use its controls; assertions check visible results/state.
// Uses isolated fixture responses; passing UI checks do not prove deployed database or delivery integration.
// Purpose: fixture-backed recovery choices and ranking browser regressions for simulator controls and state.
// Use Setup -> Actions -> Assert; real Vue/engine code runs, but these tests do not prove live Supabase integration.
import {test,expect} from '../e2e/helpers/browserUi.js'
import {bootSimulatorPreview,runScenario} from './helpers/simulatorPreviewHarness.js'
// Inspect and preview are separate operations: clicking View score must never
// select a replacement or send an invitation. Values come from the real service.
test('candidate search, View score, actual evidence and pink preview selection',async({page})=>{
 await bootSimulatorPreview(page,{many:true});await runScenario(page)
 const candidates=page.getByRole('region',{name:'Replacement candidates for Fixture affected member',exact:true})
 await expect(candidates.getByRole('group',{name:'Inspect replacement candidates for Fixture affected member'}).getByRole('button')).toHaveCount(3)
 await candidates.getByLabel('Search candidates', {exact:true}).fill('Fixture standby 11')
 const row=candidates.getByRole('button',{name:/Fixture standby 11/});await row.click()
 const panel=page.getByTestId('candidate-score-panel');await expect(panel).toContainText('Why this candidate?');await expect(panel).toContainText('0 tasks');await expect(panel).toContainText('Unverified');await expect(panel.getByRole('meter')).toHaveCount(0)
 const workflow=page.getByRole('region',{name:'Persisted recovery workflow',exact:true});await expect(workflow).toHaveAttribute('data-selected-recovery','')
 await panel.getByRole('button',{name:'Use this alternative',exact:true}).click();await expect(workflow).toHaveAttribute('data-selected-recovery','combined-selected');await expect(row).toHaveClass(/chosen/);await expect(row).toHaveCSS('background-color','rgb(255, 241, 242)')
 await expect(page.locator('#simulator-comparison')).toContainText('Fixture standby 11');await expect(panel).toContainText('No invitation sent')
})
for(const type of ['MEMBER_UNAVAILABLE','FACILITY_UNAVAILABLE','SCHEDULE_DELAY'])test('only relevant recovery panels and comparison data: '+type,async({page})=>{
 await bootSimulatorPreview(page);await runScenario(page,type)
 const members=page.getByRole('region',{name:/Replacement candidates for/}),facilities=page.getByRole('region',{name:'Facility and schedule choices',exact:true})
 await expect(members).toHaveCount(type==='MEMBER_UNAVAILABLE'?1:0);await expect(facilities).toHaveCount(type==='MEMBER_UNAVAILABLE'?0:1)
 const comparison=page.getByRole('region',{name:'Plan Comparison',exact:true});await expect(comparison).toContainText('Select a recovery plan')
 await page.getByRole('article',{name:'Recovery plan 1',exact:true}).getByRole('button',{name:'Select this plan',exact:true}).click()
 await expect(comparison.getByRole('columnheader',{name:'Original',exact:true})).toBeVisible();await expect(comparison.getByRole('columnheader',{name:'Proposed',exact:true})).toBeVisible();await expect(comparison).toContainText('changed activities')
 await expect(comparison.getByRole('button')).toHaveCount(0)
 await expect(comparison).toContainText(type==='MEMBER_UNAVAILABLE'?'Member':type==='FACILITY_UNAVAILABLE'?'Facility':'Schedule')
 await expect(comparison.getByRole('row').filter({hasText:'Unchanged'})).not.toHaveCount(0)
})
test('ranking retains evaluator order and factors with one legend and one display selector',async({page})=>{
 await bootSimulatorPreview(page,{many:true});await runScenario(page)
 const ranking=page.getByRole('region',{name:'Combined recovery ranking',exact:true}),selector=ranking.getByLabel('Number of ranked plans')
 await expect(ranking.getByLabel('Score colour guide',{exact:true})).toHaveCount(1);await expect(ranking.getByRole('button',{name:/Show all/})).toHaveCount(0)
 for(const limit of ['3','all']){await selector.selectOption(limit);const expected=await page.evaluate(()=>{const ps=window.__evaluated.rankedPlans;return (ps.some(p=>p.kind==='combined')?ps.filter(p=>p.kind==='combined'||p.kind==='custom'):ps).map(p=>({id:p.id,score:p.score,factors:p.scoreBreakdown}))});const visible=limit==='all'?expected:expected.slice(0,Number(limit));await expect(ranking.getByRole('article')).toHaveCount(visible.length);for(let i=0;i<visible.length;i++)await expect(ranking.getByRole('article').nth(i)).toHaveAttribute('data-plan-id',visible[i].id)}
 const first=ranking.getByRole('article').first(),expected=await page.evaluate(()=>window.__evaluated.rankedPlans[0])
 await expect(first.getByLabel('Overall recovery score')).toContainText(expected.score+'/100')
 await first.getByLabel('Plan rationale').locator(':scope > summary').click()
 for(const [key,name] of [['conflict','Conflict resolution'],['timetable','Timetable'],['workload','Staffing / workload'],['venue','Venue suitability']])await expect(first.getByRole('meter',{name,exact:true})).toHaveAttribute('aria-valuenow',String(expected.scoreBreakdown[key]))
 await first.getByTestId('follow-up-actions').locator(':scope > summary').click();await expect(first.getByText('Full activity changes',{exact:true})).toBeVisible();await first.getByText('Scoring evidence',{exact:true}).click();await expect(first.locator('pre')).toHaveCount(0);await expect(first.locator('[id^=plan-evidence]')).toContainText('final workflow eligibility is checked before Apply')
})
test('duplicate follow-ups collapse once with readable evidence and truthful unavailable scores',async({page})=>{
 await bootSimulatorPreview(page,{invalidScore:true,duplicateWarnings:true});await runScenario(page)
 const first=page.getByRole('article',{name:'Recovery plan 1',exact:true});await expect(first.getByLabel('Overall recovery score').locator('strong')).toHaveText('Score unavailable');await expect(first.getByRole('meter',{name:'Conflict resolution',exact:true})).toHaveCount(0)
 await first.getByTestId('follow-up-actions').locator(':scope > summary').click();const issues=first.getByTestId('follow-up-actions');await expect(issues.getByRole('listitem').filter({hasText:'Fixture verification duplicated'})).toHaveCount(1)
 await issues.getByRole('link').first().click();await expect(first.locator('[id^=plan-evidence]')).toHaveAttribute('open','');await expect(first.locator('pre')).toHaveCount(0);await expect(issues.getByRole('listitem').filter({hasText:'Fixture verification duplicated'})).toHaveCount(1)
 await expect(page.getByLabel('Score colour guide',{exact:true})).toContainText('never approval or readiness')
})
