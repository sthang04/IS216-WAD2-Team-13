// Lecture-style UI regressions for alert queue feedback. Responses are synthetic;
// actual database scoping is covered separately by e2e-backend/telegramAlerts.spec.js.
import {test,expect} from './fixtures/app.js'
async function openOps(page,app,options={}){await page.clock.setFixedTime(new Date('2026-11-03T15:15:00+08:00'));await app.open('/operations',{authenticated:true,opsSample:true,...options})}

test('Notify crew reports a queue refusal and allows another attempt',async({page,app})=>{
 // Setup: the backend refuses the notification while the actual Ops page remains usable.
 await openOps(page,app,{rpcError:'rpc_notify_ops_schedule_change'})
 // Actions: use the normal notification control.
 const button=page.getByRole('button',{name:/^Notify crew/});await button.click()
 // Assert: a refusal is not reported as Telegram delivery or success.
 await expect(page.getByRole('alert')).toContainText('Telegram alerts could not be queued:')
 await expect(button).toBeEnabled()
})

test('Notify crew disables repeat clicks until the backend acknowledges the queue',async({page,app})=>{
 // Setup: hold the actual RPC boundary while leaving the UI responsive.
 await openOps(page,app,{holdRpc:'rpc_notify_ops_schedule_change'})
 const button=page.getByRole('button',{name:/^Notify crew/})
 // Actions: request a crew notification and inspect the in-flight state.
 await button.click();await expect(button).toBeDisabled()
 await expect(button.getByRole('status')).toBeVisible()
 await page.evaluate(()=>window.__foundation.release('rpc_notify_ops_schedule_change'))
 // Assert: success describes a queued message; delivery is a separate worker outcome.
 await expect(page.getByRole('alert')).toContainText('Telegram alerts queued for 3 crew members.')
 await expect(button).toBeEnabled()
})
