import {defineConfig,mergeConfig} from 'vite'
import {fileURLToPath} from 'node:url'
import applicationConfig from '../vite.config.js'

// Keep prebundling separate from the facility/simulator/staging dev servers.
export default defineConfig(mergeConfig(applicationConfig,{
 cacheDir:fileURLToPath(new URL('../node_modules/.vite-pulse-application',import.meta.url)),
 server:{host:'127.0.0.1',port:5188,strictPort:true,open:false},
}))
