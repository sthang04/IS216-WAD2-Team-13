import {defineConfig} from '@playwright/test'

// Both suites run the real Vue UI with isolated data. Never reuse a server whose
// environment could enable live recovery writes or invitation delivery.
export default defineConfig({
 testDir:'.',
 testMatch:['e2e-simulator/*.spec.js','e2e-invitations/**/*.spec.js'],
 outputDir:'test-results/simulator',workers:2,forbidOnly:!!process.env.CI,retries:0,
 reporter:[['list'],['json',{outputFile:'test-results/simulator/results.json'}]],
 use:{baseURL:'http://127.0.0.1:5186',browserName:'chromium',trace:'retain-on-failure',screenshot:'only-on-failure',serviceWorkers:'block'},
 webServer:{command:'pnpm dev --host 127.0.0.1 --port 5186 --strictPort',
  url:'http://127.0.0.1:5186/e2e-simulator/harness.html',
  env:{VITE_SIMULATOR_WORKFLOW_ENABLED:'false',VITE_SIMULATOR_PRODUCTION_APPROVED:'false'},
  reuseExistingServer:false,timeout:60000},
 projects:[
  ...[[1280,800],[1440,900],[1920,1080]].map(([width,height])=>({
   name:'desktop-'+width+'x'+height,
   // Node-side contracts run once; browser workflows run at every viewport.
   testMatch:width===1280?['e2e-simulator/*.spec.js','e2e-invitations/**/*.spec.js','e2e-simulator/contracts/**/*.spec.js']:undefined,
   use:{viewport:{width,height}}})),
  ...[[390,844],[375,667],[320,568]].map(([width,height])=>({
   name:'mobile-'+width+'x'+height,use:{viewport:{width,height},isMobile:true,hasTouch:true,deviceScaleFactor:1}})),
 ],
})
