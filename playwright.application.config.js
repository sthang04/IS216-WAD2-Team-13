import {defineConfig} from '@playwright/test'

// Test-only server: no real credentials, workflow activation, or server reuse.
export default defineConfig({
 testDir:'./e2e-application',testMatch:'**/*.spec.js',workers:1,retries:0,
 forbidOnly:!!process.env.CI,reporter:[['list'],['json',{outputFile:'test-results/application/results.json'}]],outputDir:'test-results/application',
 use:{baseURL:'http://127.0.0.1:5188',browserName:'chromium',serviceWorkers:'block',
  timezoneId:'Asia/Singapore',trace:'retain-on-failure',screenshot:'only-on-failure'},
 webServer:{command:'pnpm dev --config e2e-application/vite.config.js --host 127.0.0.1 --port 5188 --strictPort',
  url:'http://127.0.0.1:5188',reuseExistingServer:false,timeout:60000,
  env:{VITE_SUPABASE_URL:'',VITE_SUPABASE_ANON_KEY:'',VITE_TELEGRAM_BOT_USERNAME:'pulse_fixture_bot',
   VITE_SIMULATOR_WORKFLOW_ENABLED:'false',VITE_SIMULATOR_PRODUCTION_APPROVED:'false'}},
 projects:[
  {name:'foundation-desktop',testIgnore:'**/*.mobile.spec.js',use:{viewport:{width:1280,height:800}}},
  ...[[390,844],[320,568]].map(([width,height])=>({
   name:'foundation-mobile-'+width,testMatch:'**/*.mobile.spec.js',
   use:{viewport:{width,height},isMobile:true,hasTouch:true}})),
 ],
})


