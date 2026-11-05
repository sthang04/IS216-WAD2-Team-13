# Playwright audit after the November 5 updates

## Scope and deletion report

No file deletions are proposed. One code-only removal is proposed: the unused guest(page, app, path) helper in e2e-application/fixtures/journeys.js. It targets the removed guest entry button and has no callers. It is retained with a deprecation comment pending your approval; no removal has been performed. All original test files are retained, including the two Node unit files and 28 non-browser Playwright contract files you explicitly asked to keep. They remain outside the default browser command. Generated reports, screenshots and traces are ignored output, not source tests.

The obsolete public guest-entry workflows were rewritten as signed-out route-protection workflows because the product removed guest entry. Their unused shared guest-navigation helper remains commented as deprecated, pending your approval to remove it. No guest button or product behavior was restored to satisfy old tests.

## Reviewed evidence

Reviewed the supplied terminal transcript, the current Git history from 662b7a9 through 8b08220, changed application code, preserved test/support code and the Week 10c E2E Testing slides. The transcript ends at d1c8d03; the checkout also contains the newer 8b08220 heatmap update. The slides are reference material, not instructions to delete files or deliberately leave failing tests.

Slides 3 and 5 distinguish full integrated E2E workflows from isolated checks. Slides 4, 11 and 13 support auto-waiting, meaningful assertions, descriptive names and setup/actions/assertions. Browser fixtures are explicitly reported as browser regressions; they do not prove a deployed database mutation or notification delivery.

## What your friend changed

- Compact responsive landing page, persona cards, loading trivia and a minimum login transition.
- Removed the public guest entry and guest banner.
- Replaced mobile bottom navigation with top navigation; shortened desktop labels.
- Hid floating Pip below 992px to keep controls clear; changed mobile filters into a two-column grid.
- Changed Marcus to Symphonia and renamed MLCC to Rentak.
- Canonicalized and deduplicated membership club names.
- Added overlapping-booking checks on the calendar and before accepting a claim/offer.
- Updated meeting loading, ordered vote persistence, keyboard voting, past-slot handling, recommendation filtering and calendar text escaping. The latest heatmap uses separate cell clicks rather than drag painting.
- Improved operations date calculations, persona-specific schedule examples and the configured production review URL.

## What this audit changed

- Added ten commented browser workflows, registered for all six viewport sizes: landing/persona drawer/login/Pip visibility; overlapping booked, approved and pending slots; adjacent bookings; waitlist conflict rejection; club-alias deduplication; keyboard and rapid votes; failed-vote recovery; escaped calendar export with Singapore timestamps.
- Replaced six unsupported guest-entry workflows with signed-out route/refresh protection checks.
- Updated shared navigation helpers to follow visible compact or full desktop labels.
- Updated the preserved invitation journey for compact desktop labels, and the isolated calendar harness for the new authentication imports and a conflict-free claimant. All 60 affected invitation/calendar checks passed across the six sizes before the final run.
- Separated ordinary claim-success fixtures from explicit overlapping fixtures and supplied raw booking reads used by the production claim safeguard. Simulator fixture data remains separate.
- Fixed a production gap in MasterFacilityCalendarView.vue: officially confirmed bookings must occupy their time when deciding whether another slot conflicts. Booked and pending-claim behavior remains covered.
- Live validation exposed slow sign-in/session/bootstrap requests. Live projects now use one worker and ordered viewport projects, 45-second assertion waits and a 180-second overall workflow budget, with zero retries. The combined configuration preserves the project ordering after prefixing names. The responsive live journey now follows visible navigation controls within one session instead of reloading the whole app for each route.
- Retained purpose/logic comments in all test and support code; new files explain their shared registration and isolated API boundary.

## Verification

Final validation on November 5, 2026: **1,251 fixture browser checks passed**, followed by **54/54 live checks passed** through pnpm e2e -- --project=live-* (exit 0, 9.6 minutes). Latest results contain zero failures, skips or flaky outcomes; retries are zero. The ten added journeys account for 60 viewport executions.

Validation was performed across two phases, not one fresh full run after the live fixes. The earlier complete run passed all fixture checks but failed 31 live checks under the former timing/concurrency settings. Every live check was then rerun successfully after the fixes; unchanged fixture code was not rerun. The earlier report is retained at test-results/audit-evidence/before-live-fixes.json, and the successful live follow-up is test-results/all-browser/results.json.

| Viewport | Fixture checks | Live follow-up | Total passed |
| --- | ---: | ---: | ---: |
| 1280x800 | 246 | 9 | 255 |
| 1440x900 | 246 | 9 | 255 |
| 1920x1080 | 246 | 9 | 255 |
| 390x844 | 171 | 9 | 180 |
| 375x667 | 171 | 9 | 180 |
| 320x568 | 171 | 9 | 180 |

The default commands pnpm e2e and pnpm test:e2e both execute playwright test using the same configuration. No additional test framework was introduced or run. A production pnpm build check also passed; it reports the existing bundle-size warning.

Desktop: 1280x800, 1440x900, 1920x1080. Mobile: 390x844, 375x667, 320x568. The default configuration combines application, simulator/invitation fixture and real-app/read-only backend projects. Retries remain zero. Retained Node units and non-browser contracts were not run in this audit.

## Coverage boundaries

The real-app responsive journey checks landing, facilities, My Club, waitlist, personal schedule, meeting heatmap, operations and simulator routes. The OSL role has a separate mobile review-navigation check. Fixture workflows cover mutations without changing shared production bookings or sending real notifications.

One diagnostic genuine request to segment_facility_bookings returned HTTP 500 while the app subsequently recovered enough to enable event selection. Successful browser journeys do not certify every backend query is healthy.

Physical iPhone/Safari native pickers, real Telegram/email delivery, deployed write authorization/RLS, production migration application and concurrent database claims are not verified by fixture passes or Chromium viewport emulation. Live backend journeys provide read-only integration evidence. The Dev Administrator journey uses the product's existing built-in persona fallback when database membership rows are absent; it does not prove a real database administrator grant. Mobile Pip is a deliberately absent feature in the current source, not a missing page.

Screenshots from the current views are under test-results/recent-visual. The latest HTML report, playwright-report/all-browser/index.html, contains the successful 54-check live follow-up; the table above combines that evidence with the earlier 1,251 successful fixture checks. Run pnpm test:e2e:report to open it.

## Retained checks outside browser E2E

These are useful lower-level protection, retained as requested and excluded from the browser result total. The existing per-file comments explain their specific purpose. No deletion is requested.

- e2e-simulator/contracts/components/SimulatorRecoveryWorkflow.spec.js
- e2e-simulator/contracts/services/campusConnectScenarios.spec.js
- e2e-simulator/contracts/services/combinedSimulationService.spec.js
- e2e-simulator/contracts/services/professorReplacementScenario.spec.js
- e2e-simulator/contracts/services/replacementRecommendations.spec.js
- e2e-simulator/contracts/services/simulatorBookingBridge.spec.js
- e2e-simulator/contracts/services/simulatorCalendarIntegration.spec.js
- e2e-simulator/contracts/services/simulatorCalendarNavigation.spec.js
- e2e-simulator/contracts/services/simulatorControlRoomService.spec.js
- e2e-simulator/contracts/services/simulatorDisruptionResolution.spec.js
- e2e-simulator/contracts/services/simulatorFacilityEvidence.spec.js
- e2e-simulator/contracts/services/simulatorFacilityIntervals.spec.js
- e2e-simulator/contracts/services/simulatorFacilityPresentationService.spec.js
- e2e-simulator/contracts/services/simulatorFacilitySetupService.spec.js
- e2e-simulator/contracts/services/simulatorLogisticsRecoveryAccess.spec.js
- e2e-simulator/contracts/services/simulatorMigrationHardening.spec.js
- e2e-simulator/contracts/services/simulatorMigrationSecurity.spec.js
- e2e-simulator/contracts/services/simulatorOriginalBookingReview.spec.js
- e2e-simulator/contracts/services/simulatorOriginalBookingService.spec.js
- e2e-simulator/contracts/services/simulatorPaginationService.spec.js
- e2e-simulator/contracts/services/simulatorReadOnlySafety.spec.js
- e2e-simulator/contracts/services/simulatorRecoveryTracker.spec.js
- e2e-simulator/contracts/services/simulatorRosterService.spec.js
- e2e-simulator/contracts/services/simulatorTelegram.spec.js
- e2e-simulator/contracts/services/simulatorTwoStageWorkflow.spec.js
- e2e-simulator/contracts/services/simulatorUndoSafety.spec.js
- e2e-simulator/contracts/services/simulatorWorkflowActivation.spec.js
- e2e-simulator/contracts/services/simulatorWorkflowService.spec.js
- tests/unit/simulatorEventCatalog.test.mjs
- tests/unit/simulatorPresentation.test.mjs
