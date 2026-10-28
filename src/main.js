import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import router from './router'
import "bootstrap/dist/css/bootstrap.min.css"
import "bootstrap/dist/js/bootstrap.bundle.min.js"
import "./assets/facility-calendar.css"
import {
  testReplacementRecommendations
} from './debug/testReplacementRecommendations.js'

if (import.meta.env.DEV) {
  testReplacementRecommendations()
}

createApp(App).use(router).mount('#app')
