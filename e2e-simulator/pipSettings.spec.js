// BROWSER TEST PURPOSE: pip Settings user workflows and regression coverage.
// Setup opens the real Vue UI; actions use its controls; assertions check visible results/state.
// Uses isolated fixture responses; passing UI checks do not prove deployed database or delivery integration.
// Purpose: fixture-backed pip Settings browser regressions for simulator controls and state.
// Use Setup -> Actions -> Assert; real Vue/engine code runs, but these tests do not prove live Supabase integration.
import {test,expect} from '@playwright/test'

test('simulator Pip settings persist, reverse, and synchronize with another Pip',async({page})=>{
 test.skip(test.info().project.name.startsWith('mobile'), 'Simulator Pip is intentionally hidden on mobile')
 await page.route('https://**',r=>r.abort())
 await page.route('**/src/services/simulationDataService.js*',r=>r.fulfill({contentType:'application/javascript',body:"import {campusConnectMultiEventFixture} from '/e2e-simulator/fixtures/campusConnect.js';export async function loadSimulationData(){return campusConnectMultiEventFixture()}"}))
 await page.goto('/e2e-simulator/harness.html')
 async function run(){
  await page.getByLabel('Disruption type',{exact:true}).selectOption('SCHEDULE_DELAY')
  await page.getByRole('button',{name:'Run simulation (1)',exact:true}).click()
 }
 await run()
 const pip=page.locator('.simulation-pip'),button=pip.locator('.pip-button')
 async function menu(){await button.click({button:'right',force:true})}
 await expect(pip.locator('.pip-speech')).toBeVisible()
 await expect(button).not.toHaveCSS('animation-name','none')
 await menu()
 await pip.getByRole('menuitemradio',{name:'Keep Pip still'}).click()
 await expect(button).toHaveCSS('animation-name','none')
 await menu()
 await expect(pip.getByRole('menuitemradio',{name:'Keep Pip still'})).toHaveAttribute('aria-checked','true')
 await pip.getByRole('menuitemcheckbox',{name:'Hide speech bubble'}).click()
 await expect(pip.locator('.pip-speech')).toHaveCount(0)
 await expect(button).toBeVisible()
 await button.click()
 await expect(pip.locator('.pip-panel')).toContainText('Downstream Risks')
 const summary=await button.getAttribute('aria-controls')
 await expect(pip.locator('.pip-panel')).toHaveAttribute('id',summary)
 await expect(page.getByRole('region',{name:'Event impact workspace',exact:true})).toBeVisible()
 await run()
 await expect(button).toHaveCSS('animation-name','none')
 await expect(pip.locator('.pip-speech')).toHaveCount(0)
 // Event changes remove/recreate the mascot but must preserve browser preferences.
 page.once('dialog',d=>d.accept())
 await page.getByLabel('Event',{exact:true}).selectOption('990003')
 await expect(page.getByLabel('Event',{exact:true})).toHaveValue('990003')
 await run()
 await expect(button).toHaveCSS('animation-name','none')
 await menu()
 await expect(pip.getByRole('menuitemcheckbox',{name:'Hide speech bubble'})).toHaveAttribute('aria-checked','true')
 await page.keyboard.press('Escape')
 // Mount the real notification mascot against the same store to test concurrent instances.
 await page.evaluate(async()=>{
  const {createApp,h}=await import('/node_modules/.vite/deps/vue.js')
  const {default:Pip}=await import('/src/components/PipMascot.vue')
  const {notificationStore,setPipStatic,setPipQuiet}=await import('/src/services/notificationStore.js')
  const host=document.createElement('div');host.id='second-pip';document.body.append(host)
  createApp({render:()=>h(Pip,{unansweredCount:2,isStatic:notificationStore.value.pipStatic,isQuiet:notificationStore.value.pipQuiet,'onUpdate:isStatic':setPipStatic,'onUpdate:isQuiet':setPipQuiet,style:{right:'400px'}})}).mount(host)
 })
 const other=page.locator('#second-pip')
 await expect(other.locator('.pip-button')).toHaveCSS('animation-name','none')
 await expect(other.locator('.pip-speech')).toHaveCount(0)
 const ids=await page.locator('.pip-container linearGradient').evaluateAll(nodes=>nodes.map(n=>n.id))
 expect(new Set(ids).size).toBe(2)
 for(const mascot of [pip,other]){
  const id=await mascot.locator('linearGradient').getAttribute('id')
  await expect(mascot.locator('path[fill^="url"]')).toHaveAttribute('fill','url(#'+id+')')
 }
 expect(await other.locator('.pip-button').getAttribute('aria-controls')).not.toBe(await button.getAttribute('aria-controls'))
 await other.locator('.pip-button').click({button:'right',force:true})
 await other.getByRole('menuitemradio',{name:'Let Pip jump around'}).click()
 await expect(button).not.toHaveCSS('animation-name','none')
 await menu()
 await expect(pip.getByRole('menuitemradio',{name:'Let Pip jump around'})).toHaveAttribute('aria-checked','true')
 await pip.getByRole('menuitemcheckbox',{name:'Hide speech bubble'}).click()
 await expect(pip.locator('.pip-speech')).toBeVisible()
 await expect(other.locator('.pip-speech')).toBeVisible()
 expect(await page.evaluate(()=>[localStorage.getItem('pulse_pip_static'),localStorage.getItem('pulse_pip_quiet')])).toEqual(['false','false'])
 // Stored settings are restored after a full page load as well.
 await menu();await pip.getByRole('menuitemradio',{name:'Keep Pip still'}).click()
 await menu();await pip.getByRole('menuitemcheckbox',{name:'Hide speech bubble'}).click()
 page.once('dialog',d=>d.accept())
 await page.reload();await run()
 await expect(button).toHaveCSS('animation-name','none')
 await expect(pip.locator('.pip-speech')).toHaveCount(0)
})