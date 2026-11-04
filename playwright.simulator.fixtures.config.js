// Optional fixture-backed regression suite; never evidence of real Supabase integration.
import {defineConfig} from '@playwright/test'

// Both suites run the real Vue UI with isolated data. Never reuse a server whose
// environment could enable live recovery writes or invitation delivery.
export default defineConfig({
 testDir:'.',
 testMatch:['e2e-simulator/*.spec.js','e2e-invitations/**/*.spec.js'],
 outputDir:'test-results/simulator',workers:2,forbidOnly:!!process.env.CI,retries:0,
 reporter:[['list'],['html',{outputFolder:'playwright-report/fixtures',open:'never'}],['json',{outputFile:'test-results/simulator/results.json'}]],
 use:{baseURL:'http://127.0.0.1:5186',browserName:'chromium',trace:'retain-on-failure',screenshot:'only-on-failure',serviceWorkers:'block'},
 webServer:{command:'pnpm dev --host 127.0.0.1 --port 5186 --strictPort',
  url:'http://127.0.0.1:5186/e2e-simulator/harness.html',
  env:{VITE_SUPABASE_URL:'',VITE_SUPABASE_ANON_KEY:'',VITE_SIMULATOR_WORKFLOW_ENABLED:'false',VITE_SIMULATOR_PRODUCTION_APPROVED:'false'},
  reuseExistingServer:false,timeout:60000},
 // Deterministic fixture workflows run at the desktop/mobile layout extremes.
 // The actual-backend suite covers all six requested viewports, and dedicated
 // fixture geometry journeys also sweep all six; duplicating every mock/RPC
 // scenario at every intermediate width adds no separate contract coverage.
 projects:[
  {name:'desktop-1280x800',testMatch:['e2e-simulator/*.spec.js','e2e-invitations/**/*.spec.js','e2e-simulator/contracts/**/*.spec.js'],use:{viewport:{width:1280,height:800}}},
  {name:'mobile-320x568',use:{viewport:{width:320,height:568},isMobile:true,hasTouch:true,deviceScaleFactor:1}},
 ],
})
