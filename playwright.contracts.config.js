import {defineConfig} from '@playwright/test'
// Optional retained function/component/source checks, using Playwright's runner.
// These do not launch a browser and are deliberately separate from test:e2e.
// They protect edge cases and safety rules, but cannot certify live database enforcement.
export default defineConfig({
 testDir:'./e2e-simulator/contracts',testMatch:'**/*.spec.js',
 workers:1,retries:0,forbidOnly:!!process.env.CI,
 outputDir:'test-results/contracts',
 reporter:[['list'],['json',{outputFile:'test-results/contracts/results.json'}]],
})
