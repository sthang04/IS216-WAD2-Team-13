// SUPPORT FILE PURPOSE: meetingBackend.js supplies shared setup or controlled data for the browser workflows.
// Keep this support code: the Playwright tests depend on consistent setup and isolated state.
// Stateful synthetic meeting API for browser workflows. Real Vue/services call these
// contracts, but notifications and calendar writes stay in this browser's sessionStorage.
export function createMeetingBackend(config) {
 const key='pulse-fixture-meetings'
 const roster=[{member_id:7001,full_name:'Fixture Exco',role_name:'Logistics Director',is_me:true},
  {member_id:7002,full_name:'Fixture Dancer',role_name:'Dancer',subcommittee:'Dancers',is_me:false}]
 const initial={meeting:config().meetings&&!config().emptyMeeting?{
  id:601,club_id:71,title:'Fixture team meeting',agenda:'Review rehearsal',week_start:'2026-11-02',
  vote_deadline:config().meetingClosed?'2026-11-03T01:00:00Z':'2026-11-05T15:00:00Z',server_now:'2026-11-03T02:00:00Z',
  status:config().meetingClosed?'EXPIRED':'COLLECTING',is_participant:true,is_organiser:true,can_confirm:!config().waitingResponses,organiser_name:'Fixture Exco'}:null,
  participants:roster.map(m=>({...m,responded_at:config().everyoneResponded?'2026-11-03T02:00:00Z':null,telegram_linked:true})),availability:[]}
 const state=JSON.parse(sessionStorage.getItem(key)||'null')||initial
 const ok=data=>({data:structuredClone(data),error:null})
 const persist=()=>sessionStorage.setItem(key,JSON.stringify(state))
 return async function rpc(name,args){
  if(name==='rpc_club_roster')return ok(config().meetings?roster:[])
  if(['rpc_my_baseline','rpc_club_baselines'].includes(name))return ok([])
  if(name==='rpc_meeting_snapshot'){
   const m=state.meeting;const visible=m&&(args.p_meeting_id===m.id||args.p_week_start===m.week_start)
   return ok({meeting:visible?m:null,participants:visible?state.participants:[],
    availability:visible?state.availability:[],week_meetings:visible?[m]:[]})
  }
  if(name==='rpc_create_meeting'){
   state.meeting={...initial.meeting,id:602,club_id:71,title:args.p_title,agenda:args.p_agenda,
    week_start:args.p_week_start,vote_deadline:args.p_vote_deadline,server_now:'2026-11-03T02:00:00Z',
    status:'COLLECTING',is_participant:true,is_organiser:true,can_confirm:true,organiser_name:'Fixture Exco'}
   state.participants=roster.filter(m=>args.p_member_ids.includes(m.member_id)).map(m=>({...m,responded_at:null}))
   state.availability=[];persist();return ok(602)
  }
  if(name==='rpc_set_meeting_availability'){
   state.availability=state.availability.filter(a=>!(a.member_id===7001&&a.slot_date===args.p_slot_date&&a.hour===args.p_hour))
   if(args.p_available)state.availability.push({member_id:7001,slot_date:args.p_slot_date,hour:args.p_hour})
   state.participants.find(p=>p.member_id===7001).responded_at='2026-11-03T02:00:00Z'
   persist();return ok({})
  }
  if(name==='rpc_submit_no_availability'){
   state.availability=state.availability.filter(a=>a.member_id!==7001)
   state.participants.find(p=>p.member_id===7001).responded_at='2026-11-03T02:00:00Z'
   persist();return ok({})
  }
  if(name==='rpc_clear_meeting_response'){
   state.availability=state.availability.filter(a=>a.member_id!==7001)
   state.participants.find(p=>p.member_id===7001).responded_at=null
   persist();return ok({})
  }
  if(name==='rpc_confirm_meeting'){
   Object.assign(state.meeting,{status:'CONFIRMED',confirmed_date:args.p_date,
    confirmed_start_hour:args.p_start_hour,confirmed_end_hour:args.p_end_hour,venue:args.p_venue})
   persist();return ok({})
  }
  if(name==='rpc_nudge_meeting'){
   const people=state.participants.filter(p=>p.member_id!==7001&&(!args.p_member_id||p.member_id===args.p_member_id))
   people.forEach(p=>p.last_nudged_at='2026-11-03T02:00:00Z');persist();return ok(people.length)
  }
  return undefined
 }
}
