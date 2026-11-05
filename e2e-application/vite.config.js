// SUPPORT FILE PURPOSE: vite.config.js supplies shared setup or controlled data for the browser workflows.
// Keep this support code: the Playwright tests depend on consistent setup and isolated state.
import {defineConfig,mergeConfig} from 'vite'
import {fileURLToPath} from 'node:url'
import applicationConfig from '../vite.config.js'

// Keep prebundling separate from the facility/simulator/staging dev servers.
export default defineConfig(mergeConfig(applicationConfig,{
 cacheDir:fileURLToPath(new URL('../node_modules/.vite-pulse-application',import.meta.url)),
 server:{host:'127.0.0.1',port:5188,strictPort:true,open:false},
}))
