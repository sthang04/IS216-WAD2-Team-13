// SQL source checks and message checks for "accepting assigns you straight away".
// No SQL is executed here; this guards the shape of the migration.
import {test} from '@playwright/test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {invitationMessage} from '../../../supabase/functions/_shared/simulatorInvitationWorker.js'

const sql=readFileSync(new URL('../../../supabase/migrations/20261106120000_replacement_accept_assigns.sql',import.meta.url),'utf8')
const body=name=>{
 const text=sql.split('CREATE OR REPLACE FUNCTION '+name+'(')[1]
 assert.ok(text,'Function missing: '+name)
 return text.split('END $$;')[0]
}

test('accepting runs the existing Apply once every replacement has accepted',()=>{
 const respond=body('public.rpc_simulator_respond_invitation')
 assert.match(respond,/i.recipient_member_id<>actor/)
 assert.match(respond,/IF p_response='Accepted' THEN/)
 assert.match(respond,/a.status='Accepted' AND a.expires_at>clock_timestamp\(\)/)
 assert.match(respond,/IF waiting=0 THEN/)
 assert.match(respond,/simulator_private.transition_plan\(p.id,p.version,true,false\)/)
 // A failed Apply must not undo the acceptance
 assert.ok(respond.indexOf('EXCEPTION WHEN OTHERS')>respond.indexOf('transition_plan('))
 assert.ok(respond.indexOf("'Succeeded',p_response")<respond.indexOf('transition_plan('))
})

test('the auto-apply permission is set only around Apply and only for that event',()=>{
 const respond=body('public.rpc_simulator_respond_invitation')
 const set=respond.indexOf("set_config('simulator.auto_apply_event',p.event_id::text,true)")
 const clear=respond.indexOf("set_config('simulator.auto_apply_event','',true)")
 const apply=respond.indexOf('transition_plan(')
 assert.ok(set>0&&set<apply&&apply<clear)
 const club=body('simulator_private.event_club')
 assert.match(club,/current_setting\('simulator.auto_apply_event',true\),''\)=p_event::text/)
 // Still has to be an active, non-admin member of the event club
 for(const text of ['cm.member_id=actor','cm.club_id=club','cm.is_active','NOT r.is_admin_role'])assert.ok(club.includes(text),text)
 assert.match(club,/legacy_event_club\(p_event,p_manage AND NOT auto\)/)
})

test('Day Ops locks come before the plan lock, as in Apply',()=>{
 const respond=body('public.rpc_simulator_respond_invitation')
 assert.ok(respond.indexOf('LOCK TABLE public.ops_events')<respond.indexOf('FOR UPDATE OF p1'))
 assert.ok(respond.indexOf("set_config('lock_timeout'")<respond.indexOf('LOCK TABLE'))
})

test('grants stay private and the migration is one transaction',()=>{
 assert.match(sql,/REVOKE ALL ON FUNCTION simulator_private.event_club\(bigint,boolean\) FROM PUBLIC,anon,authenticated/)
 assert.match(sql,/GRANT EXECUTE ON FUNCTION public.rpc_simulator_respond_invitation\(uuid,text\) TO authenticated/)
 assert.equal(sql.match(/^BEGIN;/gm).length,1)
 assert.match(sql.trim(),/COMMIT;$/)
})

test('Telegram message says accepting assigns you, with no organiser step',()=>{
 const {body:text}=invitationMessage({event_name:'Show',activity_count:1},'https://example.test/personal-schedule#simulator-invitation-inbox')
 assert.match(text,/Accepting assigns you straight away/)
 assert.doesNotMatch(text,/organiser confirms/)
})
