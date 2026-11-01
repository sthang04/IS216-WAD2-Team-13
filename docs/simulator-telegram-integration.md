# Replacement invitation and Telegram integration review

Reviewed 1 November 2026. Source changes only; nothing deployed or migrated.

## Existing merged implementation

- supabase/functions/send-telegram-notifications/index.ts is the real shared server-side sender. It reads queued public.notifications and calls Telegram sendMessage. Originally eligible types were WAITLIST_OFFER, WAITLIST_REMINDER, TRANSFER_APPROVED, TRANSFER_REJECTED and TRANSFER_EXPIRED. No simulator invitation type was connected.
- supabase/functions/telegram-webhook/index.ts validates TELEGRAM_WEBHOOK_SECRET and handles account linking using expiring one-time /start codes, approved tester registration and /stop. Its inline links open PULSE; there is no replacement consent callback to reuse.
- src/services/notificationService.js contains notification bell reads, mark/delete operations, realtime subscription, createTelegramLinkCode and fetchTelegramLinked. Browser code receives a link code, never bot credentials or chat IDs. VITE_TELEGRAM_BOT_USERNAME is a public bot username.
- supabase/migrations/20261030000100_pulse_telegram_link_security.sql binds account-link generation to auth.uid(), regardless of demo identity. telegram_links maps a member ID to their private Telegram chat ID.
- supabase/migrations/20261024000400_pulse_schedules_optional.sql schedules the shared sender every minute using service credentials from Vault. An organizer does not directly call Telegram.
- src/App.vue still contains an unrelated meeting toast claiming a Telegram broadcast; that text is not evidence of delivery and is not used by this recovery integration.

- supabase/functions/_shared/simulatorInvitationDelivery.js already provides deliverSimulatorInvitation, an unused extension point requiring an injected sender. Only tests call it; it is not a deployed notification mechanism. It formats full event/assignment terms and links to /events. The isolated simulator worker uses a minimal inbox reminder instead, leaving this existing tested helper intact. The remaining Telegram preview heading/comment in EventRiskView.vue has no dispatch implementation.

## Existing replacement workflow

- supabase/migrations/202610310002_simulator_recovery_workflow.sql owns simulator_private.recovery_plans, replacement_invitations and recovery_audit. No public notification insertion is safe: the live notification table still has an unconditional prototype SELECT policy for anon/authenticated and push-related behavior.
- rpc_simulator_start_plan creates invitations through rpc_simulator_invite during the confirmed Prepare recovery requests operation. Merely selecting a candidate or comparing a proposal does neither. Existing active invitation reuse and uniqueness checks prevent duplicate invitation records.
- Invitations reference the plan, recipient and replaced member; assignment_snapshot records exact assignment/activity/role/timing consent. Stored consent states are Pending, Accepted, Declined, Expired and Cancelled. Delivery is a separate field.
- rpc_simulator_my_invitations in migration 003 derives the recipient from the signed-in account and checks active club membership. rpc_simulator_respond_invitation additionally locks plan/invitation rows, checks recipient identity, expiry, current source state and exact invitation terms, and rejects conflicting responses. It never applies an assignment.
- src/services/simulatorWorkflowService.js is the existing gated, explicitly confirmed RPC adapter. src/components/SimulatorInvitationInbox.vue supplies Accept/Decline and a response confirmation step.
- Members navigate to Personal Schedule > My replacement invitations, at /personal-schedule#simulator-invitation-inbox. src/views/PersonalScheduleView.vue already mounts the inbox for signed-in members; src/App.vue and src/router/index.js already expose Personal Schedule through normal navigation. It was not necessary to create another page.
- src/components/SimulatorRecoveryWorkflow.vue and src/services/simulatorRecoveryTracker.js read real organizer history and track member consent separately from room approval. Organizer refresh/existing history polling observes responses. Accepted consent does not assign anyone; pending room approval still blocks Apply. Saved-plan IDs, revision checks, explicit organizer confirmation and final backend Apply/Undo validation remain intact.

## Local changes: isolated architecture

1. The original send-telegram-notifications/index.ts is restored to merged-main commit 831eb65 after reviewing every hunk. Its authentication, public queue, five types/templates, test-chat behavior, recipient selection, result handling and cron job are unchanged. No unrelated local changes were present. telegram-webhook/index.ts and src/services/notificationService.js are unchanged as well.
2. A new send-simulator-invitation-notifications/index.ts entry point delegates to _shared/simulatorInvitationWorker.js. It does not import or invoke the original sender, query public.notifications, or share a processing batch. Simulator queue, send and persistence errors cannot interrupt the original scheduled job. A broken original queue cannot prevent simulator delivery either.
3. _shared/telegramTransport.js uses the same TELEGRAM_BOT_TOKEN and sendMessage conventions (Pulse prefix, Open in Pulse link button) as the original sender. It creates no new bot or credential. The original sender is intentionally not refactored to import this helper, so its source stays exact. Both workers still depend on the same external Telegram service/bot quota; process isolation does not eliminate Telegram-wide outages or rate limits. The simulator claim batch is limited to five, with a bounded send timeout and no retries.
4. Only the new worker requires Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>, checked before any queue read. It accepts POST only. Ordinary authenticated user JWTs, anon/publishable keys and absent/wrong credentials are rejected. No new restriction is applied to existing shared-sender callers. A separate browser entry point or direct organizer-triggered queue drain is not provided.
5. SIMULATOR_TELEGRAM_ENABLED must be true and TELEGRAM_DELIVERY_MODE must be live. Test mode never claims private invitations or broadcasts them to test chats. Missing bot configuration or an invalid/non-HTTPS public PULSE_BASE_URL fails before claims. Reuse the existing backend configuration, without changing the original worker's settings.
6. The prepared, unapplied migration adds a private claim token/timestamp, explicitly retains invitation-table RLS, and exposes claim/finish RPCs only to service_role. Claims check the invitation gate, pending consent, expiry, draft plan and exact current terms/source state. SKIP LOCKED prevents concurrent claims. The queue is the existing private invitation rows, not public notifications. Only invitation ID, claim token and recipient ID leave the claim RPC; notification text is generated by trusted worker code.
7. Delivery and consent remain independent. SENT means Telegram returned a confirmed result; NO_CHAT means no linked account; FAILED means a known lookup/send failure; UNKNOWN means an ambiguous network/response outcome. Failed status persistence returns UNCONFIRMED to the backend caller and leaves persisted Sending unchanged. Completion replay with the same token/result is idempotent; conflicting completion is rejected. Nothing is automatically requeued after a claim. This is at-most-one send attempt, not a promise of exactly-once network delivery. Claims interrupted by crashes require operational review, not blind retry.
8. A generic inbox reminder contains no event/member/role/schedule/claim details. The link is /personal-schedule#simulator-invitation-inbox, with no demo impersonation parameters. Existing Accept/Decline RPCs, confirmation UI, independent member/facility tracker, saved plan revisions and final Apply/Undo checks are preserved. The earlier local inbox context/expiry improvements and duplicate active request button guard remain.
9. EventRiskView.test.js retains the earlier merged-UI harness correction (router/lifecycle mocks and explicit outage input/preview run).

## Read-only live readiness findings

Checked the configured production project using metadata/SELECT queries only:

- Invitation, recipient inbox, response, capability and Apply RPC signatures exist.
- telegram_links exists; shared Telegram sender and webhook are ACTIVE.
- pulse-send-telegram cron job exists and is active.
- invitations_enabled=false; application_enabled=true. Frontend local activation settings are enabled, but they do not override database gates. New invitations and Accept/Decline remain blocked. Application ON does not waive member acceptance or booking requirements.
- rpc_simulator_claim_telegram is absent. The new bridge has not been installed.
- notifications still has the prototype unconditional read policy, so private invitation information must remain outside it.
- Bot token, webhook secret, delivery mode, public base URL, Vault credentials, actual account links and operational delivery were not verified. Secret values were not retrieved. Active function/job metadata does not prove delivery.

## Invocation and remaining release steps

No simulator scheduler has been created, and no migration/deployment/gate activation has occurred. A backend operator must separately authorize and perform these steps:

1. Review and validate the prepared migration in an isolated database, including service-only EXECUTE, RLS, atomic claims and response permissions. Review pending invitation backlog before activation. Apply it only with separate approval.
2. Deploy only the new send-simulator-invitation-notifications function and its new helper files. Leave the original sender, webhook, notification service and pulse-send-telegram job untouched. Keep platform JWT verification enabled for legacy service-role bearer invocations; the new handler also verifies the actual backend key. Do not expose it in browser code or disable authorization to clear a 401.
3. Confirm existing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_DELIVERY_MODE and PULSE_BASE_URL backend configuration; require a public HTTPS PULSE origin and linked member accounts. No new bot is needed. SIMULATOR_TELEGRAM_ENABLED remains an explicit opt-in. Existing invitation/application gates are unchanged.
4. Use a separately approved backend scheduler or operator POST to /functions/v1/send-simulator-invitation-notifications with the existing Vault-backed service-role bearer credential. A separate cron job could follow the original job's Vault pattern but MUST target the new endpoint under a different job name; do not replace, chain, or invoke pulse-send-telegram. No scheduler SQL is executed or embedded in this migration.
5. Only with permission, verify real recipient authorization, account links, delivery and Apply/Undo. There is no automatic resend for failed, missing-chat or uncertain delivery; the PULSE invitation remains available independently.

The original manual trigger credential pattern is unknown. It is not necessary to change it: the original source and platform configuration are preserved. Prior read-only checks confirmed that its active cron job uses Authorization with a Vault-backed pulse_service_key in legacy JWT format, and the deployed original sender has verify_jwt=true. Credential equality, signature validity, current expiry and actual invocation success were not tested; no delivery endpoint was called. The webhook retains its existing secret validation. This preserves existing behavior rather than certifying the original application's broader authorization design.

## Validation and limits

- All 268 source tests passed, including twelve Telegram tests covering the isolated worker and exact merged-main shared-source preservation (with normal Git checkout line endings). Telegram fetch and database-write paths are mocked.
- Original-sender tests compare all five event types, test-chat fanout/deduplication, missing accounts, failed sends, skipped types, queue failures and handler credential behavior against merged main. Simulator tests cover backend-only authorization, single delivery attempt, mocked concurrent atomic claims, inbox links, missing configuration/accounts, known failures, network uncertainty, failed result persistence, and independent queue failures. SQL checks inspect grants, RLS, claim locking, recipient scope and completion idempotency; they do not execute the migration or prove live RLS/concurrency. Gateway authentication is not emulated by handler mocks.
- Existing component/service tests cover candidate preview isolation, invitation confirmation, account-switch isolation, organizer status refresh, declined/expired consent, accepted member with pending room, gate separation and Apply/Undo adapter safeguards.
- Production build passed; the existing bundle-size warning remains. No live Telegram delivery, invitation creation/response, migration application or database Apply/Undo was performed.

Authorization design was checked against Supabase's RLS documentation: https://supabase.com/docs/guides/database/postgres/row-level-security
