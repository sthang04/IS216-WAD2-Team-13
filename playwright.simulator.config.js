import {defineConfig,devices} from '@playwright/test'
// Separate local-only harness: preserves the group's existing Playwright setup.
export default defineConfig({testDir:'./e2e-simulator',outputDir:'test-results/simulator',workers:1,reporter:'list',
 use:{baseURL:'http://127.0.0.1:5186',trace:'off'},
 webServer:{command:'npm run dev -- --host 127.0.0.1 --port 5186 --strictPort',url:'http://127.0.0.1:5186/e2e-simulator/harness.html',env:{VITE_SIMULATOR_WORKFLOW_ENABLED:'false',VITE_SIMULATOR_PRODUCTION_APPROVED:'false'},reuseExistingServer:false,timeout:60000},
 projects:[{name:'chromium',use:{...devices['Desktop Chrome']}}]})
