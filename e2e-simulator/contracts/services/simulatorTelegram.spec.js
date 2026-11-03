// Playwright contract checks; these do not launch a browser or prove live RLS.
// Isolated worker authorization, deduplication, missing configuration, delivery uncertainty and
// unchanged shared sender. All transport/database calls are mocked; no messages are sent.
import {test} from '@playwright/test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {stripTypeScriptTypes} from 'node:module'
import {createSimulatorInvitationHandler} from '../../../supabase/functions/_shared/simulatorInvitationWorker.js'

const baseline='831eb6571d4ce2ddac9cd828523df240bbdccf8e'
const senderPath='supabase/functions/send-telegram-notifications/index.ts'
const original=execFileSync('git',['show',baseline+':'+senderPath],{encoding:'utf8'})
const current=readFileSync(new URL('../../../'+senderPath,import.meta.url),'utf8')
const claim=(id='invitation')=>({id,claim_id:'claim-'+id,recipient_member_id:7})
function simulator({mode='live',enabled='true',token='fake',linked=true,fail=false,network=false,finish=true,queueError=false,lookupError=false,base='https://pulse.example.test',rows=[claim()]}={}){
 let claimed=false;const sends=[],results=[],calls=[]
 const env={SUPABASE_SERVICE_ROLE_KEY:'fake-service',TELEGRAM_BOT_TOKEN:token,TELEGRAM_DELIVERY_MODE:mode,SIMULATOR_TELEGRAM_ENABLED:enabled,PULSE_BASE_URL:base}
 const client={from(table){assert.equal(table,'telegram_links','private worker must not touch public notifications or test chats')
  const q={select(){return q},eq(field,id){assert.equal(field,'member_id');assert.equal(id,7);return q},maybeSingle:async()=>({data:linked?{telegram_chat_id:123}:null,error:lookupError?{}:null})};return q
 },async rpc(name,args){calls.push(name)
  if(name==='rpc_simulator_claim_telegram'){
   if(queueError)throw Error('private queue offline')
   if(claimed)return {data:[]};claimed=true;return {data:rows}
  }
  assert.equal(name,'rpc_simulator_finish_telegram');results.push(args)
  return {data:typeof finish==='function'?finish(args):finish}
 }}
 const handler=createSimulatorInvitationHandler({client,env:{get:key=>env[key]},fetchImpl:async(url,options)=>{
  sends.push(JSON.parse(options.body));if(network)throw Error('request URL with secret must never be logged or returned')
  return Response.json({ok:!fail,result:fail?undefined:{message_id:1}},{status:fail?400:200})
 }})
 return {run:(auth='fake-service',method='POST')=>handler(new Request('https://worker.test',{method,headers:auth==null?{}:{Authorization:'Bearer '+auth}})),sends,results,calls}
}
function legacy(source=current,{type='WAITLIST_OFFER',mode='live',linked=true,fail=false,queueError=false}={}){
 let handler;const sends=[],updates=[]
 const env={SUPABASE_URL:'https://example.test',SUPABASE_SERVICE_ROLE_KEY:'fake-service',TELEGRAM_BOT_TOKEN:'fake',TELEGRAM_DELIVERY_MODE:mode,PULSE_BASE_URL:'https://pulse.example.test',TELEGRAM_TEST_CHAT_ID:'222',SIMULATOR_TELEGRAM_ENABLED:'true'}
 const row={id:9,recipient_member_id:7,recipient_club_id:3,type,title:'Title',body:'Body',action_url:'/facilities'}
 const client={from(table){let status
  const q={select(){return q},eq(key,value){if(status)updates.push({id:value,status});return q},order(){return q},update(value){status=value.telegram_status;return q},limit:async()=>({data:queueError?null:[row],error:queueError?{message:'legacy queue offline'}:null}),maybeSingle:async()=>({data:linked?{telegram_chat_id:111}:null}),then(resolve,reject){return Promise.resolve(table==='telegram_test_chats'?{data:[{chat_id:222},{chat_id:333}]}:{data:null}).then(resolve,reject)}};return q
 },rpc(){assert.fail('original sender must never claim simulator work')}}
 const js=stripTypeScriptTypes(source.replaceAll('\r\n','\n').replace(/import .* from .*\n/,''))
 new Function('createClient','Deno','fetch','console',js)(()=>client,{env:{get:key=>env[key]},serve:fn=>{handler=fn}},async(url,options)=>{sends.push(JSON.parse(options.body));return Response.json({ok:!fail},{status:fail?400:200})},{error(){},warn(){}})
 return {async run(auth='fake-service'){const r=await handler(new Request('https://worker.test',{method:'POST',headers:{Authorization:'Bearer '+auth}}));return {http:r.status,body:await r.json(),sends,updates}},sends,updates}
}

test('original shared sender exactly matches merged-main source; webhook and frontend service are unchanged',()=>{
 assert.equal(current.replaceAll('\r\n','\n'),original.replaceAll('\r\n','\n'))
 for(const path of ['supabase/functions/telegram-webhook/index.ts','src/services/notificationService.js']){
  const a=readFileSync(new URL('../../../'+path,import.meta.url),'utf8').replaceAll('\r\n','\n')
  const b=execFileSync('git',['show',baseline+':'+path],{encoding:'utf8'}).replaceAll('\r\n','\n')
  assert.equal(a,b)
 }
})
test('all five original event types preserve exact templates, recipients, links and status updates',async()=>{
 for(const type of ['WAITLIST_OFFER','WAITLIST_REMINDER','TRANSFER_APPROVED','TRANSFER_REJECTED','TRANSFER_EXPIRED']){
  const a=await legacy(original,{type}).run(),b=await legacy(current,{type}).run();assert.deepEqual(b,a)
  assert.equal(b.body.sent,1);assert.equal(b.sends[0].chat_id,'111');assert.deepEqual(b.updates,[{id:9,status:'SENT'}])
  assert.match(b.sends[0].reply_markup.inline_keyboard[0][0].url,/as=7&club=3/)
 }
})
test('original test-chat fanout, missing recipient, failed send, skipped type and queue errors match baseline',async()=>{
 for(const options of [{mode:'test'},{linked:false},{fail:true},{type:'ORDINARY_IN_APP'},{queueError:true}]){
  assert.deepEqual(await legacy(current,options).run(),await legacy(original,options).run())
 }
 const r=await legacy(current,{mode:'test'}).run();assert.deepEqual(r.sends.map(s=>s.chat_id),['222','333']);assert.match(r.sends[0].text,/PULSE TEST NOTIFICATION/)
})
test('existing service/manual JWT invocation behavior remains baseline-identical at handler level',async()=>{
 // Gateway JWT verification is external; these mocks do not establish which
 // manual callers are authorized by the deployed platform.
 for(const token of ['fake-service','signed-user-jwt','legacy-anon-jwt'])assert.deepEqual(await legacy(current).run(token),await legacy(original).run(token))
})
test('dedicated worker requires backend credential, rejects browsers/users/anonymous calls before any queue access',async()=>{
 const w=simulator()
 for(const token of [null,'','anon','user-jwt','wrong-service'])assert.equal((await w.run(token)).status,401)
 assert.equal((await w.run('fake-service','GET')).status,405);assert.equal(w.calls.length,0);assert.equal(w.sends.length,0)
})
test('private invitation is sent once, concurrent invocations use a mocked atomic claim, and link requires PULSE login',async()=>{
 const w=simulator();await Promise.all([w.run(),w.run()]);await w.run()
 assert.equal(w.sends.length,1);assert.equal(w.sends[0].chat_id,'123')
 assert.equal(w.sends[0].reply_markup.inline_keyboard[0][0].url,'https://pulse.example.test/personal-schedule#simulator-invitation-inbox')
 assert.equal(w.results[0].p_status,'SENT');assert.equal(w.results[0].p_claim_id,'claim-invitation')
 assert.doesNotMatch(w.sends[0].text,/claim-invitation/)
})
test('missing account, rejected Telegram send and failed chat lookup record separate accurate delivery results',async()=>{
 for(const [options,status] of [[{linked:false},'NO_CHAT'],[{fail:true},'FAILED'],[{lookupError:true},'FAILED']]){
  const w=simulator(options);const r=await (await w.run()).json();assert.equal(r.sent,0);assert.equal(w.results[0].p_status,status)
  await w.run();assert.equal(w.results.length,1)
 }
})
test('network uncertainty is recorded as UNKNOWN and is never automatically resent',async()=>{
 const w=simulator({network:true});const r=await (await w.run()).json();assert.equal(r.sent,0);assert.equal(r.unknown,1)
 assert.equal(w.results[0].p_status,'UNKNOWN');assert.doesNotMatch(JSON.stringify(r),/secret|api.telegram/)
 await w.run();assert.equal(w.sends.length,1)
})
test('failed delivery persistence stays unconfirmed, cannot overwrite possible success, and does not abort next invitation',async()=>{
 const w=simulator({rows:[claim('first'),claim('second')],finish:a=>a.p_id!=='first'})
 const response=await w.run(),r=await response.json();assert.equal(response.status,207)
 assert.equal(r.sent,1);assert.equal(r.unknown,1);assert.equal(w.sends.length,2)
 assert.deepEqual(w.results.map(r=>r.p_status),['SENT','SENT']);await w.run();assert.equal(w.sends.length,2)
})
test('missing configuration, disabled worker, test mode and unsafe base URLs never claim private invitations',async()=>{
 for(const options of [{token:''},{enabled:'false'},{mode:'test'},{base:''},{base:'http://localhost:5173'},{base:'https://user:pass@pulse.example.test'}]){
  const w=simulator(options);await w.run();assert.equal(w.calls.length,0);assert.equal(w.sends.length,0)
 }
})
test('private queue failure cannot prevent original notifications and original queue failure cannot prevent simulator delivery',async()=>{
 const privateWorker=simulator({queueError:true}),shared=legacy()
 const [a,b]=await Promise.all([privateWorker.run(),shared.run()]);assert.equal(a.status,503);assert.equal(b.body.sent,1)
 const privateHealthy=simulator(),sharedBroken=legacy(current,{queueError:true})
 const [c,d]=await Promise.all([privateHealthy.run(),sharedBroken.run()]);assert.equal((await c.json()).sent,1);assert.equal(d.http,500)
})
test('simulator SQL claim is private, service-only, bounded, stale-aware and idempotent without public notification writes',()=>{
 const sql=readFileSync(new URL('../../../supabase/migrations/20261101101919_simulator_telegram_delivery.sql',import.meta.url),'utf8')
 assert.equal((sql.match(/AS \$\$/g)||[]).length,3);assert.equal((sql.match(/END \$\$;/g)||[]).length,3)
 assert.match(sql,/ENABLE ROW LEVEL SECURITY/);assert.match(sql,/LIMIT 5 FOR UPDATE OF i SKIP LOCKED/)
 assert.match(sql,/delivery_status='Pending Delivery'/);assert.match(sql,/telegram_claim_id=p_claim_id AND delivery_status='Sending'/)
 assert.match(sql,/FROM PUBLIC,anon,authenticated/);assert.match(sql,/TO service_role/)
 assert.match(sql,/i.recipient_member_id=actor/);assert.match(sql,/THEN 'Stale'/)
 assert.match(sql,/delivery_status=p_status/);assert.match(sql,/'UNKNOWN'/)
 assert.doesNotMatch(sql,/INSERT INTO public.notifications|UPDATE simulator_private.release_gate|cron.schedule/)
})
