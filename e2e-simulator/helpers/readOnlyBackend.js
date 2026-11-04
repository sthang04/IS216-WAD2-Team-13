// SUPPORT FILE PURPOSE: readOnlyBackend.js supplies shared setup or controlled data for the browser workflows.
// Keep this support code: the Playwright tests depend on consistent setup and isolated state.
// A request guard, not a mock: allowed requests reach the configured backend.
// Read RPCs use POST in Supabase, so distinguish them from operational writes.
export const READ_ONLY_RPCS=new Set([
 'rpc_simulator_workflow_capabilities','rpc_simulator_event_sources','rpc_simulator_ops_context',
 'rpc_simulator_ops_roster','rpc_simulator_event_roster','rpc_simulator_plan_history',
 'rpc_simulator_my_invitations','rpc_simulator_invitation','rpc_simulator_capture_state',
 'rpc_simulator_original_booking_candidates','rpc_club_roster','rpc_my_baseline',
 'rpc_club_baselines','rpc_meeting_snapshot','rpc_my_notifications','rpc_my_telegram_link',
 'rpc_club_transfers','rpc_recent_transfer_decisions','cfg_bool','cfg_int','cfg_text',
])
export function isReadOnlyBackendRequest(address,method='GET',backendOrigin=null){
 const url=new URL(address)
 if(!['GET','HEAD','OPTIONS'].includes(method) && backendOrigin && url.origin!==backendOrigin)return false
 // This existing Edge Function only fetches walking-route estimates; its
 // implementation performs no booking/task/database mutations.
 if(url.pathname==='/functions/v1/onemap-walk')return method==='POST'
 if(url.pathname.startsWith('/rest/v1/rpc/'))return method==='POST'&&READ_ONLY_RPCS.has(url.pathname.split('/').at(-1))
 if(url.pathname==='/auth/v1/token')return method==='POST'&&['password','refresh_token'].includes(url.searchParams.get('grant_type'))
 return ['GET','HEAD','OPTIONS'].includes(method)
}
export async function guardReadOnlyBackend(context,backendOrigin=null){
 const blocked=[]
 await context.route('**/*',route=>{
  const request=route.request(),url=new URL(request.url())
  // Local app assets and external GETs remain genuine network requests too.
  if(isReadOnlyBackendRequest(url.href,request.method(),backendOrigin))return route.continue()
  blocked.push({method:request.method(),path:url.pathname})
  return route.abort('blockedbyclient')
 })
 return blocked
}
