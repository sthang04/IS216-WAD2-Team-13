// WHY THIS FILE IS RETAINED: Checks that the live-test network guard permits reads/authentication and rejects operational writes.
// These focused regression checks preserve edge cases that browser journeys may not isolate.
// SCOPE: Non-browser checks using the Playwright test runner; excluded from browser E2E commands.
// A passing result here does not prove a complete user journey or deployed backend enforcement.
// Unit contracts for the real-backend request guard; these are not browser E2E.
import {test,expect} from '@playwright/test'
import {isReadOnlyBackendRequest} from '../../helpers/readOnlyBackend.js'
const backend='https://configured-project.example.test'
test('real-backend guard permits actual SELECT and explicitly read-only RPC requests',()=>{
 expect(isReadOnlyBackendRequest(backend+'/rest/v1/ops_tasks','GET',backend)).toBe(true)
 expect(isReadOnlyBackendRequest(backend+'/rest/v1/rpc/rpc_simulator_event_sources','POST',backend)).toBe(true)
 expect(isReadOnlyBackendRequest(backend+'/rest/v1/rpc/rpc_simulator_plan_history','POST',backend)).toBe(true)
})
test('real-backend guard blocks invitation, booking, Apply/Undo and direct table writes',()=>{
 for(const path of ['rpc_simulator_apply_plan','rpc_simulator_undo_plan','rpc_simulator_start_plan','rpc_simulator_invite','rpc_claim_booking'])expect(isReadOnlyBackendRequest(backend+'/rest/v1/rpc/'+path,'POST',backend)).toBe(false)
 for(const method of ['POST','PATCH','DELETE'])expect(isReadOnlyBackendRequest(backend+'/rest/v1/ops_tasks',method,backend)).toBe(false)
 expect(isReadOnlyBackendRequest('https://other.example.test/rest/v1/rpc/rpc_simulator_plan_history','POST',backend)).toBe(false)
})
test('normal authentication is allowed without inventing a session or enabling signup writes',()=>{
 expect(isReadOnlyBackendRequest(backend+'/auth/v1/token?grant_type=password','POST',backend)).toBe(true)
 expect(isReadOnlyBackendRequest(backend+'/auth/v1/token?grant_type=refresh_token','POST',backend)).toBe(true)
 expect(isReadOnlyBackendRequest(backend+'/auth/v1/signup','POST',backend)).toBe(false)
})
