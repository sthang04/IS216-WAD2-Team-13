// SUPPORT FILE PURPOSE: client.js supplies shared setup or controlled data for the browser workflows.
// Keep this support code: the Playwright tests depend on consistent setup and isolated state.
import {createBackend} from '/e2e-application/fixtures/backend.js'
// Browser-only synthetic Supabase boundary. No network client is constructed.
// Real authService, sessionState, router and all Vue components remain intact.
const KEY='pulse-foundation-session'
const CONFIG='pulse-foundation-config'
const config=()=>JSON.parse(sessionStorage.getItem(CONFIG)||'{}')
const user=()=>JSON.parse(sessionStorage.getItem(KEY)||'null')
const listeners=[]
const session=()=>user()?{user:user(),access_token:'synthetic-token'}:null
function changed(event){for(const fn of listeners)fn(event,session())}
function save(value){if(value)sessionStorage.setItem(KEY,JSON.stringify(value));else sessionStorage.removeItem(KEY)}
function row(){
 const role=config().role||'club'
 return {user_id:user()?.id,member_id:7001,full_name:'Fixture Exco',club_id:71,
  club_name:'Fixture Arts Club',role_name:role==='admin'?'OSL Administrator':role==='member'?'Member':'Logistics Director',
  role_code:role==='admin'?'OSL_ADMIN':role==='member'?'MEMBER':'LOGISTICS',
  membership_is_active:true,is_admin_role:role==='admin',
  can_claim_booking:role==='club',can_release_booking:role==='club',
  can_manage_waitlist:role==='club',can_manage_members:role==='club',
  can_send_transfer_email:role==='club'}
}
window.__foundation={calls:[],expire(){save(null);changed('SIGNED_OUT')}}
const result=data=>({data,error:null})
const backend=createBackend(config,window.__foundation.calls)
Object.assign(window.__foundation,backend.controls)
export const isSupabaseConfigured=()=>true
export const supabase={
 auth:{
  async getSession(){return result({session:session()})},
  async getUser(){return result({user:user()})},
  onAuthStateChange(fn){listeners.push(fn);return {data:{subscription:{unsubscribe(){
   const index=listeners.indexOf(fn);if(index>=0)listeners.splice(index,1)}}}}},
  async signInWithPassword({email,password}){
   window.__foundation.calls.push({name:'signIn',email})
   if(password!=='FixturePass123!')return {data:{},error:{message:'Invalid login credentials'}}
   save({id:'fixture-user',email});changed('SIGNED_IN');return result({session:session(),user:user()})
  },
  async signOut(){window.__foundation.calls.push({name:'signOut'});save(null);changed('SIGNED_OUT');return {error:null}},
  async signUp({email,options}){
   window.__foundation.calls.push({name:'signUp',email,fullName:options.data.full_name})
   save({id:'fixture-user',email});return result({session:session(),user:user()})
  },
 },
 from(table){
  const allowed=new Set(['v_user_club_memberships','facilities','v_master_facility_calendar',
   'v_waitlist_queue','club_waitlist_entries','facility_waitlist','event_segments','events','members'])
  if(table!=='v_user_club_memberships')return backend.query(table)
  if(!allowed.has(table))throw Error('Unhandled foundation table: '+table)
  let single=false
  const response=()=>config().membershipError&&table==='v_user_club_memberships'
   ?{data:null,error:{message:'Fixture memberships unavailable'}}
   :result(table==='v_user_club_memberships'&&user()&&!config().noMembership?(config().aliasClubs?[{...row(),club_id:1,club_name:'Eurhythmix'},{...row(),club_id:1,club_name:'SMU Eurhythmix'}]:config().multipleClubs?[row(),{...row(),club_id:72,club_name:'Fixture Other Club',role_name:'Member',can_claim_booking:false,can_release_booking:false,can_manage_waitlist:false}]:[row()]):single?null:[])
  const query={then(resolve,reject){return Promise.resolve(response()).then(resolve,reject)}}
  for(const method of ['select','eq','in','gte','lte','order','limit','range','is','neq'])query[method]=()=>query
  query.maybeSingle=query.single=()=>{single=true;return query}
  return query
 },
 async rpc(name,args){
  window.__foundation.calls.push({name,args})
  const response=await backend.rpc(name,args)
  if(response!==undefined)return response
  if(name==='rpc_check_signup')return result(config().signupStatus==='not_listed'?{status:'not_listed'}:
   {status:'eligible',full_name:'Fixture Exco',ccas:['Fixture Arts Club'],roles:[{code:'LOGISTICS',name:'Logistics Director'}]})
  if(['rpc_update_my_profile','rpc_set_my_roles'].includes(name))return result({})
  if(name==='cfg_text')return result('2026-12-31')
  if(name==='rpc_my_telegram_link')return result(!!config().telegramLinksAfterCode&&window.__foundation.calls.some(c=>c.name==='rpc_create_telegram_link_code'))
  if(name==='rpc_simulator_workflow_capabilities')return result({contract_version:4,application_enabled:false,invitations_enabled:false})
  if(name==='rpc_simulator_plan_history')return result({plans:[],invitations:[],audit:[]})
  if(name==='rpc_simulator_my_invitations')return result({invitations:[]})
  if(['rpc_my_notifications','rpc_osl_pending_transfers','rpc_recent_transfer_decisions','rpc_club_transfers'].includes(name))return result([])
  window.__foundation.recordUnexpected('RPC: '+name)
  throw Error('Unhandled foundation RPC: '+name)
 },
 functions:{async invoke(name){if(name!=='onemap-walk'){window.__foundation.recordUnexpected('Function: '+name);throw Error('Unexpected fixture function: '+name)};return result({minutes:8,metres:650})}},
 channel(){const channel={on:()=>channel,subscribe:()=>channel};return channel},
 removeChannel(){},
}


