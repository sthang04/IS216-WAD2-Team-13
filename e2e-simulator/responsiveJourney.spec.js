import {test,expect} from '@playwright/test'
import {bootRecovery} from './helpers/recoveryHarness.js'
async function act(page,locator){if(await page.evaluate(()=>navigator.maxTouchPoints>0))await locator.tap();else await locator.click()}
async function fits(page){
 const overflow=await page.evaluate(()=>({width:window.innerWidth,total:document.documentElement.scrollWidth,outliers:[...document.querySelectorAll('section,select,input,button,dialog[open],.table-responsive')].filter(e=>{const b=e.getBoundingClientRect();return b.width>0&&(b.right>innerWidth+1||b.left< -1)&&!e.closest('.sim-graph-scroll,.sim-heat-scroll,.table-responsive')}).map(e=>({tag:e.tagName,label:e.getAttribute('aria-label')||e.textContent.slice(0,50),width:e.getBoundingClientRect().width})).slice(0,8)}))
 expect(overflow.total,JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.width+1)
}
async function bootSimulation(page){
 await page.route('https://**',r=>r.abort())
 await page.route('**/src/services/simulationDataService.js*',r=>r.fulfill({contentType:'application/javascript',body:"import {campusConnectFixture} from '/e2e-simulator/fixtures/campusConnect.js';export async function loadSimulationData(){return campusConnectFixture()}"}))
 await page.goto('/e2e-simulator/harness.html')
 await page.getByLabel('Unavailable from (Singapore)',{exact:true}).selectOption('2026-11-02T10:00')
 await page.getByLabel('Unavailable until (Singapore)',{exact:true}).selectOption('2026-11-02T10:30')
 await act(page,page.getByRole('button',{name:'Run simulation (1)',exact:true}))
 await expect(page.getByText('Simulation complete',{exact:true})).toBeVisible()
}
// Projects supply the viewport; avoid multiplying a second device matrix.
test.describe('responsive workflow',()=>{
 test('simulation, impact, touch selection, facilities and comparison',async({page})=>{
  // Setup: project viewport and isolated fixture data define this journey.
  const {width}=page.viewportSize()
  await bootSimulation(page);await fits(page)
  const build=page.getByRole('region',{name:'Build your recovery',exact:true}),ranking=page.getByRole('region',{name:'Combined recovery ranking',exact:true})
  const bb=await build.boundingBox(),rb=await ranking.boundingBox()
  expect(rb.y).toBeGreaterThanOrEqual(bb.y+bb.height)
  await build.scrollIntoViewIfNeeded();

  const builder=await page.getByRole('region',{name:'Scenario builder',exact:true}).boundingBox(),impact=await page.getByRole('region',{name:'Event impact workspace',exact:true}).boundingBox()
  expect(impact.y).toBeGreaterThanOrEqual(builder.y+builder.height)
  // Actions: inspect the map, scrub playback, then choose recovery resources.
  const graph=page.getByRole('region',{name:'Scrollable Event Village',exact:true})
  await graph.scrollIntoViewIfNeeded();await act(page,graph.locator('.sim-graph-node').last())
  // Assert: selection is shared with the calculated activity model.
  await expect(graph.locator('.sim-graph-node').last()).toHaveAttribute('aria-pressed','true')
  await fits(page)
  await page.getByRole('button',{name:'Show heatmap',exact:true}).click()
  const timeline=page.locator('#impact-timeline'),heatmap=page.locator('#impact-facilities')
  const tl=await timeline.boundingBox(),hm=await heatmap.boundingBox()
  if(width>=1024){expect(Math.abs(tl.y-hm.y)).toBeLessThan(2);expect(hm.x).toBeGreaterThan(tl.x)}
  else expect(hm.y).toBeGreaterThan(tl.y)
  await timeline.scrollIntoViewIfNeeded()
  await act(page,timeline.getByRole('button',{name:/^original$/i}));await expect(timeline.locator('.sim-time-bar.simulated')).toHaveCount(0)
  await act(page,timeline.getByRole('button',{name:/^overlay$/i}))
  await act(page,timeline.getByRole('button',{name:'Play timeline',exact:true}))
  const slider=timeline.getByRole('slider',{name:'Timeline playback time',exact:true})
  await expect.poll(async()=>Number(await slider.inputValue())).toBeGreaterThan(0)
  await act(page,timeline.getByRole('button',{name:'Pause timeline',exact:true}));await slider.fill('15')
  await act(page,heatmap.locator('.sim-heat-cell').last());await expect(heatmap.locator('.sim-inspection')).toBeVisible();await fits(page)
  await timeline.scrollIntoViewIfNeeded();
  const list=page.locator('[data-candidate-id]'),details=page.getByRole('region',{name:'Candidate details',exact:true})
  await act(page,list.nth(1));await act(page,details.getByRole('button',{name:'Use in recovery preview',exact:true}))
  await expect(page.getByRole('region',{name:'Persisted recovery workflow',exact:true})).toHaveAttribute('data-selected-recovery','combined-selected')
  const listBox=await page.locator('.candidate-list').boundingBox(),detailBox=await details.boundingBox()
  expect(detailBox.y>listBox.y || detailBox.x>listBox.x).toBe(true)
  await details.scrollIntoViewIfNeeded();await fits(page);if(width<768)expect(Math.round((await details.getByRole('button',{name:'In recovery preview',exact:true}).boundingBox()).height*100)/100).toBeGreaterThanOrEqual(44);
  await page.getByLabel('Disruption type',{exact:true}).selectOption('FACILITY_UNAVAILABLE')
  await act(page,page.getByRole('button',{name:'Run simulation (1)',exact:true}))
  const option=page.locator('[data-facility-option]').first()
  await act(page,option.getByRole('button',{name:'Use this alternative',exact:true}))
  await expect(option).toHaveClass(/chosen/)
  await expect(page.locator('#simulator-comparison')).toContainText('Fixture Alternative Room')
  await act(page,page.locator('.recovery-choice').first().getByRole('button',{name:/Select this plan|Selected plan/}))
  await page.locator('#simulator-comparison').scrollIntoViewIfNeeded();await fits(page)
  await act(page,page.getByRole('button',{name:'Manage bookings',exact:true}));await expect(page.getByRole('dialog',{name:'Manage Facility Bookings',exact:true})).toBeVisible();await fits(page);
  await act(page,page.getByRole('button',{name:'Return to simulator',exact:true}))
 })
 test('saved tracker, pending approvals, Apply confirmation, blocked Undo and restoration',async({page})=>{
  const panel=await bootRecovery(page);await fits(page)
  const tracker=panel.getByRole('region',{name:'Pending recovery requirements',exact:true})
  await tracker.scrollIntoViewIfNeeded();
  const scroll=tracker.locator('.table-responsive');const needsScroll=await scroll.evaluate(e=>e.scrollWidth>e.clientWidth+1);await scroll.evaluate(e=>e.scrollLeft=e.scrollWidth);if(needsScroll)await expect.poll(()=>scroll.evaluate(e=>e.scrollLeft)).toBeGreaterThan(0)
  await page.evaluate(()=>{window.__localInvitation.status='Pending';window.__localPlan.actions[0].status='Pending'})
  await act(page,panel.getByRole('button',{name:'Refresh statuses',exact:true}))
  await expect(tracker).toContainText('Awaiting response');await expect(panel.getByRole('button',{name:'Apply selected recovery',exact:true})).toBeDisabled()
  await page.evaluate(()=>{window.__localInvitation.status='Accepted';window.__localPlan.actions[0].status='Accepted'})
  await act(page,panel.getByRole('button',{name:'Refresh statuses',exact:true}))
  async function confirm(){const dialog=panel.getByRole('dialog',{name:'Action confirmation',exact:true});await expect(dialog).toBeVisible();await fits(page);await dialog.getByRole('checkbox').check();await act(page,dialog.getByRole('button',{name:'Confirm selected action',exact:true}))}
  await act(page,panel.getByRole('button',{name:'Apply selected recovery',exact:true}));await confirm()
  await expect(panel).toContainText('Recovery committed by the server.')
  expect(await page.evaluate(()=>window.__localPlan.application_status)).toBe('Applied')
  await act(page,panel.getByRole('button',{name:'Undo Recovery Plan',exact:true}));await confirm();await expect(panel.getByRole('alert')).toContainText('Explicitly resolve')
  await panel.locator('#resolution-1').fill('Original member independently confirmed availability for this isolated test.')
  await act(page,panel.getByRole('button',{name:'Mark disruption 1 resolved',exact:true}));await confirm()
  await act(page,panel.getByRole('button',{name:'Undo Recovery Plan',exact:true}));await confirm()
  await expect(panel).toContainText('Recovery reversed by the server; review the reopened issue.')
  expect(await page.evaluate(()=>window.__localPlan.application_status)).toBe('Undone')
  expect(await page.evaluate(()=>window.__localDb.segment_assignments.find(a=>a.id===1).member_id)).toBe(1)
  await fits(page)
 })
})
