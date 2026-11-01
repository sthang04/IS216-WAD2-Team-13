import {createTelegramTransport} from './telegramTransport.js'

/** Isolated service-to-service queue. No public notifications, browser-selected
 * recipients, original sender invocations, test-chat fanout or automatic retries. */
export function createSimulatorInvitationHandler({client,env,fetchImpl=fetch}) {
 return async request => {
  // Authenticate before reading private queue rows. Browser JWTs do not
  // authorize this backend worker or select its notification recipients.
  const serviceKey=env.get('SUPABASE_SERVICE_ROLE_KEY')
  if(!serviceKey || request.headers.get('Authorization')!=='Bearer '+serviceKey)
   return Response.json({error:'Unauthorized'},{status:401})
  if(request.method!=='POST')return Response.json({error:'POST required'},{status:405,headers:{Allow:'POST'}})
  if(env.get('SIMULATOR_TELEGRAM_ENABLED')!=='true' || env.get('TELEGRAM_DELIVERY_MODE')!=='live')
   return Response.json({enabled:false,checked:0})
  const botToken=env.get('TELEGRAM_BOT_TOKEN')
  if(!botToken)return Response.json({error:'Telegram configuration unavailable'},{status:503})
  let link
  try {
   const url=new URL(env.get('PULSE_BASE_URL'))
   if(url.protocol!=='https:' || url.username || url.password ||
    ['localhost','127.0.0.1','0.0.0.0','[::1]'].includes(url.hostname) || url.hostname.endsWith('.local'))throw Error()
   url.pathname='/personal-schedule';url.search='';url.hash='simulator-invitation-inbox'
   link=url.toString()
  }catch{return Response.json({error:'A public HTTPS PULSE_BASE_URL is required'},{status:503})}
  // The database atomically claims eligible invitations once. Sending is
  // separate from acceptance and does not change event assignments.
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
    delivery=data?.telegram_chat_id==null?'NO_CHAT':(await send({
     chatId:data.telegram_chat_id,title:'Replacement invitation',
     body:'You have a replacement request. Sign in to PULSE and open Personal Schedule > My replacement invitations to review and respond.',link
    })).status
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
