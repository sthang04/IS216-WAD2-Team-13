import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const sql=readFileSync(new URL('../../supabase/migrations/202610310003_simulator_original_booking_links.sql',import.meta.url),'utf8')
test('audience and approval bindings are owner-only, disabled by default and never guessed shared columns',()=>{
 assert.match(sql,/activity_audience_column name,/)
 assert.match(sql,/event_audience_column name,/)
 assert.match(sql,/booked_approval_column name,/)
 assert.match(sql,/INSERT INTO simulator_private.original_booking_review_policy DEFAULT VALUES/)
 assert.match(sql,/ALTER TABLE simulator_private.original_booking_review_policy ENABLE ROW LEVEL SECURITY/)
 assert.match(sql,/REVOKE ALL ON TABLE simulator_private.original_booking_review_policy FROM PUBLIC,anon,authenticated/)
 assert.doesNotMatch(sql,/ALTER TABLE public\./)
 assert.match(sql,/capacity_verified:=required_value IS NOT NULL AND capacity_value>=required_value/)
})
test('original RPC signature and previous response keys stay compatible and the release gate stays false',()=>{
 assert.match(sql,/p_expected_event_fingerprint text,p_expected_booking_fingerprint text,p_acknowledge_suitability boolean/)
 for(const key of ['booking_id','facility_id','facility_name','owner_club_id','status','capacity','minimum_capacity','eligible','reasons','booking_fingerprint'])assert.ok(sql.includes("'"+key+"'"),key)
 assert.match(sql,/original_booking_linking_enabled boolean NOT NULL DEFAULT false/)
 assert.doesNotMatch(sql,/SET original_booking_linking_enabled\s*=\s*true/i)
})
test('archival audit has no new dependency on live tables and validates immutable capture-time provenance',()=>{
 const audit=sql.split('CREATE TABLE simulator_private.original_booking_link_audit')[1].split(');')[0]
 assert.doesNotMatch(audit,/REFERENCES|ON DELETE CASCADE/)
 assert.match(audit,/evidence_snapshot jsonb NOT NULL/)
 assert.match(audit,/snapshot_fingerprint text NOT NULL/)
 assert.match(sql,/Audit source objects are not valid at capture time/)
 assert.match(sql,/Audit snapshot does not match its source keys or fingerprint/)
 assert.match(sql,/BEFORE INSERT OR UPDATE OR DELETE/)
 assert.match(sql,/BEFORE TRUNCATE/)
 assert.match(sql,/Original booking audit history is immutable/)
 assert.match(sql,/Original booking audit history cannot be erased/)
})
test('locked decisions use policy, event, activity and staff evidence and repeat authorization',()=>{
 const link=sql.split('CREATE FUNCTION public.rpc_simulator_link_original_booking')[1].split('END $$;')[0]
 assert.ok(link.indexOf('LOCK TABLE simulator_private.original_booking_review_policy')<link.indexOf('evidence:=simulator_private.original_booking_evidence'))
 assert.match(link,/event_club\(p_event_id,true\)/)
 assert.match(link,/original_booking_linking_enabled FOR SHARE/)
 assert.match(link,/p_acknowledge_suitability,false/)
 assert.match(link,/booking_fingerprint' IS DISTINCT FROM p_expected_booking_fingerprint/)
 assert.match(sql,/'review_policy',to_jsonb\(policy\)/)
 assert.match(sql,/'event',event_record,'activity',to_jsonb\(seg\),'staff_minimum',headcount/)
})
