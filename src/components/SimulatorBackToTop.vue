<script setup>
import {ref,onMounted,onUnmounted} from 'vue'
const visible=ref(false)
function update(){visible.value=window.scrollY>600}
function top(){window.scrollTo({top:0,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});document.querySelector('.simulator-page h3')?.focus({preventScroll:true})}
onMounted(()=>{update();window.addEventListener('scroll',update,{passive:true})})
onUnmounted(()=>window.removeEventListener('scroll',update))
</script>
<template><button v-if="visible" type="button" class="back-to-top btn btn-pulse-primary" aria-label="Back to top" @click="top">&#8593; <span>Back to top</span></button></template>
<style scoped>.back-to-top{position:fixed;bottom:1.25rem;right:8rem;z-index:1030;box-shadow:0 4px 18px #0002;border-radius:2rem;min-height:44px}@media(max-width:767px){.back-to-top{bottom:5rem;right:.75rem;width:44px}.back-to-top span{display:none}}</style>
