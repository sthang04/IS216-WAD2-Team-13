import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read=name=>readFileSync(new URL('../../supabase/migrations/'+name,import.meta.url),'utf8')
const previous=read('202610310002_simulator_recovery_workflow.sql')
const correction=read('202610310005_simulator_safe_undo.sql')
function transition(sql){const at=sql.indexOf('FUNCTION simulator_private.transition_plan(');return sql.slice(at,sql.indexOf('END $$;',at)+7)}
test('corrective migration preserves writer except the explicit Undo-only disruption guard',()=>{
 const injected=`
  IF p_undo THEN
   -- This runs inside the existing exception/subtransaction boundary. Raising
   -- here rolls back ALL tentative restoration writes before auditing failure.
   PERFORM simulator_private.assert_undo_disruptions_clear(p.event_id,p.disruptions);
  END IF;`
 assert.equal(transition(correction).replace(injected,''),transition(previous))
 assert.match(correction,/SET search_path=pg_catalog/)
 assert.match(correction,/FROM PUBLIC,anon,authenticated/)
 assert.doesNotMatch(correction,/UPDATE simulator_private.release_gate|CREATE TABLE|ALTER TABLE|CREATE POLICY/)
})
test('comparison remains ahead of Apply workflow and no Revise Recovery interface is introduced',()=>{
 const view=readFileSync(new URL('../views/EventRiskView.vue',import.meta.url),'utf8')
 assert.ok(view.indexOf('Plan Comparison')<view.indexOf('<SimulatorRecoveryWorkflow'))
 assert.doesNotMatch(view,/Revise Recovery/)
})
