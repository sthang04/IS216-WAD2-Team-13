# Member replacement invitation verification

Verified locally on 1 November 2026. No real invitations, responses, Telegram delivery, gate changes or migrations were performed.

## Where members go

Personal Schedule > My Replacement Invitations, at /personal-schedule#simulator-invitation-inbox. The section appears first on the page for signed-in members. Guests do not see this private inbox. The desktop Personal Schedule tab is permission checked through canOpenView. Active non-admin membership rows map to role club in authService.js, which permits Personal Schedule even when can_manage_members, can_claim_booking and can_release_booking are false. This does not require an organizer/admin account; a linked login and active club membership are still prerequisites.

The browser tests use the actual App.vue, router, authService.js persona conversion, PersonalScheduleView.vue, inbox component and workflow RPC adapter. Only the Supabase client and the test-page frontend activation constant are replaced. Every external browser request is blocked. Local mock membership rows have role_name Member, is_admin_role=false and management/booking permissions false. This verifies the actual member navigation/rendering path, rather than just an isolated component.

## Findings and targeted fixes

- The inbox existed at the top of Personal Schedule and was not behind organizer permissions.
- Mobile desktop tabs were hidden below the large breakpoint with no alternative page selector. Added a compact Navigate PULSE selector that uses the existing canOpenView checks, including Personal Schedule. No backend permissions or role definitions changed. The selector has a 44px touch target.
- The original hash had no reliable scroll handling after session restoration/v-show navigation. PersonalScheduleView now waits for its active pane, scrolls below the measured sticky-header height, and focuses the inbox. App.vue passes the active pane state.
- Confirmation near the top of a long inbox could be covered by the sticky header when responding farther down. The confirmation panel now scrolls below the header and receives focus.
- Inbox cards now show a clear section heading, event/club, activity, requested role, Singapore date/time, activity-specific location or an explicit unavailable-location fallback, status, expiry, and wrapping Accept/Decline buttons with 44px minimum height. No duplicate page was added.
- On Personal Schedule the existing mascot quiet-mode prop suppresses its speech bubble so it cannot cover invitation controls; notification-bell access and the mascot remain available. The stored quiet preference is unchanged.
- Added friendly empty/loading/saving states and distinct read/write errors. A closed invitation gate explains that responses are unavailable rather than suggesting a successful write. Buttons stay disabled for non-Pending invitations. JavaScript also rejects opening a response for terminal/expired invitations.

## Accept/Decline trace and organizer tracking

1. Accept/Decline selects the existing invitation ID and exact reviewed terms in SimulatorInvitationInbox.vue; it does not write immediately.
2. The member confirms the response with the existing review checkbox and Confirm invitation response button.
3. createSimulatorWorkflow.respond calls rpc_simulator_respond_invitation with p_invitation_id and p_response (Accepted or Declined), using the shared authenticated client. The caller does not supply a member ID as identity proof. The adapter validates the returned invitation ID/status before reporting success.
4. The existing backend RPC requires the invitation release gate, resolves the actual actor, locks plan then invitation, verifies recipient identity, active club access, expiry, draft/current source state and exact consent terms, then updates that invitation and its response audit. Terminal/conflicting responses are rejected; an identical retry is idempotent, without a second transition. Acceptance never changes the event assignment.
5. After persistence, the inbox refreshes through rpc_simulator_my_invitations and emits responded. Organizer tracking is read from rpc_simulator_plan_history, not the browser's success message or Telegram delivery. SimulatorRecoveryWorkflow already refreshes history manually and every 30 seconds while visible, and on its refreshVersion signal. SimulatorRecoveryTracker matches the exact saved plan/recipient/terms. Declined consent blocks the member requirement; acceptance still leaves facility approval and explicit organizer Apply checks independent.

## Tests

Run: npx playwright test --config playwright.invitations.config.js

All 14 desktop/mobile Playwright checks, all 268 source tests, the production build and git diff --check passed. The existing bundle-size warning remains.

The desktop and mobile Chromium projects exercise:

- Ordinary-member navigation through the real app and full invitation terms.
- Accept on one mock invitation and Decline on another, with exact RPC arguments and correct status after browser reload.
- Accepted consent passed from mock persisted history through the real workflow adapter to the real organizer tracker service. Existing component/service tests additionally cover organizer history refresh, declined consent and pending room approval.
- Account switching clears another member's inbox; a forged response to the old member's ID is rejected by the mock backend.
- Expired/cancelled and already answered invitations have disabled actions.
- Deep link scrolling/focus below the sticky header, no horizontal page overflow, and screenshots on desktop/mobile.
- Friendly empty state, distinct read errors, loading/saving indicators, write failures, and disabled backend gate.

These mocks do not prove live authorization, persistence, Postgres locking or Telegram delivery. No SQL migrations were executed. Browser artifacts are under test-results/invitations and are not production assets.

## Read-only live findings and remaining verification

- invitations_enabled=false and application_enabled=true. The frontend cannot override these database gates. Consequently live members may read their accessible inbox but cannot currently accept/decline; live invitation creation is blocked as well.
- Read-only function-definition checks confirm that the installed inbox is recipient-scoped, and the response RPC contains recipient, expiry and already-answered/cancelled guards. No real invitation records were queried or changed.
- The installed inbox RPC includes club context but does not yet include facility context. Until the already-prepared inbox migration is reviewed/applied under separate authorization, the UI honestly shows Location to be confirmed. The rich-location browser fixture is not proof that live location fields are available.
- Live login/membership visibility, actual invitation reads, cross-account denial, response persistence, organizer refresh, complete facility information and final Apply/Undo still require separately authorized live verification. Read-only checks and mocked tests are not evidence that these end-to-end writes are operational.

Shared Telegram sender, webhook and frontend notification service remain unchanged from merged main.
