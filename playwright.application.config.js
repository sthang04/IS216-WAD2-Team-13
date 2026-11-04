import {viewportProjects} from './playwright.viewports.js'
﻿import {defineConfig} from '@playwright/test'

// Test-only server: no real credentials, workflow activation, or server reuse.
export default defineConfig({
 timeout:45000,expect:{timeout:10000},testDir:'./e2e-application',testMatch:'**/*.spec.js',workers:1,retries:0,
 forbidOnly:!!process.env.CI,reporter:[['list'],['json',{outputFile:'test-results/application/results.json'}]],outputDir:'test-results/application',
 use:{actionTimeout:15000,baseURL:'http://127.0.0.1:5188',browserName:'chromium',serviceWorkers:'block',
  timezoneId:'Asia/Singapore',trace:'retain-on-failure',screenshot:'only-on-failure'},
 webServer:{command:'pnpm dev --config e2e-application/vite.config.js --host 127.0.0.1 --port 5188 --strictPort',
  url:'http://127.0.0.1:5188',reuseExistingServer:false,timeout:60000,
  env:{VITE_SUPABASE_URL:'',VITE_SUPABASE_ANON_KEY:'',VITE_TELEGRAM_BOT_USERNAME:'pulse_fixture_bot',
   VITE_SIMULATOR_WORKFLOW_ENABLED:'false',VITE_SIMULATOR_PRODUCTION_APPROVED:'false'}},
 // Desktop runs the complete feature suite; mobile entries exercise touch-specific journeys.
 projects:viewportProjects('foundation-').map(project=>({...project,
  ...(project.use.hasTouch?{testMatch:'**/*.mobile.spec.js'}:{testIgnore:'**/*.mobile.spec.js'})})),

})


