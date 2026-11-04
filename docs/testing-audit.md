# Playwright scope and preservation report

## Agreed scope

Reference: (Week 10c) E2E Testing.pptx, slides 3-5, 11 and 13.
Browser tests open the app, perform user actions, and assert observable results.
Use descriptive names, automatic waiting, and setup/action/assert comments.

No files have been deleted. Following your instruction, the two Node unit-test
files and 28 non-browser Playwright contract files are retained. Each now explains
its purpose, why it remains useful, and why it is not browser E2E evidence.
Browser fixture helpers, synthetic backends, harnesses and all existing test entry
files are also retained. Mocking alone is not a reason to delete a browser test.

## Commands and evidence

| Command | What it runs |
| --- | --- |
| pnpm test:e2e / pnpm e2e | All preserved browser suites, with a combined HTML/JSON report |
| pnpm test:e2e:application | Full Vue app with isolated client/backend records |
| pnpm test:e2e:simulator:fixtures | Simulator/invitation browser workflows with isolated fixtures |
| pnpm test:e2e:simulator | Configured real app/backend plus retained facility/responsive journeys |
| pnpm test:e2e:report | Opens the combined browser report |
| pnpm test:contracts | Optional retained non-browser checks, separately reported |

All suite configurations share playwright.viewports.js: 1280x800, 1440x900,
1920x1080, 390x844, 375x667 and 320x568. Mobile projects enable touch/mobile
emulation in Chromium. These checks do not certify physical devices or other browsers.
Application desktop projects run the complete feature suite. Dedicated mobile
entries check touch forms/navigation and register the same full-app simulator journeys.
Simulator fixtures and real-app responsive journeys run at every requested size.

The default browser command excludes the retained contracts and Node tests. One
standalone function test inside disruptionSchedule.spec.js is labelled [non-browser]
and excluded too. Supplementary state assertions within a browser journey remain
useful for checking that user actions produced the expected isolated records.

Fixture tests execute real Vue components and services, with a synthetic data
boundary. They verify UI workflows, refusals and recovery transitions; they do not
prove live database RLS, real booking writes, or actual Telegram delivery. Live
simulator tests require genuine backend authentication and fail missing evidence
rather than skipping. The developer-demo browser scenario follows the product's
normal demo-persona fallback and is not evidence of a real membership grant.

Simulator Pip is intentionally hidden on mobile. Its desktop settings case is
selected only for desktop projects; the touch-only date/time case is selected only
for touch projects. These selections avoid treating inapplicable cases as passes.

## Retained lower-level files

| File | Why it remains useful |
| --- | --- |
| `tests/unit/simulatorEventCatalog.test.mjs` | Checks how saved events and Day-of Operations records are combined, deduplicated, and validated. |
| `tests/unit/simulatorPresentation.test.mjs` | Checks readable impact summaries, correct counts, and recovery shortlists without changing engine results. |
| `e2e-simulator/contracts/services/campusConnectScenarios.spec.js` | Checks representative member absence, room outage, and delay calculations against known fixture evidence. |
| `e2e-simulator/contracts/services/combinedSimulationService.spec.js` | Checks combining multiple disruptions and ranking recovery alternatives without corrupting the original schedule. |
| `e2e-simulator/contracts/services/professorReplacementScenario.spec.js` | Checks that member replacements require the relevant role and availability evidence. |
| `e2e-simulator/contracts/services/replacementRecommendations.spec.js` | Checks replacement eligibility, ranking, conflicts, and cautious handling of incomplete evidence. |
| `e2e-simulator/contracts/services/simulatorBookingBridge.spec.js` | Checks that simulator booking discovery remains connected to the calendar service and expected refresh events. |
| `e2e-simulator/contracts/services/simulatorCalendarIntegration.spec.js` | Checks calendar booking evidence and integration state independently of browser rendering. |
| `e2e-simulator/contracts/services/simulatorCalendarNavigation.spec.js` | Checks preservation and validation of facility/time context when building calendar links. |
| `e2e-simulator/contracts/services/simulatorControlRoomService.spec.js` | Checks transformation of activity dependencies and timing evidence into the impact workspace model. |
| `e2e-simulator/contracts/services/simulatorDisruptionResolution.spec.js` | Checks that resolving a disruption uses explicit reviewed requests and persisted status. |
| `e2e-simulator/contracts/services/simulatorFacilityEvidence.spec.js` | Checks room facts and booking periods used when explaining facility recommendations. |
| `e2e-simulator/contracts/services/simulatorFacilityIntervals.spec.js` | Checks room and activity time intervals, overlap, coverage, and boundary cases. |
| `e2e-simulator/contracts/services/simulatorFacilityPresentationService.spec.js` | Checks that room alternatives and booking limitations are presented honestly and consistently. |
| `e2e-simulator/contracts/services/simulatorFacilitySetupService.spec.js` | Checks interpretation of existing activity-to-booking links and missing booking evidence. |
| `e2e-simulator/contracts/services/simulatorLogisticsRecoveryAccess.spec.js` | Checks source-level logistics access rules so recovery controls do not silently lose their intended role checks. |
| `e2e-simulator/contracts/services/simulatorMigrationHardening.spec.js` | Checks migration safeguards, timestamp precision, revisions, and exact-state comparisons. |
| `e2e-simulator/contracts/services/simulatorMigrationSecurity.spec.js` | Checks SQL source for authorization, grants, locking, and transaction safeguards; it does not execute PostgreSQL. |
| `e2e-simulator/contracts/services/simulatorOriginalBookingReview.spec.js` | Checks SQL/source safeguards around reviewing and linking original bookings. |
| `e2e-simulator/contracts/services/simulatorOriginalBookingService.spec.js` | Checks original-booking workflow requests, exact associations, and persisted confirmation. |
| `e2e-simulator/contracts/services/simulatorPaginationService.spec.js` | Checks that paginated backend reads detect incomplete, repeated, or invalid result pages. |
| `e2e-simulator/contracts/services/simulatorReadOnlySafety.spec.js` | Checks that the live-test network guard permits reads/authentication and rejects operational writes. |
| `e2e-simulator/contracts/services/simulatorRecoveryTracker.spec.js` | Checks whether saved recovery requirements are pending, ready, blocked, or complete. |
| `e2e-simulator/contracts/services/simulatorRosterService.spec.js` | Checks roster normalization, allowed fields, membership evidence, and incomplete or rejected reads. |
| `e2e-simulator/contracts/services/simulatorTelegram.spec.js` | Checks mocked invitation delivery authorization, deduplication, missing configuration, and uncertain delivery; it sends no messages. |
| `e2e-simulator/contracts/services/simulatorTwoStageWorkflow.spec.js` | Checks separation of tentative previews, persisted recovery preparation, and final Apply/Undo decisions. |
| `e2e-simulator/contracts/services/simulatorUndoSafety.spec.js` | Checks SQL/source safeguards for Undo and preservation of the reviewed recovery workflow. |
| `e2e-simulator/contracts/services/simulatorWorkflowActivation.spec.js` | Checks that recovery writes remain disabled unless exact project and environment activation gates are satisfied. |
| `e2e-simulator/contracts/services/simulatorWorkflowService.spec.js` | Checks recovery request payloads, revisions, state fingerprints, confirmation results, and error handling. |
| `e2e-simulator/contracts/components/SimulatorRecoveryWorkflow.spec.js` | Checks component state during account/event races, explicit confirmations, failed reads, and saved recovery transitions. |

## Changes made during the audit

- Preserved all files and added purpose/scope comments throughout tests and helpers.
- Fixed test-to-test imports by registering shared simulator journeys from a helper
  independently for desktop and mobile, preventing omitted mobile coverage.
- Updated stale meeting/operations workflows and selectors to current user controls.
- Added isolated meeting API records and explicit sample-plan fallback setup.
- Replaced fixed sleeps and hardcoded facility counts with observable assertions.
- Moved fixed mobile navigation outside the blurred header so account/bell controls
  remain reachable. A blurred ancestor otherwise traps the fixed bar over them.
- Connected the existing guest-explore event to a visible read-only entry control.
- Added Escape cancellation for idle booking confirmations, kept unread state when
  mark-read fails, and rejected personal schedule end times before start times.
- Normalized Windows line endings in a retained SQL-text comparison.

## Validation

The final unified command, **pnpm test:e2e**, completed on 5 November 2026
(Singapore): **1,242 passed, 0 failed, 0 skipped, 0 flaky**, in 19.4 minutes.
Automatic retries were disabled.

| Viewport | Application | Simulator fixtures | Real app/backend | Total passed |
| --- | ---: | ---: | ---: | ---: |
| Desktop 1280x800 | 88 | 147 | 9 | 244 |
| Desktop 1440x900 | 88 | 147 | 9 | 244 |
| Desktop 1920x1080 | 88 | 147 | 9 | 244 |
| Mobile 390x844 | 14 | 147 | 9 | 170 |
| Mobile 375x667 | 14 | 147 | 9 | 170 |
| Mobile 320x568 | 14 | 147 | 9 | 170 |

All main mobile routes under test are present: facilities, My Club, Waitlist,
personal schedule, meeting scheduler, operations, simulator and OSL review.
Simulator Pip remains intentionally desktop-only; this is not a missing page.
Mobile layouts can require vertical scrolling or internal calendar/graph scrolling.

Combined report: playwright-report/all-browser/index.html. Machine-readable
evidence: test-results/all-browser/results.json. The six backend-smoke cases
supplement browser workflows and are not independently complete user journeys.
Fixture results do not establish live booking writes or actual Telegram delivery.
Facility and operations screenshots for all six sizes are available in
test-results/visual-review/.

The separately retained Playwright-runner contracts pass: **263/263**. These are
non-browser checks, retained for safety and edge-case coverage, and are not counted
as browser E2E passes. The two Node unit-test files are preserved and were not
executed because they are outside the requested Playwright scope.

The production build (pnpm build) and git diff --check also passed. These are
compilation and change-hygiene checks, not additional test frameworks. All 94
test/support code files contain explanatory comments. Git confirms no tracked file
deletions. The pnpm e2e alias invokes the identical command as pnpm test:e2e.
