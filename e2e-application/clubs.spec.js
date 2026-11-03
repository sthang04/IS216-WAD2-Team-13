import {test,expect} from './fixtures/app.js'

test('switching clubs changes dashboard scope and facility permissions',async({page,app})=>{
 await app.open('/facilities/my-club',{authenticated:true,facilities:true,multipleClubs:true})
 await expect(page.getByRole('heading',{name:'Fixture Arts Club',exact:true})).toBeVisible()
 await expect(page.getByRole('button',{name:'Release',exact:true})).toBeVisible()
 await page.locator('#clubSwitcher').selectOption('Fixture Other Club')
 await expect(page.getByRole('heading',{name:'Fixture Other Club',exact:true})).toBeVisible()
 await expect(page.getByText('View only.',{exact:true})).toBeVisible()
 await expect(page.getByRole('button',{name:'Release',exact:true})).toHaveCount(0)
 await page.locator('#clubSwitcher').selectOption('Fixture Arts Club')
 await expect(page.getByRole('button',{name:'Release',exact:true})).toBeVisible()
})

test('My Club release moves assigned booking into its released section',async({page,app})=>{
 await app.open('/facilities/my-club',{authenticated:true,facilities:true})
 await page.locator('#section-assigned').getByRole('button',{name:'Release',exact:true}).click()
 await page.getByRole('dialog',{name:'Release this slot?',exact:true}).getByRole('button',{name:'Release slot',exact:true}).click()
 await expect(page.locator('#section-released')).toContainText('Fixture Dance Studio')
 await expect(page.locator('#section-released').getByRole('button',{name:'Undo Release',exact:true})).toBeVisible()
})

test('failed outgoing transfer email can be retried after explicit review',async({page,app})=>{
 await app.open('/facilities/my-club',{authenticated:true,facilities:true,transfers:true,emailFailed:true})
 await page.getByRole('button',{name:'Resend to OSL',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'Resend the transfer request to OSL?',exact:true})
 await expect(dialog).toContainText('FIXTURE-FBS-502')
 await dialog.getByRole('button',{name:'Resend to OSL',exact:true}).click()
 await expect(page.getByRole('status').filter({hasText:'Request queued for OSL.'})).toBeVisible()
 await expect(page.locator('#section-pending')).toContainText('Emailed to OSL for review')
 await expect(page.getByRole('button',{name:'Resend to OSL',exact:true})).toHaveCount(0)
})
