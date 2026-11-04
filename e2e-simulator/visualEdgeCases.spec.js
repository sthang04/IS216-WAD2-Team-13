// Purpose: fixture-backed visual Edge Cases browser regressions for simulator controls and state.
// Use Setup -> Actions -> Assert; real Vue/engine code runs, but these tests do not prove live Supabase integration.
import {test,expect} from '@playwright/test'
import {bootRefinement,runScenario,openHeatmap} from './helpers/refinementHarness.js'

// Overlapping activities are loaded as real schedule records. The existing
// engine/model, rather than test-specific UI statuses, determines precedence.
for(const type of ['MEMBER_UNAVAILABLE','FACILITY_UNAVAILABLE'])test('overlapping active rows and heatmap precedence: '+type,async({page})=>{
 await bootRefinement(page,{overlap:true});await runScenario(page,type)
 const active=page.getByRole('region',{name:'Activities at selected time',exact:true}),slider=page.getByRole('slider',{name:'Timeline playback time',exact:true})
 await slider.fill('15');await expect(active.getByRole('button')).toHaveCount(2);await expect(active).toContainText('2 activities')
 for(let i=0;i<2;i++){await active.getByRole('button').nth(i).click();await expect(slider).toHaveValue('15');await expect(page.getByRole('group',{name:'Activity booths',exact:true}).getByRole('button').nth(i)).toHaveAttribute('aria-pressed','true')}
 await openHeatmap(page);const heat=page.locator('#impact-facilities'),cell=heat.locator('.sim-heat-cell').first()
 await expect(cell).toHaveClass(type==='FACILITY_UNAVAILABLE'?/outage/:/conflict/);await cell.click();const evidence=heat.getByRole('status',{name:'Selected facility slot'});await expect(evidence).toContainText('Event activities overlap in this room.');await expect(evidence).toContainText('Fixture activity 1');await expect(evidence).toContainText('Fixture activity 2')
 await expect(heat).toContainText('does not mean a room is available or approved')
})
