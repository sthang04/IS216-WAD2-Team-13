import {viewportProjects} from './playwright.viewports.js'
// Browser-only fixture regressions; contract files are preserved but excluded from E2E discovery.
// Mocked responses test UI workflows and do not prove live Supabase integration.
import {defineConfig} from '@playwright/test'

// Both suites run the real Vue UI with isolated data. Never reuse a server whose
// environment could enable live recovery writes or invitation delivery.
export default defineConfig({
 testDir:'.',
 testMatch:['e2e-simulator/*.spec.js','e2e-invitations/**/*.spec.js'],
 outputDir:'test-results/simulator',workers:2,forbidOnly:!!process.env.CI,retries:0,
 reporter:[['list'],['html',{outputFolder:'playwright-report/fixtures',open:'never'}],['json',{outputFile:'test-results/simulator/results.json'}]],
 use:{actionTimeout:15000,baseURL:'http://127.0.0.1:5186',browserName:'chromium',trace:'retain-on-failure',screenshot:'only-on-failure',serviceWorkers:'block'},
 webServer:{command:'pnpm dev --host 127.0.0.1 --port 5186 --strictPort',
  url:'http://127.0.0.1:5186/e2e-simulator/harness.html',
  env:{VITE_SUPABASE_URL:'',VITE_SUPABASE_ANON_KEY:'',VITE_SIMULATOR_WORKFLOW_ENABLED:'false',VITE_SIMULATOR_PRODUCTION_APPROVED:'false'},
  reuseExistingServer:false,timeout:60000},
 // All browser workflows run at the same six sizes. Capability-specific tests
 // are selected by project rather than counted as passing skipped tests.
 projects:viewportProjects().map(project=>({...project,
  grepInvert:project.use.hasTouch?/simulator Pip settings persist|\[non-browser\]/:/touch can reach both date and time dropdowns|\[non-browser\]/})),

})
