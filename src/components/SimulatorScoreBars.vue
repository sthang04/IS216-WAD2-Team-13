<script setup>
// Purpose: Render recorded score factors accessibly; unavailable evidence never becomes a fabricated numeric score.
const props=defineProps({breakdown:Object})
const factors=[['conflict','Conflict resolution'],['timetable','Timetable'],['workload','Staffing / workload'],['venue','Venue suitability']]
const valid=n=>typeof n==='number'&&Number.isFinite(n)
// Presentation-only bands: 80+ green, 50-79 amber, below 50 rose.
// These do not alter evaluator values, weights, rankings or approval eligibility.
const colour=n=>n>=80?'#2b8064':n>=50?'#aa750e':'#c73b61'
</script>
<template><div class="score-factors"><div v-for="[key,label] in factors" :key="key"><div class="factor-label"><span>{{ label }}</span><strong>{{ valid(breakdown?.[key])?breakdown[key]+'/100':'Score unavailable' }}</strong></div><div v-if="valid(breakdown?.[key])" role="meter" :aria-label="label" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="Math.max(0,Math.min(100,breakdown[key]))" class="factor-track"><span :style="{width:Math.max(0,Math.min(100,breakdown[key]))+'%',background:colour(breakdown[key])}"></span></div></div></div></template>
<style scoped>.score-factors{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.7rem 1rem}.factor-label{display:flex;justify-content:space-between;gap:.5rem;font-size:.75rem}.factor-track{height:7px;border-radius:9px;overflow:hidden;background:var(--pulse-border);margin-top:.3rem}.factor-track span{display:block;height:100%;border-radius:inherit}@media(max-width:575px){.score-factors{grid-template-columns:1fr}}</style>
