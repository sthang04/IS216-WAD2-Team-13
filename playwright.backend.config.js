// Genuine user workflows against the dedicated staging backend: no fulfilled API responses.
// Credentials live in ignored .env.live-e2e.local and never enter browser bundles/reports.
import {defineConfig} from '@playwright/test'
import {loadEnv} from 'vite'
import {viewportProjects} from './playwright.viewports.js'
const env=loadEnv('live-e2e',process.cwd(),'')
const backend=env.VITE_SUPABASE_URL||''
if(backend&&new URL(backend).hostname!=='xbtauyiinkrxvfrqakbw.supabase.co')throw Error('Write E2E must target PULSE-Staging, never the shared PULSE backend.')
export default defineConfig({
 testDir:'./e2e-backend',testMatch:'**/*.spec.js',workers:1,retries:0,forbidOnly:!!process.env.CI,
 timeout:180000,expect:{timeout:45000},outputDir:'test-results/backend-workflows',
 reporter:[['list'],['json',{outputFile:'test-results/backend-workflows/results.json'}],['html',{outputFolder:'playwright-report/backend-workflows',open:'never'}]],
 use:{baseURL:'http://127.0.0.1:5187',browserName:'chromium',timezoneId:'Asia/Singapore',serviceWorkers:'block',actionTimeout:20000,trace:'off',screenshot:'off',video:'off'},
 webServer:{command:'pnpm dev --mode live-e2e --host 127.0.0.1 --port 5187 --strictPort',url:'http://127.0.0.1:5187',reuseExistingServer:false,timeout:60000,
  env:{VITE_SUPABASE_URL:backend,VITE_SUPABASE_ANON_KEY:env.VITE_SUPABASE_ANON_KEY||'',VITE_PULSE_DEMO_MODE:'false',VITE_SIMULATOR_WORKFLOW_ENABLED:'false',VITE_SIMULATOR_PRODUCTION_APPROVED:'false'}},
 // Each journey uses several authenticated users; serial sizes avoid Auth rate limiting.
 projects:viewportProjects('persistence-').map((project,index,all)=>({...project,workers:1,...(index?{dependencies:[all[index-1].name]}:{})})),
})
