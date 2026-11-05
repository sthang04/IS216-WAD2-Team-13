# Complete user workflows with a real backend

These Playwright tests implement the Week 10c setup -> actions -> assertions pattern against the actual Vue app, Supabase Auth, Data API, RPCs and PostgreSQL. Task actions use visible browser controls. They never replace application modules, fabricate a login session or fulfill backend responses.

## Coverage

| Journey | User actions and verified results |
| --- | --- |
| Booking transfer | Owner releases, claimant submits a claim, OSL approves the exact request. The test reads the stored status/ownership and reloads both users' pages after changes. |
| Permission enforcement | A real member of another club has no Release action. Forging an RPC identity and directly patching the booking are refused; another account verifies the record is unchanged. The restricted test-data reset is also refused. |
| Meeting scheduling | Organiser creates a future meeting; organiser and participant vote in separate browser sessions. Each save must be acknowledged and readable from the backend before reload. Another club's forged vote is refused. The organiser confirms; both users reload and see the saved confirmation. |

All three journeys run at desktop 1280x800, 1440x900, 1920x1080 and mobile 390x844, 375x667, 320x568: 18 real-backend checks. Supabase Auth success and the actual user endpoint are checked; the product's demo fallback cannot satisfy these tests. Workers and viewport projects are serial to limit Auth bursts. Retries are disabled and missing credentials fail with an explanation instead of passing skips.

## Running

The existing PULSE-Staging project is configured for these tests. The shared PULSE project is not a write target. The runner rejects any backend URL other than the dedicated staging project.

The ignored .env.live-e2e.local file has been prepared in this workspace. For another checkout, copy .env.live-e2e.example to that filename, supply the staging publishable key and the dedicated accounts' password, and keep the file private. No privileged server key is used by the browser or tests. Member IDs in the template refer only to these reserved test records.

~~~powershell
pnpm test:e2e:backend
# Both aliases also discover the backend workflows alongside the preserved suites:
pnpm e2e
pnpm test:e2e
# Run just the new UI and backend coverage through the combined configuration:
pnpm e2e -- scheduleReadability.spec.js visualRegression.spec.js e2e-backend
~~~

The backend server uses port 5187 and Vite mode live-e2e. Existing fixture servers remain isolated; the ordinary live read-only suite retains its original app configuration.

## Test data and cleanup

Five confirmed Auth accounts use pulse.e2e.owner / claimant / participant / outsider / admin at scis.smu.edu.sg. They are dedicated test identities, with memberships backed by actual database rows. Six test bookings use the E2E_STAGING source and E2E-BOOKING references, with one non-overlapping hour per viewport.

The fixture returns transferred bookings through normal authorised release/claim/approval RPCs. The final app intentionally offers no new Release action on a confirmed booking. A staging-only private helper, reached through rpc_e2e_restore_booking, therefore restores only the already-returned test booking's Booked starting state. It checks both the dedicated administrator identity and OSL membership; it cannot reset another booking or an unfinished transfer. Its SQL is in setup/resetTestBooking.sql. Meetings are cancelled through their normal RPC. Append-only audit history, cancellation records and queued notifications remain as real test evidence.

The older staging project initially lacked the calendar/meeting schema. The setup used its existing simulator tables, schema-only calendar prerequisites and these existing application migrations: calendar alignment/logic; meeting scheduler; multiple meetings; meeting agenda; participant editing. Two obsolete column comments are omitted when replaying the old alignment file. Existing simulator data was preserved.

setup/printSchema.mjs prints that one-time installation SQL for an older staging schema; it does not execute or deploy anything. It excludes the demo reset/seed migrations and delivery sender jobs. The meeting poll-expiry schedule remains conditional on pg_cron. Do not reapply the one-time prerequisite SQL to an already provisioned project.

For reprovisioning, create the five confirmed test users in staging Auth without sending invitations, with the password configured locally. Apply setup/seedRecords.sql only to staging; it resolves Auth UUIDs by email and refuses occupied non-test record IDs. It can renew idle booking dates to two weeks ahead when the real transfer window expires. Run this preparation while the tests are stopped. Production data and accounts are not copied.

## Readability and visual regressions

The new e2e-application/scheduleReadability.spec.js cycles all five sample cards through all three status states at all six sizes. Assertions check one-line status/category labels, reachable actions, title bounds, title/status separation and state after reload. The schedule header now wraps or stacks while keeping status words intact. Completed-title strike-through remains intentional. Personal schedule entries remain browser-local; this change does not move them into the database.

visualRegression.spec.js compares 36 reference PNGs: three schedule status states, notifications, a booking confirmation and a meeting form at each size. It combines semantic assertions with toHaveScreenshot, reduced motion, controlled fixture data and fixed time. The viewport appears in the image name so standalone and combined commands use the same baseline. The images were generated with the current Windows/Chromium/font environment; keep that environment consistent for pixel comparison. Representative mobile and desktop outputs were visually reviewed. Baseline generation alone is not a passing comparison; the final run compares existing references without the --update-snapshots flag.

~~~powershell
pnpm test:e2e:application -- scheduleReadability.spec.js visualRegression.spec.js
# Only regenerate images after reviewing an intended UI change:
pnpm test:e2e:application -- visualRegression.spec.js --update-snapshots
~~~

## Evidence and boundaries

Final verification: **48 new checks passed** in the combined configuration (30 application readability/visual checks and 18 genuine backend checks), with **0 failures, 0 skips and 0 flaky outcomes**, in 11.7 minutes. All six requested dimensions are represented. The existing schedule regression selection also passed **54/54** checks at all six sizes. Total targeted verification: **102 passed**. Production build and Git whitespace checks passed; the existing bundle-size warning remains.

The full default command discovers **1,827 checks**; that entire unfiltered suite was not repeated for this change. The final combined command was pnpm e2e -- scheduleReadability.spec.js visualRegression.spec.js e2e-backend. Existing regressions used pnpm test:e2e:application -- schedule.spec.js appWideUi.spec.js --grep schedule --workers=4.

Combined-run evidence is test-results/all-browser/results.json and playwright-report/all-browser/index.html. The existing schedule selection is test-results/application/results.json. The separate backend command writes test-results/backend-workflows/results.json. The final fixture-seed SQL was also checked inside a transaction that was rolled back.

A final database query confirmed 6 reserved bookings, all 6 restored to the original club and Booked status, no unfinished test transfers, no open test meetings and all 5 dedicated accounts retained. No production writes or external message delivery were performed.

These journeys establish real staging persistence and specific database/RPC write-permission outcomes. They do not establish production deployment parity, every RLS policy, physical iPhone/Safari rendering, simultaneous competing claims, OneMap availability or actual email/Telegram delivery. Staging has no deployed sender functions or delivery cron jobs; routing calls can fall back normally, and test request guards reject production API traffic and delivery calls. UI notification wording is not treated as proof of external delivery.

The application schema reused for staging carries existing Supabase advisories, including owner-executed calendar/membership views. Specific write denials passing is not a complete security audit. See [Supabase's view advisory](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view). The existing view/permission architecture was retained rather than silently changing the deployed app's access design.

Only Playwright browser tests are used for automated verification. SQL inspection/provisioning, schema-generator checks, the production build and Git whitespace checks support the setup; they are not an additional test framework. Existing unit/contract files are retained, and no existing files were deleted.

## Telegram alert follow-up (5 November 2026)

telegramAlerts.spec.js adds real browser/database journeys for personal schedule CRUD notices and saved Day-of Ops crew notices, including outsider read/queue denial. Both run at all six sizes. Staging remains isolated from external Telegram delivery. The schema printer now includes Ops events/times and the new alert RPCs, while still excluding delivery Cron activation.

See [Telegram wiring and current verification](../supabase/telegram-alerts.md) for the deployment status, routing rules and the additional retained non-browser/Node checks used for this follow-up. The earlier evidence section above describes its original change, not this new run.