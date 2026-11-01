import {defineConfig,devices} from '@playwright/test'
export default defineConfig({testDir:'./e2e-invitations',outputDir:'test-results/invitations',workers:1,reporter:'list',
 use:{baseURL:'http://127.0.0.1:5188',trace:'off'},
 webServer:{command:'npm run dev -- --host 127.0.0.1 --port 5188 --strictPort',url:'http://127.0.0.1:5188',reuseExistingServer:false,timeout:60000,
  env:{VITE_SIMULATOR_WORKFLOW_ENABLED:'false',VITE_SIMULATOR_PRODUCTION_APPROVED:'false'}},
 projects:[{name:'desktop',use:{...devices['Desktop Chrome']}},{name:'mobile',use:{...devices['iPhone 13'],defaultBrowserType:'chromium'}}]
})
