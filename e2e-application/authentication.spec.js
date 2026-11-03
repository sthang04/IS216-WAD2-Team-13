import {test,expect} from './fixtures/app.js'

test('valid login reaches the calendar; logout revokes protected navigation',async({page,app})=>{
 await app.open();await app.login()
 await expect(page).toHaveURL(/\/facilities$/)
 await expect(page.getByRole('heading',{name:'Pulse - Master Facility Calendar',exact:true})).toBeVisible()
 await app.account()
 await expect(page.getByText('Fixture Arts Club Logistics Director',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Sign Out to Landing',exact:true}).click()
 await expect(page).toHaveURL(/\/$/)
 await page.goto('/operations')
 await expect(page).toHaveURL(/\/?redirect=/)
 await expect(page.locator('input[autocomplete="current-password"]')).toBeVisible()
})

test('invalid credentials report failure and allow a successful retry',async({page,app})=>{
 await app.open();await app.login('Incorrect123!')
 await expect(page.getByRole('alert')).toContainText('Incorrect email or password.')
 await expect(page).toHaveURL(/\/$/)
 await app.login()
 await expect(page).toHaveURL(/\/facilities$/)
})

test('non-SMU email is rejected before authentication',async({page,app})=>{
 await app.open()
 await page.locator('input[name="smu_user_login_email"]').fill('fixture@example.com')
 await page.locator('input[name="smu_user_password"]').fill('FixturePass123!')
 await page.locator('form button[type="submit"]').click()
 await expect(page.getByRole('alert')).toContainText('Access restricted')
 expect(await page.evaluate(()=>window.__foundation.calls.filter(c=>c.name==='signIn'))).toEqual([])
})

test('membership lookup failure denies login rather than granting a role',async({page,app})=>{
 await app.open('/',{membershipError:true});await app.login()
 await expect(page.getByRole('alert')).toContainText('Pulse sign-in is for CCA ExCos and OSL staff.')
 await expect(page.getByRole('button',{name:'Account menu for Fixture Exco',exact:true})).toHaveCount(0)
})

test('restored session survives refresh; missing session redirects a protected URL',async({page,app})=>{
 await app.open('/personal-schedule',{authenticated:true})
 await expect(page.getByRole('heading',{name:/Hi Fixture Exco/})).toBeVisible()
 await page.reload()
 await expect(page.getByRole('heading',{name:/Hi Fixture Exco/})).toBeVisible()
 await page.evaluate(()=>window.__foundation.expire())
 await page.reload()
 await expect(page).toHaveURL(/\/?redirect=/)
 await expect(page.locator('input[autocomplete="current-password"]')).toBeVisible()
})

test('signup rejects an email absent from the ExCo list',async({page,app})=>{
 await app.open('/signup',{signupStatus:'not_listed'})
 await page.getByLabel('SMU email address',{exact:true}).fill('fixture.exco@smu.edu.sg')
 await page.getByRole('button',{name:/Continue/}).click()
 await expect(page.getByRole('alert')).toContainText("This email isn't on the ExCo list.")
 await expect(page.getByLabel('Full name',{exact:true})).toHaveCount(0)
})

test('eligible signup validates matching passwords then creates a synthetic account',async({page,app})=>{
 await app.open('/signup')
 await page.getByLabel('SMU email address',{exact:true}).fill('fixture.exco@smu.edu.sg')
 await page.getByRole('button',{name:/Continue/}).click()
 await expect(page.getByLabel('Full name',{exact:true})).toHaveValue('Fixture Exco')
 await page.getByLabel('ExCo position',{exact:true}).selectOption('LOGISTICS')
 await page.getByLabel('Telegram handle',{exact:true}).fill('fixture_handle')
 await page.getByLabel('Password',{exact:true}).fill('FixturePass123!')
 await page.getByLabel('Confirm password',{exact:true}).fill('Mismatch123!')
 await page.getByRole('button',{name:/Create account/}).click()
 await expect(page.getByRole('alert')).toContainText("The two passwords don't match.")
 expect(await page.evaluate(()=>window.__foundation.calls.filter(c=>c.name==='signUp'))).toEqual([])
 await page.getByLabel('Confirm password',{exact:true}).fill('FixturePass123!')
 await page.getByRole('button',{name:/Create account/}).click()
 await expect(page).toHaveURL(/\/facilities$/)
 await app.account()
 await expect(page.getByText('fixture.exco@smu.edu.sg',{exact:true})).toBeVisible()
})

test('remembered real account requires its password after logout',async({page,app})=>{
 await app.open();await app.login();await expect(page).toHaveURL(/\/facilities$/)
 await app.account();await page.getByRole('button',{name:'Sign Out to Landing',exact:true}).click()
 await expect(page.locator('input[autocomplete="current-password"]')).toBeVisible()
 await expect(page.getByRole('button',{name:/Fast Sign-In/})).toHaveCount(0)
 await page.getByPlaceholder('Password',{exact:true}).fill('FixturePass123!')
 await page.getByRole('button',{name:/Sign In as Fixture/}).click()
 await expect(page).toHaveURL(/\/facilities$/)
})

test('authenticated account without an active membership is denied',async({page,app})=>{
 await app.open('/',{noMembership:true});await app.login()
 await expect(page.getByRole('alert')).toContainText('Pulse sign-in is for CCA ExCos and OSL staff.')
 await page.goto('/facilities/admin')
 await expect(page).toHaveURL(/redirect=/)
 await expect(page.locator('input[name="smu_user_password"]')).toBeVisible()
})
