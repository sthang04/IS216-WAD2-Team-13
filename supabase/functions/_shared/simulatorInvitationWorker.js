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
    let recipientUserId=null
    if(mode==='demo'){const member=await client.from('members').select('auth_user_id').eq('id',invitation.recipient_member_id).maybeSingle();if(member.error)throw Error();recipientUserId=member.data?.auth_user_id??null}
    const targets=mode==='demo'?resolveTelegramRecipients({recipient_member_id:invitation.recipient_member_id,recipient_user_id:recipientUserId,type:'SIMULATOR_INVITATION',title:invitation.id,body:''},recipientRoutes,data?.telegram_chat_id,new Set()):data?.telegram_chat_id==null?[]:[{chatId:data.telegram_chat_id}]
    if(!targets.length)delivery='NO_CHAT'
    else{
     const message=invitationMessage(invitation,link)
     const result=await send({...message,chatId:targets[0].chatId})
     delivery=result.status
     // A copy never changes the recipient's delivery status
     for(const copy of targets.slice(1)){try{await send({...message,chatId:copy.chatId})}catch{}}
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

// Singapore time, e.g. "Sat 14 Nov, 16:30", or just "18:00"
function sgTime(value,withDay=true){
 const date=new Date(value)
 if(!Number.isFinite(date.getTime()))return ''
 const options=withDay
  ?{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}
  :{hour:'2-digit',minute:'2-digit',hourCycle:'h23'}
 return date.toLocaleString('en-SG',{timeZone:'Asia/Singapore',...options})
}

/** What the replacement request says on Telegram. Its button opens Personal
 * Schedule > My replacement invitations, where they accept or decline.
 * The details come from rpc_simulator_claim_telegram. Until
 * 20261106110000_replacement_request_message.sql is run only the event name and
 * the number of activities are known, so the message is shorter. */
export function invitationMessage(invitation,link){
 const lines=[]
 if(invitation.event_name)lines.push('Event: '+invitation.event_name)
 lines.push(invitation.replaced_name?'You have been asked to cover for '+invitation.replaced_name+'.':'You have been asked to cover a role.')
 const activities=Array.isArray(invitation.assignment_snapshot)?invitation.assignment_snapshot:[]
 for(const a of activities.slice(0,3)){
  const from=sgTime(a.starts_at)
  const until=sgTime(a.ends_at,false)
  lines.push('• '+(a.activity||'Activity')+(a.role_name?' ('+a.role_name+')':'')+(from?', '+from+(until?'–'+until:''):''))
 }
 if(activities.length>3)lines.push('• and '+(activities.length-3)+' more')
 if(!activities.length && invitation.activity_count)lines.push(invitation.activity_count+' '+(invitation.activity_count===1?'activity':'activities')+' to cover.')
 const deadline=invitation.expires_at?sgTime(invitation.expires_at):''
 if(deadline)lines.push('Please reply by '+deadline+'.')
 lines.push('Tap Review request to accept or decline in Personal Schedule > My replacement invitations.')
 lines.push('Accepting assigns you straight away. No organiser approval is needed.')
 return {title:'Replacement request',body:lines.join('\n'),link,buttonText:'Review request'}
}
