import {defineConfig} from '@playwright/test'
import {loadEnv} from 'vite'
import {existsSync} from 'node:fs'

// Ordinary E2E runs the actual application with its configured Supabase client.
// Fixtures and credential-specific staging environments are never prerequisites.
const baseURL=process.env.PULSE_E2E_BASE_URL || 'http://127.0.0.1:5189'
const appEnv=loadEnv('development',process.cwd(),'VITE_')
const backendOrigin=appEnv.VITE_SUPABASE_URL ? new URL(appEnv.VITE_SUPABASE_URL.trim()).origin : null
const reportTarget=process.env.PULSE_E2E_BASE_URL?'deployed':'local'
const storageState=process.env.PULSE_E2E_STORAGE_STATE
if(storageState && !existsSync(storageState))throw Error('PULSE_E2E_STORAGE_STATE does not exist; provide a normal authenticated browser state file.')
export default defineConfig({
 // Live pagination/roster reads can span several network requests. Keep
 // automatic waiting on observable state, with a realistic network budget.
 timeout:60000,expect:{timeout:15000},
 metadata:{backendOrigin},
 testDir:'./e2e-simulator/live',workers:2,retries:0,forbidOnly:!!process.env.CI,
 outputDir:'test-results/real-backend/'+reportTarget,
 reporter:[['list'],['json',{outputFile:'test-results/real-backend/'+reportTarget+'/results.json'}],['html',{outputFolder:'playwright-report/real-backend/'+reportTarget,open:'never'}]],
 use:{baseURL,browserName:'chromium',storageState,timezoneId:'Asia/Singapore',serviceWorkers:'block',trace:'off',screenshot:'off',video:'off'},
 webServer:process.env.PULSE_E2E_BASE_URL?undefined:{command:'pnpm dev --host 127.0.0.1 --port 5189 --strictPort',url:baseURL,reuseExistingServer:false,timeout:60000},
 projects:[...[[1280,800],[1440,900],[1920,1080],[390,844],[375,667],[320,568]].map(([width,height])=>({name:(width>=1024?'desktop-':'mobile-')+width+'x'+height,use:{viewport:{width,height},...(width<1024?{isMobile:true,hasTouch:true}:{})}}))],
})
