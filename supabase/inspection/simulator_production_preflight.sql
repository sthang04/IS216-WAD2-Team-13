-- READ-ONLY PRODUCTION PREFLIGHT. Execute in Supabase SQL Editor only after
-- confirming the dashboard project reference is bdqzysnapwxdzppkuftn.
-- current_database() is often "postgres": it does NOT prove project identity.
-- No event/member rows, credentials, tokens or booking contents are selected.
-- Review function bodies for any pre-existing embedded secrets before sharing.
BEGIN READ ONLY;
WITH target AS (
 SELECT c.oid,n.nspname,c.relname,c.relkind,c.relowner,c.relrowsecurity,c.relforcerowsecurity,c.reloptions
 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind IN ('r','p','v','m') AND ((n.nspname='public' AND c.relname=ANY(ARRAY[
  'events','event_segments','segment_assignments','segment_dependencies','members',
  'clubs','club_memberships','exco_roles','facilities','facility_bookings',
  'segment_facility_bookings','waitlist_entries','notifications','telegram_links',
  'v_master_facility_calendar','v_waitlist_queue']))
 OR n.nspname='simulator_private')
), routines AS (
 SELECT p.*,n.nspname FROM pg_catalog.pg_proc p
 JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE p.prokind='f' AND (n.nspname='simulator_private' OR
  (n.nspname='public' AND (p.proname LIKE 'rpc_simulator_%' OR
   p.proname=ANY(ARRAY['rpc_claim_booking','rpc_join_waitlist','rpc_release_booking',
    'rpc_undo_release_booking','rpc_leave_waitlist','rpc_approve_transfer',
    'rpc_reject_transfer','current_member_id','has_club_permission',
    'require_club_permission','require_logistics_membership','is_osl_admin']))))
)
SELECT jsonb_build_object(
 'database',jsonb_build_object('database_name',current_database(),'inspection_role',current_user,
  'server_version',current_setting('server_version'),'project_identity','Confirm in dashboard URL; SQL database name is insufficient'),
 'objects',coalesce((SELECT jsonb_agg(jsonb_build_object(
  'schema',t.nspname,'name',t.relname,'kind',t.relkind,'owner',pg_get_userbyid(t.relowner),
  'rls',t.relrowsecurity,'forced_rls',t.relforcerowsecurity,'options',t.reloptions,
  'authenticated_schema_usage',has_schema_privilege('authenticated',t.nspname,'USAGE'),
  'authenticated_select',has_table_privilege('authenticated',t.oid,'SELECT'),
  'authenticated_insert',has_table_privilege('authenticated',t.oid,'INSERT'),
  'authenticated_update',has_table_privilege('authenticated',t.oid,'UPDATE'),
  'authenticated_delete',has_table_privilege('authenticated',t.oid,'DELETE'),
  'anon_select',has_table_privilege('anon',t.oid,'SELECT'))
  ORDER BY t.nspname,t.relname) FROM target t),'[]'::jsonb),
 'columns',coalesce((SELECT jsonb_agg(jsonb_build_object(
  'schema',t.nspname,'table',t.relname,'column',a.attname,
  'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull)
  ORDER BY t.nspname,t.relname,a.attnum) FROM target t
  JOIN pg_catalog.pg_attribute a ON a.attrelid=t.oid
  WHERE a.attnum>0 AND NOT a.attisdropped),'[]'::jsonb),
 'constraints',coalesce((SELECT jsonb_agg(jsonb_build_object(
  'schema',t.nspname,'table',t.relname,'name',k.conname,
  'type',k.contype,'definition',pg_get_constraintdef(k.oid,true),
  'deferrable',k.condeferrable,'deferred',k.condeferred)
  ORDER BY t.nspname,t.relname,k.conname) FROM target t
  JOIN pg_catalog.pg_constraint k ON k.conrelid=t.oid),'[]'::jsonb),
 'indexes',coalesce((SELECT jsonb_agg(jsonb_build_object(
  'schema',i.schemaname,'table',i.tablename,'name',i.indexname,'definition',i.indexdef)
  ORDER BY i.schemaname,i.tablename,i.indexname)
  FROM pg_catalog.pg_indexes i JOIN target t ON t.nspname=i.schemaname AND t.relname=i.tablename),'[]'::jsonb),
 'policies',coalesce((SELECT jsonb_agg(jsonb_build_object(
  'schema',p.schemaname,'table',p.tablename,'name',p.policyname,'roles',p.roles,
  'command',p.cmd,'permissive',p.permissive,'using',p.qual,'with_check',p.with_check)
  ORDER BY p.schemaname,p.tablename,p.policyname)
  FROM pg_catalog.pg_policies p JOIN target t ON t.nspname=p.schemaname AND t.relname=p.tablename),'[]'::jsonb),
 'triggers',coalesce((SELECT jsonb_agg(jsonb_build_object(
  'schema',t.nspname,'table',t.relname,'name',g.tgname,'enabled',g.tgenabled,
  'definition',pg_get_triggerdef(g.oid,true))
  ORDER BY t.nspname,t.relname,g.tgname)
  FROM target t JOIN pg_catalog.pg_trigger g ON g.tgrelid=t.oid WHERE NOT g.tgisinternal),'[]'::jsonb),
 'functions',coalesce((SELECT jsonb_agg(jsonb_build_object(
  'schema',r.nspname,'name',r.proname,'arguments',pg_get_function_identity_arguments(r.oid),
  'result',pg_get_function_result(r.oid),'owner',pg_get_userbyid(r.proowner),
  'security_definer',r.prosecdef,'settings',r.proconfig,
  'authenticated_execute',has_function_privilege('authenticated',r.oid,'EXECUTE'),
  'anon_execute',has_function_privilege('anon',r.oid,'EXECUTE'),
  'public_execute',EXISTS(SELECT 1 FROM aclexplode(coalesce(r.proacl,acldefault('f',r.proowner))) a
    WHERE a.grantee=0 AND a.privilege_type='EXECUTE'),
  'definition',pg_get_functiondef(r.oid))
  ORDER BY r.nspname,r.proname,pg_get_function_identity_arguments(r.oid)) FROM routines r),'[]'::jsonb),
 'function_dependencies',coalesce((SELECT jsonb_agg(jsonb_build_object(
  'schema',r.nspname,'function',r.proname,
  'referenced_object',pg_describe_object(d.refclassid,d.refobjid,d.refobjsubid)))
  FROM routines r JOIN pg_catalog.pg_depend d ON d.classid='pg_proc'::regclass AND d.objid=r.oid),'[]'::jsonb),
 -- Dynamic SELECT avoids a parse failure when simulator tables are absent.
 -- XML contains gate metadata only. READ ONLY also applies to these SELECTs.
 'release_gates_xml',CASE WHEN to_regclass('simulator_private.release_gate') IS NULL THEN NULL
  ELSE query_to_xml('SELECT * FROM simulator_private.release_gate',true,false,'')::text END,
 'migration_history_xml',CASE WHEN EXISTS(
   SELECT 1 FROM information_schema.columns WHERE table_schema='supabase_migrations'
    AND table_name='schema_migrations' AND column_name='version')
  THEN query_to_xml('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version',true,false,'')::text
  ELSE NULL END,
 'migration_history_note','Missing history rows do not prove SQL Editor-installed functions are absent; compare object definitions.'
) AS simulator_production_preflight;
COMMIT;
