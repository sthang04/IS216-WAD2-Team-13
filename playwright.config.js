import {defineConfig} from '@playwright/test'
import application from './playwright.application.config.js'
import simulatorFixtures from './playwright.simulator.fixtures.config.js'
import live from './playwright.simulator.config.js'
import backend from './playwright.backend.config.js'

// One default command discovers every preserved browser suite. Lower-level tests
// remain in the repository and are intentionally excluded from browser E2E runs.
const suites=[['application',application],['simulator-fixtures',simulatorFixtures],['live',live],['backend',backend]]
export default defineConfig({
 // Contexts/data are isolated; four workers keep the full six-size matrix practical.
 workers:4,retries:0,forbidOnly:!!process.env.CI,
 metadata:live.metadata,
 testIgnore:['**/contracts/**','tests/unit/**'],
 outputDir:'test-results/all-browser',
 reporter:[['list'],['html',{outputFolder:'playwright-report/all-browser',open:'never'}],
  ['json',{outputFile:'test-results/all-browser/results.json'}]],
 webServer:suites.map(([,suite])=>suite.webServer).filter(Boolean),
 projects:suites.flatMap(([name,suite])=>suite.projects.map(project=>({
  ...project,name:name+'-'+project.name,testDir:suite.testDir,
  ...(suite.snapshotPathTemplate?{snapshotPathTemplate:suite.snapshotPathTemplate}:{}),
  // Preserve suite-local project ordering after names are prefixed in this combined run.
  ...(project.dependencies?{dependencies:project.dependencies.map(dependency=>name+'-'+dependency)}:{}),
  testMatch:project.testMatch||suite.testMatch,
  testIgnore:[...(Array.isArray(project.testIgnore)?project.testIgnore:project.testIgnore?[project.testIgnore]:[]),'**/contracts/**'],
  timeout:suite.timeout||45000,expect:suite.expect||{timeout:10000},
  use:{...suite.use,...project.use},
 }))),
})
