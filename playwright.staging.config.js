import {defineConfig,devices} from '@playwright/test'
import {readFileSync} from 'node:fs'
import {stagingTestEnvironment,validateStagingStorage,LOCAL_ORIGIN} from './e2e-staging/stagingSafety.js'
// Child-process overrides take precedence over .env.local. No file is switched.
// Never reuse a server that might have been launched with production variables.
const env=stagingTestEnvironment(process.env)
validateStagingStorage(JSON.parse(readFileSync(process.env.PULSE_STAGING_STORAGE_STATE,'utf8')))
export default defineConfig({
 testDir:'./e2e-staging',testMatch:'*.spec.js',outputDir:'test-results/staging',workers:1,retries:0,reporter:'list',
 use:{baseURL:LOCAL_ORIGIN,storageState:process.env.PULSE_STAGING_STORAGE_STATE,
  trace:'off',screenshot:'off',video:'off',serviceWorkers:'block'},
 webServer:{command:'npm run dev -- --host 127.0.0.1 --port 5187 --strictPort',url:LOCAL_ORIGIN,
  env,reuseExistingServer:false,timeout:60000},
 projects:[{name:'staging-chromium',use:{...devices['Desktop Chrome']}}]
})
