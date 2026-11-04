// SUPPORT FILE PURPOSE: memberClient.js supplies shared setup or controlled data for the browser workflows.
// Keep this support code: the Playwright tests depend on consistent setup and isolated state.
// Browser-test-only mock. Production entry points never import this module.
const stored=()=>JSON.parse(sessionStorage.getItem('member-invitation-fixture')||'null')
const term={assignment_id:11,segment_id:1,activity:'Opening rehearsal',role_name:'Stage crew',replaced_member_id:4,starts_at:'2099-11-02T02:00:00.000000Z',ends_at:'2099-11-02T03:00:00.000000Z'}
const invitation=(id,event,status='Pending')=>({id,event_name:event,club_name:'Fixture Dance Club',plan_id:'plan',recipient_member_id:7,replaced_member_id:4,status,expires_at:'2099-11-01T00:00:00Z',assignment_snapshot:[term],facilities:[{segment_id:1,venue_name:'Gym Studio'}]})
let state=stored()||{member:7,rows:[invitation('accept-me','Dance Showcase'),invitation('decline-me','Workshop'),invitation('expired','Expired rehearsal'),invitation('cancelled','Cancelled rehearsal','Cancelled')]}
state.rows.find(r=>r.id==='expired') && (state.rows.find(r=>r.id==='expired').expires_at='2000-01-01T00:00:00Z')
const save=()=>sessionStorage.setItem('member-invitation-fixture',JSON.stringify(state))
const callbacks=[]
const session=()=>({user:{id:'fixture-user-'+state.member,email:'member'+state.member+'@smu.edu.sg'}})
const control={calls:[],gate:true,readError:false,writeError:false,holdReads:false,holdWrites:false,pendingReads:[],pendingWrites:[],releaseReads(){this.holdReads=false;this.pendingReads.splice(0).forEach(resolve=>resolve())},releaseWrites(){this.holdWrites=false;this.pendingWrites.splice(0).forEach(resolve=>resolve())},setMember(id){state.member=id;save();callbacks.forEach(fn=>fn('SIGNED_IN',session()))},empty(){state.rows=[];save()},state:()=>state}
window.__memberInvitations=control
const membership=()=>({user_id:session().user.id,member_id:state.member,full_name:'Ordinary Member '+state.member,club_id:1,club_name:'Fixture Dance Club',role_name:'Member',membership_is_active:true,is_admin_role:false,can_manage_members:false,can_claim_booking:false,can_release_booking:false})
export const isSupabaseConfigured=()=>true
export const supabase={
 auth:{
  getSession:async()=>({data:{session:session()}}),
  getUser:async()=>({data:{user:session().user}}),
  onAuthStateChange(fn){
   callbacks.push(fn)
   return {data:{subscription:{unsubscribe(){const i=callbacks.indexOf(fn);if(i>=0)callbacks.splice(i,1)}}}}
  }
 },
 from(table){
  const target={then(resolve,reject){return Promise.resolve({data:table==='v_user_club_memberships'?[membership()]:[],error:null}).then(resolve,reject)},maybeSingle:async()=>({data:null}),single:async()=>({data:null})}
  const q=new Proxy(target,{get(target,key){return key in target?target[key]:()=>q}})
  return q
 },
 channel(){const c={on:()=>c,subscribe:()=>c};return c},removeChannel(){},
 async rpc(name,args){control.calls.push({name,args})
  if(name==='rpc_simulator_workflow_capabilities')return {data:{contract_version:4,invitations_enabled:control.gate,application_enabled:true}}
  if(name==='rpc_simulator_my_invitations'){
   if(control.holdReads)await new Promise(resolve=>control.pendingReads.push(resolve))
   return control.readError?{error:{message:'Fixture inbox unavailable'}}:{data:{invitations:state.rows.filter(r=>r.recipient_member_id===state.member)}}
  }
  if(name==='rpc_simulator_respond_invitation'){
   // Test-controlled pending response: loading assertions never race a timer.
   if(control.holdWrites)await new Promise(resolve=>control.pendingWrites.push(resolve))
   const row=state.rows.find(r=>r.id===args.p_invitation_id)
   if(!row||row.recipient_member_id!==state.member)return {error:{code:'42501',message:'Only the invited member may respond'}}
   if(!control.gate||control.writeError)return {error:{message:'Fixture response unavailable'}}
   if(row.status!=='Pending'||Date.parse(row.expires_at)<=Date.now())return {error:{message:'Invitation expired or already answered'}}
   row.status=args.p_response;save();return {data:structuredClone(row)}
  }
  if(name==='rpc_simulator_plan_history')return {data:{plans:[{id:'plan',application_status:'Draft',lifecycle:'In Progress',changes:[{segmentId:1,assignmentId:11,replacedMemberId:4,replacementMemberId:7}],actions:[],before_state:{assignments:[{id:11,member_id:4,role_name:term.role_name}],segments:[{id:1,title:term.activity,starts_at:term.starts_at,ends_at:term.ends_at}]}}],invitations:state.rows.filter(r=>r.id==='accept-me'),audit:[]}}
  if(name==='cfg_text')return {data:'2026-12-31'}
  if(name==='rpc_my_telegram_link')return {data:false}
  return {data:[]}
 }
}
