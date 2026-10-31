// Browser activation is an opt-in, not authorization. PostgreSQL independently
// enforces identity, permissions, release gates, consent and stale-state checks.
export function simulatorWorkflowActivation(env={}){
 const staging='xbtauyiinkrxvfrqakbw',production='bdqzysnapwxdzppkuftn'
 if(env.VITE_SIMULATOR_WORKFLOW_ENABLED!=='true')return {enabled:false,reason:'Live updates are awaiting backend activation and safety verification.'}
 const ref=env.VITE_SIMULATOR_WORKFLOW_PROJECT_REF
 if(![staging,production].includes(ref))return {enabled:false,reason:'Recovery activation requires an explicitly approved project reference.'}
 if(env.VITE_SUPABASE_URL?.trim()!=='https://'+ref+'.supabase.co')return {enabled:false,reason:'Recovery activation project does not match the configured Supabase URL.'}
 if(ref===production&&env.VITE_SIMULATOR_PRODUCTION_APPROVED!=='true')return {enabled:false,reason:'Production recovery activation requires separate explicit approval.'}
 return {enabled:true,projectRef:ref,reason:'Frontend RPC requests enabled for '+(ref===staging?'PULSE-Staging':'PULSE')+'. Backend authorization and release gates still apply.'}
}
export function simulatorWorkflowError(error){
 const message=error?.message || String(error)
 if(error?.code==='55000'||/not released for real operations/i.test(message))
  return 'Backend recovery activation is OFF. No update was applied. '+message
 if(/revision|version|event changed|changed after|later event edits/i.test(message))
  return message+' Refresh event data and persisted history, review the current revision, then confirm again. No automatic retry was made.'
 return message
}
