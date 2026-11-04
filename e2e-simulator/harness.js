// SUPPORT FILE PURPOSE: harness.js supplies shared setup or controlled data for the browser workflows.
// Keep this support code: the Playwright tests depend on consistent setup and isolated state.
// Local browser-test entry only. Production index.html never imports this file.
// Playwright replaces only the data loader with fixtures and blocks Supabase.
import {createApp,h,KeepAlive} from 'vue'
import {createRouter,createMemoryHistory,RouterView} from 'vue-router'
import SimulatorInvitationInbox from '../src/components/SimulatorInvitationInbox.vue'
import EventRiskView from '../src/views/EventRiskView.vue'
import MasterFacilityCalendarView from '../src/views/MasterFacilityCalendarView.vue'
import 'bootstrap/dist/css/bootstrap.min.css'
import '../src/style.css'
// Match main.js: calendar cards and confirmation dialogs need their real styles.
import '../src/assets/facility-calendar.css'
const router=createRouter({history:createMemoryHistory(),routes:[{path:'/',component:new URLSearchParams(window.location.search).get('panel')==='invitations'?SimulatorInvitationInbox:EventRiskView},{path:'/facilities',component:MasterFacilityCalendarView},{path:'/away',component:{render:()=>h('p','Away from simulator')}}]})
const initialEvent=new URLSearchParams(window.location.search).get('eventId')
if(initialEvent) await router.push({path:'/',query:{eventId:initialEvent}})
// Test-only navigation controls exercise routed, cached and App.vue v-show lifecycles.
window.__simRouter=router
const mode=new URLSearchParams(window.location.search).get('lifecycle')
if(mode==='pane') createApp({render:()=>h('div',[h('div',{style:{display:router.currentRoute.value.path==='/'?'':'none'}},[h(EventRiskView,{active:router.currentRoute.value.path==='/'})]),router.currentRoute.value.path!=='/'?h('p','Away from simulator'):null])}).use(router).mount('#app')
else createApp({render:()=>mode==='keepalive'?h(RouterView,null,{default:({Component})=>h(KeepAlive,null,()=>Component)}):h(RouterView)}).use(router).mount('#app')
