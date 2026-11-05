// Retained non-browser Playwright checks isolate recipient privacy and transport failures.
// These complement browser/database journeys and never send an actual Telegram message.
import {test,expect} from '@playwright/test'
import {resolveTelegramRecipients} from '../../../supabase/functions/_shared/notificationRecipientRouting.js'
import {createSimulatorInvitationHandler} from '../../../supabase/functions/_shared/simulatorInvitationWorker.js'
const routes=[{member_id:7,persona_label:'Assigned member',telegram_chat_id:123},{member_id:null,persona_label:'Notification observer',telegram_chat_id:999,copy_all:true}]
const notice=id=>({recipient_member_id:id,type:'SCHEDULE_CHANGED',title:'Private schedule',body:'Private content'})

const observerCopy={chatId:'999',label:'Notification observer (copy)'}
test('a member with a login gets their own alert and the observer gets a copy, with no hardcoded route',()=>{
 const signedUp={...notice(80),recipient_user_id:'user-80'}
 expect(resolveTelegramRecipients(signedUp,routes,800,new Set())).toEqual([{chatId:'800',label:null},observerCopy])
 expect(resolveTelegramRecipients(signedUp,routes,null,new Set())).toEqual([observerCopy])
})
test('a seeded member with no login produces no observer copy',()=>{
 expect(resolveTelegramRecipients(notice(80),routes,null,new Set())).toEqual([])
})
test('an explicit link wins over a recipient mapping, and private alerts are copied too',()=>{
 expect(resolveTelegramRecipients(notice(7),routes,700,new Set())).toEqual([{chatId:'700',label:'Assigned member'},observerCopy])
 expect(resolveTelegramRecipients(notice(7),routes,null,new Set())).toEqual([{chatId:'123',label:'Assigned member'},observerCopy])
})

test('simulator delivery with configured routing uses a new member link and copies the observer',async()=>{
 let claimed=false;const messages=[],completed=[]
 const values={SUPABASE_SERVICE_ROLE_KEY:'service-test',TELEGRAM_BOT_TOKEN:'fake-token',TELEGRAM_DELIVERY_MODE:'demo',PULSE_BASE_URL:'https://pulse.example.test'}
 const client={from(table){
  if(table==='demo_recipient_routes')return {select:async()=>({data:routes})}
  if(table==='members'){const q={select(){return q},eq(){return q},maybeSingle:async()=>({data:{auth_user_id:'user-80'}})};return q}
  expect(table).toBe('telegram_links')
  const q={select(){return q},eq(field,id){expect(field).toBe('member_id');expect(id).toBe(80);return q},maybeSingle:async()=>({data:{telegram_chat_id:800}})};return q
 },async rpc(name,args){
  if(name==='rpc_simulator_claim_telegram'){if(claimed)return {data:[]};claimed=true;return {data:[{id:'invitation',claim_id:'claim',recipient_member_id:80,event_name:'Saved event'}]}}
  expect(name).toBe('rpc_simulator_finish_telegram');completed.push(args);return {data:true}
 }}
 const handler=createSimulatorInvitationHandler({client,env:{get:k=>values[k]},fetchImpl:async(url,options)=>{messages.push(JSON.parse(options.body));return Response.json({ok:true,result:{message_id:1}})}})
 const request=()=>new Request('https://worker.test',{method:'POST',headers:{Authorization:'Bearer service-test'}})
 expect((await handler(request())).status).toBe(200)
 await handler(request())
 expect(messages.map(m=>m.chat_id)).toEqual(['800','999']);expect(messages[0].text).toContain('Saved event')
 expect(completed[0].p_status).toBe('SENT')
})

// Retained contract: a rotated runtime key does not break the existing Vault
// Cron credential. The comparison happens before claiming, and exposes no secret.
test('the scheduled Vault credential is validated before an empty private queue is read',async()=>{
 const calls=[]
 const client={async rpc(name,args){
  calls.push(name)
  if(name==='rpc_simulator_telegram_authorized'){expect(args.p_bearer).toBe('cron-test');return {data:true}}
  expect(name).toBe('rpc_simulator_claim_telegram');return {data:[]}
 }}
 const values={SUPABASE_SERVICE_ROLE_KEY:'runtime-test',TELEGRAM_BOT_TOKEN:'fake',TELEGRAM_DELIVERY_MODE:'live',PULSE_BASE_URL:'https://pulse.example.test'}
 const handler=createSimulatorInvitationHandler({client,env:{get:k=>values[k]},fetchImpl:()=>{throw Error('Empty queue must not send')}})
 const response=await handler(new Request('https://worker.test',{method:'POST',headers:{Authorization:'Bearer cron-test'}}))
 expect(response.status).toBe(200)
 expect(calls).toEqual(['rpc_simulator_telegram_authorized','rpc_simulator_claim_telegram'])
})