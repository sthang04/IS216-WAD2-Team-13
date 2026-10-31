// Local browser-test entry only. Production index.html never imports this file.
// Playwright replaces only the data loader with fixtures and blocks Supabase.
import {createApp,h} from 'vue'
import {createRouter,createMemoryHistory,RouterView} from 'vue-router'
import EventRiskView from '../src/views/EventRiskView.vue'
import MasterFacilityCalendarView from '../src/views/MasterFacilityCalendarView.vue'
import 'bootstrap/dist/css/bootstrap.min.css'
import '../src/style.css'
const router=createRouter({history:createMemoryHistory(),routes:[{path:'/',component:EventRiskView},{path:'/facilities',component:MasterFacilityCalendarView}]})
createApp({render:()=>h(RouterView)}).use(router).mount('#app')
