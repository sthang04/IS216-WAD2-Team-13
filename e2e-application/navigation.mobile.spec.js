// BROWSER TEST PURPOSE: navigation.mobile user workflows and regression coverage.
// Setup opens the real Vue UI; actions use its controls; assertions check visible results/state.
// Uses isolated fixture responses; passing UI checks do not prove deployed database or delivery integration.
import {test,expect} from './fixtures/app.js'

test('touch navigation reaches student pages and supports account logout',async({page,app})=>{
 await app.open('/facilities',{authenticated:true})
 // Phones use the ☰ hamburger drawer instead of the desktop header pills.
 const menu=page.getByRole('button',{name:'Toggle Navigation Menu',exact:true})
 await expect(menu).toBeVisible()
 await expect(menu).toHaveAttribute('aria-expanded','false')
 // The closed drawer must not be reachable by touch, keyboard or screen readers.
 await expect(page.getByRole('complementary',{name:'Navigation menu',exact:true})).toHaveCount(0)
 await app.navigate('schedule','Personal Schedule')
 await expect(page).toHaveURL(/\/personal-schedule$/)
 await expect(page.getByRole('heading',{name:/Hi Fixture,/})).toBeVisible()
 await app.navigate('operations','Day-of Operations')
 await expect(page.getByRole('heading',{name:'Day-of Operations',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Account menu for Fixture Exco',exact:true}).tap()
 await page.getByRole('button',{name:'Sign out',exact:true}).tap()
 await expect(page).toHaveURL(/\/$/)
 await expect(page.locator('input[autocomplete="current-password"]')).toBeVisible()
})

test('signup form is usable within the mobile viewport',async({page,app})=>{
 await app.open('/signup')
 await page.getByLabel('SMU email address',{exact:true}).fill('fixture.exco@smu.edu.sg')
 await page.getByRole('button',{name:/Continue/}).tap()
 await expect(page.getByLabel('Full name',{exact:true})).toHaveValue('Fixture Exco')
 const bounds=await page.getByRole('button',{name:/Create account/}).boundingBox()
 expect(bounds.x).toBeGreaterThanOrEqual(0)
 expect(bounds.x+bounds.width).toBeLessThanOrEqual(page.viewportSize().width)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width+1)
 await page.getByRole('button',{name:/Already have an account/}).tap()
 await expect(page.locator('input[name="smu_user_login_email"]')).toBeVisible()
})

test('OSL administrator can reach transfer review from mobile navigation',async({page,app})=>{
 // Prove the synthetic role can load the route before checking its navigation.
 await app.open('/facilities/admin',{authenticated:true,role:'admin'})
 await expect(page.getByRole('heading',{name:'Awaiting OSL approval (0)',exact:true})).toBeVisible()
 await page.goto('/facilities')
 await expect(page.getByRole('heading',{name:'Pulse - Master Facility Calendar',exact:true})).toBeVisible()
 // Open the hamburger drawer and tap the OSL-only entry inside it.
 await page.getByRole('button',{name:'Toggle Navigation Menu',exact:true}).tap()
 const drawer=page.getByRole('complementary',{name:'Navigation menu',exact:true})
 await drawer.getByRole('button',{name:'OSL Review',exact:true}).tap()
 await expect(page).toHaveURL(/\/facilities\/admin$/)
 await expect(page.getByRole('heading',{name:'Awaiting OSL approval (0)',exact:true})).toBeVisible()
})

test('hamburger drawer opens, closes from its close button and backdrop, and hides when closed',async({page,app})=>{
 // Setup: a signed-in club member on a phone-sized viewport.
 await app.open('/facilities',{authenticated:true})
 const menu=page.getByRole('button',{name:'Toggle Navigation Menu',exact:true})
 const drawer=page.getByRole('complementary',{name:'Navigation menu',exact:true})
 // Action: open the drawer. Assert: every student page is offered and the toggle reports it is open.
 await menu.tap()
 await expect(menu).toHaveAttribute('aria-expanded','true')
 for(const name of ['Master Facility Calendar','Personal Schedule','Availability Heatmap','Day-of Operations','Event Risk Planning'])
  await expect(drawer.getByRole('button',{name,exact:true})).toBeVisible()
 // Action: close with the drawer's own close button.
 await drawer.getByRole('button',{name:'Close navigation menu',exact:true}).tap()
 await expect(drawer).toHaveCount(0)
 // Action: reopen, then tap the dimmed backdrop beside the drawer.
 await menu.tap()
 await expect(drawer).toBeVisible()
 await page.mouse.click(10,page.viewportSize().height/2)
 // Assert: closed again and the page did not change.
 await expect(menu).toHaveAttribute('aria-expanded','false')
 await expect(page).toHaveURL(/\/facilities$/)
})
