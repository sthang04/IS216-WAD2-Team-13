// Test-only safety checks; never imported by the production application.
export const STAGING_REF='xbtauyiinkrxvfrqakbw'
export const STAGING_URL='https://'+STAGING_REF+'.supabase.co'
export const LOCAL_ORIGIN='http://127.0.0.1:5187'
export const READ_ONLY_RPCS=new Set(['rpc_simulator_workflow_capabilities','rpc_simulator_event_roster','rpc_simulator_plan_history','rpc_simulator_my_invitations','rpc_simulator_invitation','cfg_bool','cfg_int','cfg_text','rpc_my_notifications','rpc_my_telegram_link'])
export function stagingTestEnvironment(env){
 const key=env.PULSE_STAGING_PUBLISHABLE_KEY?.trim()
 if(!key)throw Error('STAGING TEST NOT RUN: set PULSE_STAGING_PUBLISHABLE_KEY; production .env.local is never used as a fallback.')
 if(key.startsWith('sb_secret_'))throw Error('STAGING TEST NOT RUN: service-role/secret keys are forbidden.')
 if(!key.startsWith('sb_publishable_')){
  let claims
  try{claims=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString('utf8'))}catch{}
  if(claims?.role!=='anon'||claims?.ref!==STAGING_REF)throw Error('STAGING TEST NOT RUN: provide a public key for PULSE-Staging only.')
 }
 if(!env.PULSE_STAGING_STORAGE_STATE)throw Error('STAGING TEST NOT RUN: provide PULSE_STAGING_STORAGE_STATE from a normal staging account; no credentials are fabricated.')
 return {VITE_SUPABASE_URL:STAGING_URL,VITE_SUPABASE_ANON_KEY:key,VITE_SIMULATOR_WORKFLOW_ENABLED:'false',VITE_SIMULATOR_PRODUCTION_APPROVED:'false'}
}
export function validateStagingStorage(state){
 if(!Array.isArray(state?.origins))throw Error('Invalid staging browser storage state.')
 const keys=state.origins.flatMap(origin=>(origin.localStorage||[]).map(item=>item.name))
 if(keys.some(key=>key.includes('bdqzysnapwxdzppkuftn')))throw Error('Production session detected; use a separate staging browser profile.')
 if(!state.origins.some(origin=>origin.origin===LOCAL_ORIGIN&&(origin.localStorage||[]).some(item=>item.name==='sb-'+STAGING_REF+'-auth-token')))
  throw Error('No normal staging session saved for '+LOCAL_ORIGIN+'.')
}
export function allowedStagingRequest(address,method='GET'){
 let url
 try{url=new URL(address)}catch{return false}
 if(url.origin===LOCAL_ORIGIN)return ['GET','HEAD'].includes(method)
 if(url.origin!==STAGING_URL)return false
 if(url.pathname==='/auth/v1/token')return method==='POST'&&url.searchParams.get('grant_type')==='refresh_token'
 if(url.pathname==='/auth/v1/user')return method==='GET'
 if(!url.pathname.startsWith('/rest/v1/'))return false
 if(url.pathname.startsWith('/rest/v1/rpc/'))return method==='POST'&&READ_ONLY_RPCS.has(url.pathname.slice('/rest/v1/rpc/'.length))
 return ['GET','HEAD'].includes(method)
}
