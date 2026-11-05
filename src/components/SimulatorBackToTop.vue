<script setup>
// Purpose: Provide keyboard-accessible section shortcuts and return-to-top navigation without changing approval progress.
import {ref,onMounted,onUnmounted} from 'vue'
const props=defineProps({sections:{type:Array,default:()=>[]},active:{type:Boolean,default:true}})
const visible=ref(false),menu=ref(null)
function update(){visible.value=window.scrollY>600}
const motion=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'
function closeMenu(focus=false){if(menu.value){menu.value.open=false;if(focus)menu.value.querySelector('summary')?.focus()}}
function top(){closeMenu();window.scrollTo({top:0,behavior:motion()});document.querySelector('.simulator-page h3')?.focus({preventScroll:true})}
function jump(event,section){
 if(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)return
 if(section.disabled){event.preventDefault();return}
 const target=document.getElementById(section.id)
 if(!target){event.preventDefault();return}
 event.preventDefault()
 // Open native disclosures before measuring the destination, without remounting
 // their controls. These links are shortcuts, never approval/progress stages.
 let node=target
 while(node){if(node.tagName==='DETAILS')node.open=true;node=node.parentElement}
 closeMenu()
 requestAnimationFrame(()=>{
  target.scrollIntoView({behavior:motion(),block:'start'})
  const focus=target.tagName==='DETAILS'?target.querySelector('summary'):target.querySelector('h3,h4,h5,h6') || target
  if(!focus.hasAttribute('tabindex'))focus.setAttribute('tabindex','-1')
  focus.focus({preventScroll:true})
 })
}
function outside(event){if(menu.value && !event.target.closest('.simulator-floating-nav'))closeMenu()}
onMounted(()=>{update();window.addEventListener('scroll',update,{passive:true});document.addEventListener('pointerdown',outside)})
onUnmounted(()=>{window.removeEventListener('scroll',update);document.removeEventListener('pointerdown',outside)})
</script>
<template>
 <nav v-if="props.active" class="simulator-floating-nav" :class="{'has-top':visible,'has-shortcuts':sections.length>0}" aria-label="Simulator section shortcuts" @keydown.esc.stop="closeMenu(true)">
  <details v-if="sections.length" ref="menu" class="section-shortcuts">
   <summary>Jump to section</summary>
   <ul><li v-for="section in sections" :key="section.id"><span v-if="section.disabled" aria-disabled="true">{{ section.label }} <small>Run simulation first</small></span><a v-else :href="'#'+section.id" @click="jump($event,section)">{{ section.label }}</a></li></ul>
  </details>
  <button v-if="visible" type="button" class="back-to-top btn btn-pulse-primary" aria-label="Back to top" @click="top"><span>Back to top</span></button>
 </nav>
</template>
<style scoped>
.simulator-floating-nav{position:fixed;bottom:1.25rem;right:8rem;z-index:1030;display:flex;align-items:stretch;gap:0;max-width:calc(100vw - 1.5rem);border:1px solid var(--pulse-border);border-radius:2rem;background:var(--pulse-card-bg,#fff);box-shadow:0 4px 18px #0002}
.simulator-floating-nav .back-to-top,.simulator-floating-nav .section-shortcuts>summary{display:inline-flex;align-items:center;justify-content:center;box-shadow:none;border:0;border-radius:2rem;min-height:44px;font-family:inherit;font-size:.8rem;font-weight:600;line-height:1.25}.section-shortcuts>summary{list-style:none}.section-shortcuts>summary::-webkit-details-marker{display:none}.section-shortcuts>summary::marker{content:""}
/* One shared pill; its dropdown is positioned from the group, not the left segment. */
.simulator-floating-nav .back-to-top{padding:.65rem .9rem;white-space:nowrap}.has-top .section-shortcuts>summary{border-radius:2rem 0 0 2rem}.has-shortcuts .back-to-top{border-radius:0 2rem 2rem 0}
.section-shortcuts{position:static;min-width:0}.section-shortcuts>summary{cursor:pointer;background:var(--pulse-card-bg,#fff);color:var(--pulse-ink);border:0;padding:.65rem .9rem;font-size:.8rem;font-weight:600;white-space:nowrap}.section-shortcuts>ul{position:absolute;bottom:calc(100% + .6rem);right:0;width:min(20rem,calc(100vw - 1.5rem));max-height:60vh;overflow-y:auto;list-style:none;margin:0;padding:.4rem;border:1px solid var(--pulse-border);border-radius:.75rem;background:var(--pulse-card-bg,#fff);box-shadow:0 6px 24px #0002}.section-shortcuts li>a,.section-shortcuts li>span{display:block;padding:.65rem .7rem;min-height:44px;color:var(--pulse-ink);text-decoration:none;font-size:.85rem;overflow-wrap:anywhere}.section-shortcuts li>a:hover{background:var(--pulse-primary-light);border-radius:.4rem}.section-shortcuts li>span{color:var(--pulse-ink-muted)}.section-shortcuts small{display:block;font-size:.7rem}a:focus-visible,button:focus-visible,summary:focus-visible{outline:2px solid var(--pulse-primary);outline-offset:3px}
:global(body:has(.recovery-dialog) .simulator-floating-nav){visibility:hidden}
@media(max-width:767px){.simulator-floating-nav{display:none!important}}
</style>
