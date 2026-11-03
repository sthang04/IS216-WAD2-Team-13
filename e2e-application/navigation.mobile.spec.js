import {test,expect} from './fixtures/app.js'

test('touch navigation reaches student pages and supports account logout',async({page,app})=>{
 await app.open('/facilities',{authenticated:true})
 const navigation=page.getByLabel('Navigate PULSE',{exact:true})
 await expect(navigation).toBeVisible()
 await navigation.selectOption('schedule')
 await expect(page).toHaveURL(/\/personal-schedule$/)
 await expect(page.getByRole('heading',{name:/Hi Fixture Exco/})).toBeVisible()
 await navigation.selectOption('operations')
 await expect(page.getByRole('heading',{name:'Live Operations Command Center',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Account menu for Fixture Exco',exact:true}).tap()
 await page.getByRole('button',{name:'Sign Out to Landing',exact:true}).tap()
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
 await expect(page.getByRole('heading',{name:'Pending Admin Sign-off (0)',exact:true})).toBeVisible()
 await page.goto('/facilities')
 await expect(page.getByRole('heading',{name:'Pulse - Master Facility Calendar',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'OSL Review',exact:true}).tap({timeout:5000})
 await expect(page).toHaveURL(/\/facilities\/admin$/)
 await expect(page.getByRole('heading',{name:'Pending Admin Sign-off (0)',exact:true})).toBeVisible()
})
