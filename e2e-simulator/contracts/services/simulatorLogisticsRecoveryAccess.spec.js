import {test,expect} from '@playwright/test'
import {readFileSync} from 'node:fs'
const original=readFileSync(new URL('../../../supabase/migrations/202610310002_simulator_recovery_workflow.sql',import.meta.url),'utf8').replace(/\r\n/g,'\n')
const migration=readFileSync(new URL('../../../supabase/migrations/20261104000100_simulator_logistics_recovery_access.sql',import.meta.url),'utf8')
// Source contracts verify the proposed migration, not a deployed database or RLS.
test('migration changes only the recovery role predicate and retains actor and club guards',()=>{
 const extract=s=>s.slice(s.indexOf('FUNCTION simulator_private.event_club('),s.indexOf('END $$;',s.indexOf('FUNCTION simulator_private.event_club('))+7)
 const before=extract(original),after=extract(migration)
 expect(after.replace("AND r.is_admin_role=false\n    AND (NOT p_manage OR r.can_manage_members=true OR r.role_code='LOGISTICS_DIRECTOR')",'AND r.is_admin_role=false AND (NOT p_manage OR r.can_manage_members=true)')).toBe(before)
 for(const guard of ['simulator_private.actor()','cm.member_id=actor','cm.club_id=club','cm.is_active=true','r.is_admin_role=false','matches<>1','c.active=true'])expect(after).toContain(guard)
})
test('migration keeps helper private and does not grant general member or booking permissions',()=>{
 expect(migration).toMatch(/^BEGIN;/);expect(migration.trim()).toMatch(/COMMIT;$/)
 expect(migration).toContain('REVOKE ALL ON FUNCTION simulator_private.event_club(bigint,boolean) FROM PUBLIC, anon, authenticated;')
 const executable=migration.replace(/--[^\n]*/g,'')
 expect(executable).not.toMatch(/\b(?:UPDATE|INSERT|DELETE|ALTER TABLE|GRANT)\b/i)
 expect(executable.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(1)
})
