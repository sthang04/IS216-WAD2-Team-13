# Telegram alert wiring — 5 November 2026

## Recipients and behavior

- Personal Schedule add/edit/delete: only the authenticated member. Entries themselves remain browser-local.
- Day-of Ops Notify crew and delay: active crew on the saved event, within the caller's active CCA. Local plans must resolve every name uniquely to a real member; synthetic sample numeric IDs are never delivery identities.
- Simulator replacement invitations: only the persisted invitation recipient. Claiming delivery does not accept an invitation or apply event changes. Expired, stale and non-draft requests are excluded.
- Meeting participant removal and agenda changes: added to the existing sender allowlist; existing meeting/transfer/waitlist types remain supported.
- Newly registered users need a real Pulse membership and must use Notifications > Connect Telegram > Start. Their linked chat is discovered dynamically; no hardcoded recipient route or tester allowlist is required.
- An explicit account link takes precedence over an existing configured stand-in. New linked users and the new private schedule/crew/invitation paths receive no developer observer copies. Existing email delivery was not changed.
- Unlinked recipients are recorded as NO_CHAT. Linking requeues recent personal/crew notices (24 hours) and still-valid private invitations. Successful, failed or uncertain sends are not replayed by linking.
- Private invitation transport attempts once per claim. A timeout is UNKNOWN; a failed status write is UNCONFIRMED, rather than a claim of delivery.

The existing shared project is configured in DEMO delivery mode. That mode sends actual Telegram messages to configured stand-in chats or explicit member links; it is not a fake transport. It was preserved to avoid breaking the team's existing waitlist demonstrations. LIVE mode uses each member's explicit linked chat only.

## Backend deployment

Shared PULSE project:
- send-telegram-notifications v14 ACTIVE
- telegram-webhook v18 ACTIVE
- send-simulator-invitation-notifications v2 ACTIVE
- telegram_alert_wiring, simulator_telegram_schedule and simulator_telegram_worker_auth migrations applied.
- Both Telegram jobs are active every minute. Existing Vault credentials are reused without copying secrets into source.
- At 16:42 and 16:43 Singapore time the simulator job returned HTTP 200 with checked=0, sent=0, failed=0. The general sender also returned 200.
- The initial new worker rejected Cron's older Vault credential. The service-only database comparison now validates it securely; anonymous/authenticated browser roles cannot call this comparison or claim private invitations.

No artificial verification message was sent to a teammate, and there were no pending simulator invitations at verification time. These checks prove deployed scheduling/authentication/queue availability, not a fresh recipient's observed Telegram delivery. The next legitimate intended alert will exercise that final transport step.

Frontend changes are local working-tree changes and still require the normal frontend deployment. The backend also accepts the currently published client's reserved Day-of Ops alert titles, resolving them to exactly one saved event in the caller's CCA. Ambiguous/unsaved events are refused rather than sent to the wrong people. No simulator frontend component was edited.

## Verification

The browser tests use Setup -> Actions -> Assertions, visible controls, and awaited outcomes:
- 27 real-backend Playwright checks passed, 0 failures/skips/flaky outcomes. Includes 12 new alert checks and 15 existing dependency workflow checks. All desktop sizes (1280x800, 1440x900, 1920x1080) and mobile sizes (390x844, 375x667, 320x568) are represented.
- 18 fixture-browser checks passed across all six sizes: successful queue feedback, backend refusal and duplicate-click prevention.
- 16 non-browser Playwright contract checks passed: recipient privacy, new-user routing, worker authorization, queue outcomes and existing sender behavior.
- 12 retained Node unit checks passed. These are an additional test form, retained to verify the shared recipient-routing helper's existing email/Telegram behavior without sending external messages.
- Rolled-back staging SQL assertions checked actual private claim-once behavior, idempotent completion, rejection of conflicting completion, no public invitation notifications, and published-client crew/delay compatibility.
- Production build and Git whitespace checks passed. The existing large-bundle warning remains.

Browser/backend tests intentionally run on PULSE-Staging, without sender functions or delivery jobs. They verify real Auth, RPCs, PostgreSQL persistence and recipient read isolation without messaging real users. Fixture tests and contract tests do not prove real external delivery. The full unfiltered app suite was not rerun for this Telegram change.

Commands:
~~~powershell
pnpm test:e2e:backend -- telegramAlerts.spec.js
pnpm test:e2e:application -- telegramAlerts.spec.js operations.spec.js --grep "Notify crew|notify crew" --workers=4
pnpm test:contracts -- simulatorTelegram.spec.js telegramRecipients.spec.js
node --test tests/unit/notificationRecipientRouting.test.mjs
pnpm build
~~~

Reports: test-results/backend-workflows/results.json and playwright-report/backend-workflows/index.html; fixture report under playwright-report/application. No files were deleted. Existing screenshot artifacts were preserved.
Recipient naming follow-up: the shared helper is notificationRecipientRouting.js, with resolveEmailRecipients and resolveTelegramRecipients. Its retained unit file is notificationRecipientRouting.test.mjs; the optional account-routing setup is notificationRecipientSetup.sql. Imports, comments and references were updated. Existing database identifiers, deployment configuration values and historical migration filenames retain their original names for compatibility. This naming follow-up is local; it does not redeploy the hosted functions.