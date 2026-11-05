import {createTelegramTransport} from './telegramTransport.js'
import {resolveTelegramRecipients} from './notificationRecipientRouting.js'

/** Isolated service-to-service queue. No public notifications, browser-selected
 * recipients, original sender invocations, test-chat fanout or automatic retries. */
export function createSimulatorInvitationHandler({client,env,fetchImpl=fetch}) {
 return async request => {
  // Authenticate before reading private queue rows. Browser JWTs do not
  // authorize this backend worker or select its notification recipients.
  const serviceKey=env.get('SUPABASE_SERVICE_ROLE_KEY')
  const header=request.headers.get('Authorization')||''
  let authorized=!!serviceKey && header==='Bearer '+serviceKey
  // Cron may use the project's older Vault service credential. Validate that
  // opaque value through a service-only comparison, before any private queue read.
  if(!authorized && header.startsWith('Bearer ')){
   try{const {data,error}=await client.rpc('rpc_simulator_telegram_authorized',{p_bearer:header.slice(7)});authorized=!error && data===true}catch{}
  }
  if(!authorized)return Response.json({error:'Unauthorized'},{status:401})
  if(request.method!=='POST')return Response.json({error:'POST required'},{status:405,headers:{Allow:'POST'}})
  // The database release gate is authoritative; an explicit env false can still disable delivery.
  const mode=env.get('TELEGRAM_DELIVERY_MODE')
  if(env.get('SIMULATOR_TELEGRAM_ENABLED')==='false' || !['live','demo'].includes(mode))
   return Response.json({enabled:false,checked:0})
  const botToken=env.get('TELEGRAM_BOT_TOKEN')
  if(!botToken)return Response.json({error:'Telegram configuration unavailable'},{status:503})
  let link
  try {
   let base=env.get('PULSE_BASE_URL')
   if(!base){const {data,error}=await client.rpc('cfg_text',{p_key:'pulse_base_url'});if(error)throw Error();base=data}
   const url=new URL(base)
   if(url.protocol!=='https:' || url.username || url.password ||
    ['localhost','127.0.0.1','0.0.0.0','[::1]'].includes(url.hostname) || url.hostname.endsWith('.local'))throw Error()
   url.pathname='/personal-schedule';url.search='';url.hash='simulator-invitation-inbox'
   link=url.toString()
  }catch{return Response.json({error:'A public HTTPS PULSE_BASE_URL is required'},{status:503})}
  // The database atomically claims eligible invitations once. Sending is
  // separate from acceptance and does not change event assignments.
  let recipientRoutes=[]
  if(mode==='demo'){
   const {data,error}=await client.from('demo_recipient_routes').select('*')
   if(error)return Response.json({error:'Recipient routing unavailable'},{status:503})
   recipientRoutes=data||[]
  }
  let invitations
  try {
   const {data,error}=await client.rpc('rpc_simulator_claim_telegram')
   if(error || !Array.isArray(data))throw Error()
   invitations=data
  }catch{return Response.json({error:'Private invitation queue unavailable'},{status:503})}
  const send=createTelegramTransport({botToken,fetchImpl})
  const results=[]
  // Make one network attempt per claim. A timeout is ambiguous, so automatic
  // retries could notify the same member twice.
  for(const invitation of invitations){
   let delivery='FAILED'
   try {
    if(!invitation?.id || !invitation.claim_id || invitation.recipient_member_id==null)throw Error()
    const {data,error}=await client.from('telegram_links').select('telegram_chat_id')
     .eq('member_id',invitation.recipient_member_id).maybeSingle()
    if(error)throw Error()
    const targets=mode==='demo'?resolveTelegramRecipients({recipient_member_id:invitation.recipient_member_id,type:'SIMULATOR_INVITATION',title:invitation.id,body:''},recipientRoutes,data?.telegram_chat_id,new Set(),{allowCopies:false}):data?.telegram_chat_id==null?[]:[{chatId:data.telegram_chat_id}]
    if(!targets.length)delivery='NO_CHAT'
    else{
     const result=await send({chatId:targets[0].chatId,title:'Replacement invitation',
      body:(invitation.event_name?'Event: '+invitation.event_name+'\n':'')+'You have a replacement request. Sign in to PULSE and open Personal Schedule > My replacement invitations to review and respond.',link})
     delivery=result.status
    }
   }catch{delivery='FAILED'}
   // A persistence error must NOT overwrite a possible SENT with FAILED or
   // abort another invitation. Sending remains unconfirmed and never reclaimed.
   try {
    const {data,error}=await client.rpc('rpc_simulator_finish_telegram',{
     p_id:invitation.id,p_claim_id:invitation.claim_id,p_status:delivery
    })
    if(error || data!==true)throw Error()
    results.push({id:invitation.id,status:delivery})
   }catch{results.push({id:invitation?.id,status:'UNCONFIRMED'})}
  }
  return Response.json({checked:results.length,
   sent:results.filter(r=>r.status==='SENT').length,
   failed:results.filter(r=>r.status==='FAILED').length,
   no_chat:results.filter(r=>r.status==='NO_CHAT').length,
   unknown:results.filter(r=>['UNKNOWN','UNCONFIRMED'].includes(r.status)).length,results
  },{status:results.some(r=>r.status==='UNCONFIRMED')?207:200})
 }
}
