import {test,expect} from '@playwright/test'
import {bootRefinement} from './helpers/refinementHarness.js'
// Discovery failures and disabled activation must not turn a visible radio or
// local confirmation into permission to link a booking. Success is covered by
// originalBooking.spec.js with a fully isolated in-memory RPC implementation.
test('three-step booking modal preserves evidence, refresh and fail-closed linking',async({page})=>{
 await bootRefinement(page)
 await page.getByLabel('Disruption type',{exact:true}).selectOption('FACILITY_UNAVAILABLE')
 const section=page.getByRole('region',{name:'Facility Bookings',exact:true});await expect(section).toContainText('8 of 8 linked')
 await section.getByRole('button',{name:'Manage bookings',exact:true}).click()
 const modal=page.getByRole('dialog',{name:'Manage Facility Bookings',exact:true});await expect(modal.getByRole('heading',{name:'1. Choose an activity',exact:true})).toBeVisible();await expect(modal.getByRole('heading',{name:'2. Find an existing booking',exact:true})).toBeVisible();await expect(modal.getByRole('heading',{name:'3. Verify and link',exact:true})).toBeVisible()
 await modal.getByLabel('Activity for calendar',{exact:true}).selectOption('2')
 await expect(modal.getByRole('link',{name:'Open Facility Calendar for selected activity',exact:true})).toHaveAttribute('href','/facilities?week=2026-11-02')
 await modal.getByText('Inspect linked records for Fixture activity 2 (1)',{exact:true}).click();await expect(modal).toContainText('Fixture Original Room');await expect(modal).toContainText('Booking 1')
 await modal.getByRole('button',{name:'Find eligible original bookings',exact:true}).click();await expect(modal).toContainText('Original booking linking is unavailable')
 await expect(modal.getByRole('button',{name:'Link approved booking to activity',exact:true})).toBeDisabled()
 await modal.getByLabel('I confirm this booking and activity, actual audience capacity, required equipment and suitability.',{exact:true}).check();await expect(modal.getByRole('button',{name:'Link approved booking to activity',exact:true})).toBeDisabled()
 await modal.getByRole('button',{name:'Refresh booking information',exact:true}).click();await expect(modal.getByLabel('I confirm this booking and activity, actual audience capacity, required equipment and suitability.',{exact:true})).not.toBeChecked()
 await modal.getByRole('button',{name:'Return to simulator',exact:true}).click();await expect(modal).not.toBeVisible()
})

test('permission-denied booking discovery stays actionable but cannot link',async({page})=>{
 await bootRefinement(page)
 // Replace only the already-mocked transport. A denied read must surface its
 // reason without constructing eligible booking records or unlocking a write.
 await page.evaluate(async()=>{const {supabase}=await import('/src/supabase.js');const read=supabase.rpc;supabase.rpc=async(name,args)=>name==='rpc_simulator_original_booking_candidates'?{error:{message:'Event management permission required'}}:read(name,args)})
 await page.getByLabel('Disruption type',{exact:true}).selectOption('FACILITY_UNAVAILABLE');await page.getByRole('button',{name:'Manage bookings',exact:true}).click();const modal=page.getByRole('dialog',{name:'Manage Facility Bookings',exact:true});await modal.getByRole('button',{name:'Find eligible original bookings',exact:true}).click();await expect(modal.getByRole('alert')).toContainText('Event management permission required');await expect(modal.getByRole('button',{name:'Link approved booking to activity',exact:true})).toBeDisabled();await expect(modal.getByRole('radio')).toHaveCount(0)
})
