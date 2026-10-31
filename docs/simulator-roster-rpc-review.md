# Simulator roster RPC: local preparation only

Migration: supabase/migrations/202610310001_simulator_event_roster.sql
No SQL was executed and no live integration was verified during preparation.

## Verified database contract

The user supplied deployed metadata and policies: events uses club_name, matching
clubs.name OR clubs.short_name exactly. Both member and membership is_active and
clubs.active must be true. Caller membership joins exco_roles and excludes
is_admin_role=true, as the existing event SELECT policy does. Active membership
is used as-is; no current academic year rule is inferred. The RPC returns active
club members even without auth accounts or assignments. Account linking and
invitation acceptance are outside Phase 1.

## Security review before deployment

This narrowly scoped SECURITY DEFINER operation intentionally reads memberships
hidden by own-membership RLS, after checking the real auth.uid() and the event's
club. It never reads the owner-privileged membership view. Fixed pg_catalog
search_path, qualified relations, no dynamic SQL, minimal fields and explicit
EXECUTE grants limit exposure. Deploy only under a trusted owner able to read
these tables (normally the SQL Editor postgres owner); ensure untrusted roles
cannot replace the function or its referenced objects. Review any extra policies
or permission requirements added since the supplied metadata. Roster read access
mirrors event access; this does not grant event-edit permissions. Revoking PUBLIC
and anon grants does not remove privileges inherited from another role: review
role memberships if your project customizes them.

CREATE FUNCTION deliberately refuses to overwrite an existing signature. The
migration creates no tables or policies and contains no production row writes.
The function reads live records in the statement snapshot; membership may change
later. Applying assignments still requires a separate future server recheck.

## Later deployment: separate explicit approval required

1. Review the SQL against the current schema in a development/staging project.
2. Review grants/ownership and duplicate club-name resolution. Test unauthorized
   callers, ambiguous/missing events, inactive memberships and an empty roster.
3. After approval, have the project owner run ONLY this migration transaction in
   SQL Editor or through the team's selected migration workflow. Do not run a
   blanket db push: it could apply unrelated pending migrations.
4. If an error aborts the SQL Editor transaction, ROLLBACK before retrying. Do not
   replace an already-existing function without inspecting it and getting approval.
5. Check the API schema cache if the new RPC is not discoverable. No need to change
   shared RLS or the existing membership view.

## Normal signed-in Pulse verification after deployment

1. Start the usual Vite server and sign in through Pulse as an active non-admin
   member of the event club. Open /events and select that club's event.
2. In browser Network, find POST /rest/v1/rpc/rpc_simulator_event_roster. The payload
   contains only p_event_id; never share request authorization headers or tokens.
3. Confirm the response envelope contains the selected event ID and one club ID.
   Compare member IDs privately against a known active unassigned standby member.
   Do not send contact details or raw roster records to the assistant.
4. Simulate overlapping member unavailability. Standby members can now be shown
   under Needs Manual Review. The coverage warning remains because only accessible
   assignments are loaded; academic/personal/cross-club commitments are incomplete.
5. Try an existing authorized test account from another club. Its event request
   should fail. Do not create production test users or modify memberships for testing.
6. Report only pass/fail, anonymous counts and sanitized error messages. An SQL
   Editor query as postgres is NOT a normal-user authorization test.

Local tests:
node --test src/services/replacementRecommendations.test.js src/services/simulatorRosterService.test.js

Mock/structural tests do not prove PostgreSQL syntax, RLS behavior or live delivery.
Phase 2 is not implemented. Until deployment each event shows an explicit roster
coverage error and no replacement candidates, rather than substituting fixtures.

## Staging checklist (instructions only; no approval to execute yet)

### 1. Confirm project identity before deployment

- In Supabase Dashboard check the organization, project name, and project reference
  in Settings/General and in the dashboard URL. Agree with the project owner that
  this is the staging project, not production.
- Compare that project reference privately with the hostname in your local
  VITE_SUPABASE_URL. A custom domain must be checked with the project owner.
  Do not paste environment files, keys, authorization headers or session tokens.
- Use a separate staging environment configuration. Installing the RPC in staging
  does not make a frontend pointed at production safe to test.
- After separate approval, apply only the reviewed roster migration. This guide
  does not authorize deployment, user creation, test-data writes or policy changes.

### 2. Inspect installed ownership and settings

Run these metadata-only queries in the APPROVED staging project's SQL Editor
AFTER installation. An empty result means the exact signature is not installed.

```sql
SELECT
  p.oid::regprocedure AS signature,
  pg_get_userbyid(p.proowner) AS owner_role,
  r.rolsuper AS owner_is_superuser,
  r.rolbypassrls AS owner_bypasses_rls,
  p.prosecdef AS security_definer,
  p.provolatile AS volatility,
  p.proconfig AS function_settings,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute
FROM pg_proc AS p
JOIN pg_roles AS r ON r.oid = p.proowner
WHERE p.oid = to_regprocedure('public.rpc_simulator_event_roster(bigint)');
```

Expected: trusted agreed owner, security_definer=true, volatility=s (STABLE),
search_path=pg_catalog, authenticated_execute=true, anon_execute=false. A
non-superuser owner is possible, but its table rights and RLS behavior require
separate verification. Do not automatically change ownership to fix an error.

### 3. Inspect direct EXECUTE grants and the installed definition

```sql
SELECT
  CASE WHEN a.grantee = 0 THEN 'PUBLIC'
       ELSE pg_get_userbyid(a.grantee) END AS grantee,
  a.privilege_type,
  a.is_grantable
FROM pg_proc AS p
CROSS JOIN LATERAL aclexplode(
  coalesce(p.proacl, acldefault('f', p.proowner))
) AS a
WHERE p.oid = to_regprocedure('public.rpc_simulator_event_roster(bigint)')
ORDER BY grantee, privilege_type;

SELECT pg_get_functiondef(p.oid) AS installed_definition
FROM pg_proc AS p
WHERE p.oid = to_regprocedure('public.rpc_simulator_event_roster(bigint)');
```

PUBLIC and anon must not have EXECUTE; authenticated should. The owner retains
its own rights. Investigate unexpected grants or role inheritance with the project
owner. Compare the installed definition with the reviewed migration, particularly
its auth.uid(), active membership checks and fixed search_path. Do not call the
function as postgres and treat success as evidence of normal-user authorization.

### 4. Verify normal authenticated access in Pulse

- Start the frontend configured for staging and sign in through Pulse as an
  existing active non-admin member of the selected event's club.
- Open /events. Inspect Network for the roster RPC requests. Do not export HAR
  files containing credentials. Confirm the selected event's roster coverage is
  loaded while timetable coverage remains explicitly incomplete.
- Privately identify a known active, unassigned standby member. Check that they
  appear once after simulating an overlapping member disruption. Their missing
  role history requires review; membership is not proof of specialty.
- Where multiple academic-year memberships are active, expect one candidate card.
  Distinct years remain in normalized membership evidence; no current year is
  inferred. Wrong-club/inactive candidates must not appear.

For explicit request tests in the LOCAL Vite development app, this browser DevTools
snippet uses the already-signed-in shared client. It prints metadata only. Replace
123 with an approved staging event ID; never paste a token into a command.

```js
const { supabase } = await import('/src/supabase.js');
const result = await supabase.rpc('rpc_simulator_event_roster', { p_event_id: 123 });
console.log({
  ok: !result.error,
  code: result.error?.code,
  count: result.data?.members?.length,
  fields: result.data?.members?.[0] ? Object.keys(result.data.members[0]) : []
});
```

The /src import is a Vite development-only convenience, not a deployed-app API.
Only the envelope event_id, club_id, members and row member_id, full_name, club_id,
academic_year should be returned. Review privately for unexpected fields; report
only field names, anonymous counts and sanitized error messages.

### 5. Negative authorization tests

- Sign in as an existing staging account belonging only to another club. Call the
  RPC directly using the same snippet and the FIRST club's event ID (the UI may
  correctly hide that event). Expect an error and no roster payload.
- In a separate private browser session, open the staging-configured local app
  without signing in. Import the shared client and confirm there is no session:
  console.log(Boolean((await supabase.auth.getSession()).data.session));
  It must print false. Call the RPC directly; expect permission denied and no data.
  Authenticated EXECUTE should not be granted to anonymous users.
- Using existing staging fixtures, check invalid IDs, ambiguous club names, inactive
  clubs and inactive caller memberships. Arrange new fixtures only with separate
  staging-data-write approval. Do not change production data to create test cases.
- Invalid/unauthorized events return generic denial. An authorized empty roster is
  not normally reachable with this SQL: the qualifying caller is in that roster.
  Empty-response frontend handling is still tested using mocks.

### 6. Pagination and per-event failure checks

- Ordinary table reads request exact counts, stable primary/composite-key ordering,
  and ranges of up to 200 rows. Smaller server caps are supported automatically.
- The loader advances by returned row count, and fails visibly for missing counts,
  early empty pages, changing counts, duplicates or request failures. It never
  silently uses a partial dataset or fake records.
- Exact counts describe RLS-visible rows only. Separate HTTP requests are NOT a
  transaction snapshot: same-count replacements/updates may escape detection.
  Refresh after changes; future assignment application must revalidate on server.
- A roster RPC failure is isolated per event: that event retains an explicit error
  and no eligible candidates. Other events with successful rosters still work.
  Any table-read completeness failure still stops loading because impacts depend
  on those records. Loading still fetches accessible events sequentially for RPCs;
  this favors correctness over speed for large event lists.

### 7. Record outcomes

Record project reference privately, installed owner/settings, positive and negative
test pass/fail, standby count, duplicate-card outcome and privacy field names. Mark
live integration VERIFIED only after actual staging tests pass. No staging or live
SQL tests have been executed by Codex during local preparation.

Updated local test command:
node --test src/services/replacementRecommendations.test.js src/services/simulatorRosterService.test.js src/services/simulatorPaginationService.test.js
