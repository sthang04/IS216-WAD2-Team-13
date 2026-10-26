
import { createRouter, createWebHistory } from 'vue-router'


const routes = [
    {
        path:'/',
        name:'landing',
        component:()=>import('../views/LandingLoginView.vue')
    },
    {
        path:'/signup',
        name:'signup',
        component:()=>import('../views/SignUpView.vue')
   
    },
    {
        path:'/availability',
        name:'availability',
        component:()=>import('../views/AvailabilityView.vue')
        
    },
    {
        path:'/events',
        name:'events',
        component:()=>import('../views/EventRiskView.vue')
    },
    {
        path:'/facilities',
        name:'facilities',
        component:()=>import('../views/FacilitiesView.vue')
    },
    {
        path:'/operations',
        name:'operations',
        component:()=>import('../views/OperationsView.vue')
    },
    {
        path:'/admin',
        name:'admin',
        component:()=>import('../views/OslAdminView.vue')

    },
    {
        path:'/personal-schedule',
        name:'personal-schedule',
        component:()=>import('../views/PersonalScheduleView.vue')
        
    }

]


//createRouter -> creates the router and connects the URLs to Vue components
//createWebHistory ->so that Vue router can update URLs without refreshing the entire website 
//and use the back and forward buttons to navigate between pages
const router = createRouter({
  history: createWebHistory(),  
  routes
})

export default router