<script setup>
// Purpose: Draw recorded activity dependencies, share selection with the list and support fit, zoom, pan and cascade replay.
import {computed,ref,useId,onMounted,onUnmounted,watch,nextTick} from 'vue'
import {controlRoomTime} from '../services/simulatorControlRoomService.js'
const props=defineProps({model:Object,selectedId:[String,Number],replayVersion:{type:Number,default:0}}),emit=defineEmits(['select','inspect-edge'])
const view=ref('village'),fit=ref(false),zoom=ref(1),viewport=ref(null),viewportWidth=ref(900),viewportHeight=ref(580),content=ref(null),measuredBounds=ref(null),uid=useId().replace(/:/g,'')
const assigneeText=n=>{const a=n.assignees||[];return a.length>2?a.slice(0,2).join(', ')+' +'+(a.length-2):a.join(', ')}
const label=s=>s==='direct'?'Direct impact':s==='downstream'?'Downstream risk':'No detected impact',themes=['#e97f9d','#75a7db','#e6b85b','#87bc8b','#a58bd4']
function lines(title){const result=[''];for(const word of String(title||'Untitled activity').split(/\s+/).flatMap(w=>w.match(/.{1,26}/g)||[])){if((result.at(-1)+' '+word).trim().length>26&&result.at(-1))result.push(word);else result[result.length-1]=(result.at(-1)+' '+word).trim()}return result}
const box=n=>({left:n.x-108,right:n.x+108,top:n.y-114,bottom:n.y+122+lines(n.title).length*17})
function bounds(rows){const bs=rows.map(box);return bs.length?{x:Math.min(...bs.map(b=>b.left)),y:Math.min(...bs.map(b=>b.top)),width:Math.max(...bs.map(b=>b.right))-Math.min(...bs.map(b=>b.left)),height:Math.max(...bs.map(b=>b.bottom))-Math.min(...bs.map(b=>b.top))}:{x:0,y:0,width:240,height:240}}
// Compare lane lengths against the usable viewport. Existing dependency ranks
// keep branches/convergences together; deep graphs wrap into alternating lanes.
// Independent activities occupy free positions without inventing any edges.
const nodes=computed(()=>{
 const linked=new Set(props.model.edges.flatMap(e=>[String(e.from.id),String(e.to.id)])),connected=props.model.nodes.filter(n=>linked.has(String(n.id))),independent=props.model.nodes.filter(n=>!linked.has(String(n.id)));let best=null
 for(const centered of [false,true])for(let columns=1;columns<=Math.min(8,Math.max(1,props.model.nodes.length));columns++){
  const placed=[],levels=new Map();for(const n of connected){if(!levels.has(n.level))levels.set(n.level,[]);levels.get(n.level).push(n)}let bandTop=0
  const depth=Math.max(0,...levels.keys())
  for(let first=0;first<=depth;first+=columns){const last=Math.min(depth,first+columns-1),maxRows=Math.max(1,...Array.from({length:last-first+1},(_,i)=>(levels.get(first+i)||[]).length));let bottom=bandTop
   // Reserve the longest label in this rank band; a fixed row pitch would
   // overlap unusually long recorded titles with the next branch's booth.
   const pitch=Math.max(282,...connected.filter(n=>n.level>=first&&n.level<=last).map(n=>236+lines(n.title).length*17+24))
   for(let rank=first;rank<=last;rank++){const rows=levels.get(rank)||[],col=Math.floor(first/columns)%2?columns-1-(rank-first):rank-first;rows.forEach((n,i)=>{const node={...n,x:col*254,y:bandTop+114+(i+(centered?(maxRows-rows.length)/2:0))*pitch};placed.push(node);bottom=Math.max(bottom,box(node).bottom)})}bandTop=bottom+54
  }
  for(const n of independent){let found=false;for(let row=0;!found;row++)for(let col=0;col<columns;col++){const node={...n,x:col*254,y:114+row*282+(col%2?12:0)},b=box(node);if(placed.every(other=>{const a=box(other);return b.right+24<a.left||b.left-24>a.right||b.bottom+24<a.top||b.top-24>a.bottom})){placed.push(node);found=true;break}}}
  const b=bounds(placed),scale=Math.min((viewportWidth.value-36)/b.width,(viewportHeight.value-128)/b.height);if(!best||scale>best.scale)best={placed,scale}
 }const byId=new Map((best?.placed||[]).map(n=>[String(n.id),n]));return props.model.nodes.map((n,i)=>({...byId.get(String(n.id)),theme:themes[i%5]}))
})
// Orthogonal A* routes run through corridors around full booth/label bounds.
// Routing changes geometry only: recorded endpoints and arrow direction stay exact.
/** Route a recorded dependency around complete booth and label bounds.
 * @param {object} a Source booth in graph coordinates.
 * @param {object} b Destination booth; arrow direction follows the recorded edge.
 * @param {object[]} obstacles Occupied rectangles, including long labels.
 * @returns {string} SVG path; geometry never changes cascade or dependency data.
 */
// Route a stored dependency around booth bounds; geometry does not invent or change dependency relationships.
function routeEdge(a,b,obstacles){
 const sign=b.x>a.x?1:b.x<a.x?-1:(a.x>bounds(nodes.value).x+bounds(nodes.value).width/2?1:-1),endSign=b.x===a.x?sign:-sign,start={x:a.x+sign*124,y:a.y+18},end={x:b.x+endSign*124,y:b.y+18}
 const xs=[...new Set([start.x,end.x,...obstacles.flatMap(r=>[r.left-16,r.right+16])])].sort((a,b)=>a-b),ys=[...new Set([start.y,end.y,...obstacles.flatMap(r=>[r.top-16,r.bottom+16])])].sort((a,b)=>a-b)
 const clear=(x,y,xx,yy)=>!obstacles.some(r=>x===xx?x>r.left&&x<r.right&&Math.max(y,yy)>r.top&&Math.min(y,yy)<r.bottom:y>r.top&&y<r.bottom&&Math.max(x,xx)>r.left&&Math.min(x,xx)<r.right)
 const target=xs.indexOf(end.x)+','+ys.indexOf(end.y),origin=xs.indexOf(start.x)+','+ys.indexOf(start.y),open=[{key:origin,cost:0,priority:0}],costs=new Map([[origin,0]]),previous=new Map();let found=false
 while(open.length){open.sort((a,b)=>b.priority-a.priority);const current=open.pop();if(current.key===target){found=true;break}const [i,j]=current.key.split(',').map(Number);for(const [ii,jj] of [[i-1,j],[i+1,j],[i,j-1],[i,j+1]]){if(ii<0||ii>=xs.length||jj<0||jj>=ys.length||!clear(xs[i],ys[j],xs[ii],ys[jj]))continue;const key=ii+','+jj,cost=current.cost+Math.abs(xs[ii]-xs[i])+Math.abs(ys[jj]-ys[j]);if(cost>=(costs.get(key)??Infinity))continue;costs.set(key,cost);previous.set(key,current.key);open.push({key,cost,priority:cost+Math.abs(xs[ii]-end.x)+Math.abs(ys[jj]-end.y)})}}
 const points=[];if(found){let key=target;while(key){const [i,j]=key.split(',').map(Number);points.unshift([xs[i],ys[j]]);key=previous.get(key)}}else points.push([start.x,start.y],[end.x,end.y])
 return 'M '+(a.x+sign*80)+' '+(a.y+18)+' '+points.map(p=>'L '+p.join(' ')).join(' ')+' L '+(b.x+endSign*83)+' '+(b.y+18)
}
const edges=computed(()=>{const byId=new Map(nodes.value.map(n=>[String(n.id),n])),obstacles=nodes.value.map(box);return props.model.edges.map(e=>{const from=byId.get(String(e.from.id)),to=byId.get(String(e.to.id));return {from,to,d:routeEdge(from,to,obstacles)}})})
function measureContent(){if(content.value&&nodes.value.length){const b=content.value.getBBox();measuredBounds.value={x:b.x-12,y:b.y-12,width:b.width+24,height:b.height+24}}}
watch(nodes,()=>{measuredBounds.value=null;nextTick(measureContent)},{flush:'post'})
const graphBounds=computed(()=>measuredBounds.value||bounds(nodes.value)),sky=64,footer=64
// Fixed scenery bands are excluded from getBBox. A screen-sized viewBox avoids
// letterboxing; this explicit transform centres actual graph bounds in the field.
const fitScale=computed(()=>Math.min(1.6,(viewportWidth.value-36)/graphBounds.value.width,(viewportHeight.value-sky-footer)/graphBounds.value.height))
const scene=computed(()=>fit.value?{x:0,y:0,width:viewportWidth.value,height:viewportHeight.value}:{x:0,y:0,width:Math.max(viewportWidth.value+180,graphBounds.value.width+80),height:Math.max(viewportHeight.value+180,graphBounds.value.height+sky+footer+40)})
const graphOffset=computed(()=>{const b=graphBounds.value,k=fit.value?fitScale.value:1;return fit.value?{x:viewportWidth.value/2-(b.x+b.width/2)*k,y:sky+(viewportHeight.value-sky-footer)/2-(b.y+b.height/2)*k}:{x:(scene.value.width-b.width)/2-b.x,y:sky+20-b.y}})
const graphTransform=computed(()=>'translate('+graphOffset.value.x+' '+graphOffset.value.y+') scale('+(fit.value?fitScale.value:1)+')'),minimumZoom=computed(()=>Math.min(.25,fitScale.value/4)),zoomPercent=computed(()=>Math.round((fit.value?fitScale.value:zoom.value)*1000)/10)
function centerOnActivity(id=props.selectedId){const n=nodes.value.find(n=>String(n.id)===String(id))||nodes.value[0];if(n&&viewport.value){viewport.value.scrollLeft=(n.x+graphOffset.value.x)*zoom.value-viewportWidth.value/2;viewport.value.scrollTop=(n.y+20+graphOffset.value.y)*zoom.value-viewportHeight.value/2}}
function setMode(mode){fit.value=mode==='fit';if(!fit.value)zoom.value=1;nextTick(()=>{if(fit.value){viewport.value.scrollLeft=0;viewport.value.scrollTop=0}else centerOnActivity()})}
// Keep the viewport centre stable during manual zoom. Leaving Fit changes
// coordinate systems, so first centre the selected booth in the explore scene.
function adjustZoom(delta){const current=fit.value?fitScale.value:zoom.value,wasFit=fit.value,center={x:(viewport.value.scrollLeft+viewportWidth.value/2)/current,y:(viewport.value.scrollTop+viewportHeight.value/2)/current};zoom.value=Math.max(minimumZoom.value,Math.min(2,current*(delta>0?1.15:1/1.15)));fit.value=false;nextTick(()=>{if(wasFit)centerOnActivity();else{viewport.value.scrollLeft=center.x*zoom.value-viewportWidth.value/2;viewport.value.scrollTop=center.y*zoom.value-viewportHeight.value/2}})}
function focusActivity(id){view.value='village';nextTick(()=>{if(!fit.value)centerOnActivity(id);[...viewport.value.querySelectorAll('[data-activity-id]')].find(n=>n.dataset.activityId===String(id))?.focus({preventScroll:true})})}
let resizeObserver
onMounted(()=>{resizeObserver=new ResizeObserver(entries=>{const r=entries[0].contentRect;if(r.width>0&&r.height>0){viewportWidth.value=r.width;viewportHeight.value=r.height}});resizeObserver.observe(viewport.value);nextTick(()=>{measureContent();centerOnActivity()})})
onUnmounted(()=>resizeObserver?.disconnect())
defineExpose({focusActivity})
</script>
<template>
 <div class="event-village">
  <div class="village-toolbar"><div role="group" aria-label="Activity display"><button type="button" class="btn btn-sm btn-pulse-outline" :aria-pressed="view==='village'" @click="view='village'">Village</button><button type="button" class="btn btn-sm btn-pulse-outline" :aria-pressed="view==='list'" @click="view='list'">Activity List</button></div><div v-if="view==='village'" class="village-map-controls" role="group" aria-label="Map controls"><button type="button" class="btn btn-sm btn-pulse-outline" aria-label="Zoom out" :disabled="!fit && zoom<=minimumZoom" @click="adjustZoom(-1)">-</button><output aria-label="Map zoom percentage">{{ zoomPercent }}%</output><button type="button" class="btn btn-sm btn-pulse-outline" aria-label="Zoom in" :disabled="!fit && zoom>=2" @click="adjustZoom(1)">+</button><button type="button" class="btn btn-sm btn-pulse-outline" :aria-pressed="fit" @click="setMode(fit?'explore':'fit')">{{ fit?'Explore map':'Fit whole map' }}</button></div></div>
  <div ref="viewport" v-show="view==='village'" class="village-scroll sim-graph-scroll" :class="{fit}" tabindex="0" role="region" aria-label="Scrollable Event Village">
   <svg :viewBox="[scene.x,scene.y,scene.width,scene.height].join(' ')" preserveAspectRatio="xMidYMid meet" :style="{width:fit?'100%':scene.width*zoom+'px',height:fit?'100%':scene.height*zoom+'px'}" class="village-map" role="group" aria-label="Activity dependencies">
    <defs><marker :id="uid+'arrow'" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="7" markerHeight="7" orient="auto"><path d="M1 1 L11 6 L1 11 Z" fill="#607689"/></marker><pattern :id="uid+'grass'" width="120" height="100" patternUnits="userSpaceOnUse"><path d="M18 55 q3 -8 5 0 M80 25 q3 -7 5 0" stroke="#b8d6a7" fill="none"/><circle cx="48" cy="74" r="2" fill="#f5c4cc"/><circle cx="101" cy="46" r="2" fill="#f9e3a1"/></pattern></defs>
    <rect :x="scene.x" :y="scene.y" :width="scene.width" :height="scene.height" fill="#dceecb"/><rect :x="scene.x" :y="scene.y" :width="scene.width" :height="64" fill="#e6f5fc"/><rect :x="scene.x" :y="scene.y+64" :width="scene.width" :height="scene.height-64" :fill="'url(#'+uid+'grass)'"/>
    <g aria-hidden="true"><circle :cx="scene.x+scene.width-70" :cy="scene.y+31" r="18" fill="#ffedaf"/><g v-for="x in [scene.x+70,scene.x+scene.width*.4,scene.x+scene.width*.7]" :key="x" :transform="'translate('+x+' '+(scene.y+29)+')'" fill="white"><ellipse rx="38" ry="12"/><circle cy="-8" r="15"/></g><g v-for="x in [scene.x+28,scene.x+scene.width-28]" :key="x" :transform="'translate('+x+' '+(scene.y+scene.height-36)+')'"><rect x="-5" width="10" height="35" rx="4" fill="#ac876a"/><circle cy="-8" r="23" fill="#93c8a0"/></g></g>
    <g :transform="graphTransform" data-testid="village-graph-transform"><g ref="content" data-testid="village-graph-content">
    <g v-for="(edge,i) in edges" :key="i+':'+replayVersion" class="village-path" role="button" tabindex="0" :aria-label="'Dependency: '+edge.from.title+' to '+edge.to.title" @click="emit('inspect-edge',edge)" @keydown.enter.prevent="emit('inspect-edge',edge)" @keydown.space.prevent="emit('inspect-edge',edge)" :data-from="edge.from.id" :data-to="edge.to.id"><path :d="edge.d" stroke="#d6bc91" stroke-width="16"/><path :d="edge.d" stroke="#fff8e6" stroke-width="12"/><path :d="edge.d" stroke="#607689" stroke-width="2.5" :marker-end="'url(#'+uid+'arrow)'"/></g>
    <g role="group" aria-label="Activity booths">
    <g v-for="node in nodes" :key="String(node.id)+':'+replayVersion" class="village-node sim-graph-node" :data-activity-id="node.id" :class="[node.status,{selected:String(selectedId)===String(node.id)}]" :style="{animationDelay:(node.level*180)+'ms'}" :transform="'translate('+node.x+' '+node.y+')'" role="button" tabindex="0" :aria-label="node.title+': '+label(node.status)" :aria-pressed="String(selectedId)===String(node.id)" @click="emit('select',node)" @keydown.enter.prevent="emit('select',node)" @keydown.space.prevent="emit('select',node)">
     <title>{{ node.title }} &middot; {{ controlRoomTime(node.simulated.starts_at) }}&ndash;{{ controlRoomTime(node.simulated.ends_at) }}</title>
     <ellipse class="impact-ground" cy="70" rx="83" ry="23"/><ellipse class="selection" cy="70" rx="92" ry="31"/>
     <g class="booth"><rect x="-55" y="-19" width="110" height="86" rx="8" fill="#fffaf3" stroke="#8b9ba4" stroke-width="2"/><rect x="-61" y="20" width="122" height="47" rx="5" fill="#e8cbaa" stroke="#8b9ba4" stroke-width="2"/><rect x="-48" y="26" width="96" height="31" rx="5" fill="#fff9ee"/><rect x="-54" y="-25" width="108" height="20" :fill="node.theme"/><path v-for="i in 6" :key="i" :d="'M'+(-54+(i-1)*18)+' -25 h9 l8 20 h-18 Z'" :fill="i%2?'#fff9f2':node.theme"/><path v-for="i in 6" :key="'a'+i" :d="'M'+(-54+(i-1)*18)+' -5 q9 17 18 0'" :fill="i%2?'#fff9f2':node.theme" stroke="#b9a7a0" stroke-width=".8"/><path d="M-62 -28 L0 -65 L62 -28 Z" :fill="node.theme" stroke="#8798a5" stroke-width="2"/><rect x="-26" y="-52" width="52" height="20" rx="5" fill="#fffaf4"/><text y="-37" text-anchor="middle" fill="#8b6578" font-size="17">&#10022;</text><rect x="-16" y="34" width="32" height="25" rx="5" :fill="node.theme"/></g>
     <rect class="impact-pill" x="-83" y="-105" width="166" height="26" rx="13"/><text y="-87" text-anchor="middle" class="status-text">{{ label(node.status) }}</text>
     <text text-anchor="middle" class="activity-name"><tspan v-for="(line,i) in lines(node.title)" :key="i" x="0" :y="103+i*17">{{ line }}</tspan></text><text :y="112+lines(node.title).length*17" text-anchor="middle" class="activity-time">{{ controlRoomTime(node.simulated.starts_at) }}<template v-if="assigneeText(node)"> &middot; {{ assigneeText(node) }}</template></text>
    </g>
    </g></g></g>
    <!-- Reuse the reference's tabby, grey patches and shared yarn/paws as
         decorative SVG only. Keep this group outside measured graph bounds. -->
    <g data-testid="village-cats" :transform="'translate('+(scene.width-184)+' '+(scene.height-43)+') scale(.68)'" aria-hidden="true">
     <path d="M29 51 Q44 40 55 52 Q65 63 74 50" fill="none" stroke="#b68fb5" stroke-width="2.3" stroke-linecap="round"/>
     <circle cx="48" cy="47" r="12" fill="#d9a9cf" stroke="#ae83a9" stroke-width="1.5"/>
     <path d="M40 43 Q51 37 56 51 M40 50 Q50 57 57 43" fill="none" stroke="#f8e4f4" stroke-width="2" stroke-linecap="round"/>
     <g v-for="(cat,i) in [{coat:'#f6bd78',patch:'#dc8d4d'},{coat:'#fffdf8',patch:'#a4adb7'}]" :key="cat.coat" :transform="'translate('+(i*100)+' 0) scale(.91)'">
      <ellipse cy="46" rx="38" ry="8" fill="#87b68b" opacity=".25"/>
      <path d="M-20 19 Q-27 7 -20 -11 L-12 -25 L0 -14 Q12 -18 24 -12 L38 -26 L43 -7 Q46 12 32 25 Q42 47 8 48 Q-22 49 -20 19Z" :fill="cat.coat" stroke="#9b9a93" stroke-width="1.6" stroke-linejoin="round"/>
      <template v-if="i===0"><path d="M4 -13 l5 12 M-8 -9 l4 9 M22 -10 l-4 10 M-19 11 l8 3 M32 12 l-8 3" :stroke="cat.patch" stroke-width="3.4" stroke-linecap="round"/><path d="M-15 27 q7 6 13 0 M18 28 q7 6 13 0" :stroke="cat.patch" stroke-width="3" fill="none"/></template>
      <template v-else><path d="M-20 0 Q-14 -12 0 -14 L-12 -25 L-20 -11Z" :fill="cat.patch"/><path d="M18 -14 L38 -26 L43 -7 L32 5 Q28 -5 18 -14Z" :fill="cat.patch"/><ellipse cx="26" cy="26" rx="11" ry="15" :fill="cat.patch" opacity=".9"/></template>
      <path d="M-12 17 Q-4 11 2 17 M15 17 Q22 11 29 17" fill="none" stroke="#354453" stroke-width="2.6" stroke-linecap="round"/>
      <path d="M5 24 l5 3 l5 -3Z" fill="#dc8e98"/><path d="M10 27 q-5 7 -10 1 M10 27 q5 7 10 1" fill="none" stroke="#6c6e72" stroke-width="1.5"/>
      <template v-for="side in [-1,1]" :key="side"><path v-for="j in [0,1]" :key="j" :d="'M'+(10+side*5)+' '+(29+j*3)+' l'+(side*24)+' '+(j?4:-3)" stroke="#8e9290" stroke-width="1" opacity=".7"/></template>
      <path d="M33 38 Q67 42 57 6 Q53 -4 47 7" fill="none" :stroke="cat.patch" stroke-width="9" stroke-linecap="round"/>
      <path d="M-13 -11 l3 -7 l6 6 M28 -13 l8 -7 l2 11" fill="#f2a7ae" opacity=".6"/>
     </g>
     <g v-for="paw in [{x:22,flip:1,coat:'#f6bd78'},{x:78,flip:-1,coat:'#fffdf8'}]" :key="paw.x"><path :d="'M'+paw.x+' 26 q'+(paw.flip*14)+' 3 '+(paw.flip*20)+' 14'" fill="none" :stroke="paw.coat" stroke-width="9" stroke-linecap="round"/><circle :cx="paw.x+paw.flip*20" cy="40" r="5" :fill="paw.coat" stroke="#9b9a93" stroke-width="1"/></g>
    </g>
   </svg>
  </div>
  <p v-if="view==='village'" class="small text-muted mt-2 mb-0">{{ fit && fitScale<.8?'Overview scale. Explore map for readable labels.':fit?'Whole map':'Scroll or swipe to explore.' }}</p>
  <div v-show="view==='list'" class="village-list" role="group" aria-label="Activity List"><button v-for="node in nodes" :key="node.id" type="button" :class="node.status" :aria-pressed="String(selectedId)===String(node.id)" @click="emit('select',node)"><span><strong>{{ node.title }}</strong><small>{{ controlRoomTime(node.simulated.starts_at) }}&ndash;{{ controlRoomTime(node.simulated.ends_at) }}<template v-if="assigneeText(node)"> &middot; {{ assigneeText(node) }}</template></small></span><span>{{ label(node.status) }}</span></button></div>
 </div>
</template>
<style scoped>
.village-toolbar{display:flex;flex-wrap:wrap;justify-content:space-between;gap:.5rem;margin:.75rem 0}.village-toolbar>div{display:flex;gap:.4rem}.village-scroll{height:580px;max-height:75vh;overflow:auto;border:1px solid #c4deb7;border-radius:1rem;background:#dceecb;touch-action:pan-x pan-y;overscroll-behavior:contain}.village-map{display:block;max-width:none;height:auto}.village-path path{fill:none;stroke-linecap:round}.village-node{cursor:pointer;outline:none}.village-node .impact-ground,.village-node .impact-pill{fill:#eaf4fb;stroke:#83b6d2;stroke-width:2}.village-node.direct .impact-ground,.village-node.direct .impact-pill{fill:#fff0f3;stroke:#ee5c7b}.village-node.downstream .impact-ground,.village-node.downstream .impact-pill{fill:#fff1c7;stroke:#d4a138}.selection{fill:none;stroke:#e11d48;stroke-width:3;stroke-dasharray:5 6;opacity:0}.selected .selection,.village-node:focus-visible .selection{opacity:1}.status-text{font-size:11px;font-weight:750;fill:#394657}.activity-name{font-size:14px;font-weight:750;fill:#29384b;paint-order:stroke;stroke:#dceecb;stroke-width:3px;stroke-linejoin:round}.activity-time{font-size:11px;fill:#4d6070}.booth{transition:transform .2s}.village-node:hover .booth{transform:translateY(-5px)}.village-list button{width:100%;display:flex;justify-content:space-between;gap:1rem;padding:.8rem;text-align:left;background:var(--pulse-card-bg);color:var(--pulse-ink);border:0;border-bottom:1px solid var(--pulse-border)}.village-list small{display:block;color:var(--pulse-ink-muted)}.village-list button[aria-pressed=true]{box-shadow:inset 3px 0 var(--pulse-primary);background:var(--pulse-primary-light)}button:focus-visible{outline:2px solid var(--pulse-primary);outline-offset:2px}@media(max-width:767px){.village-scroll{height:480px}.village-list button{flex-wrap:wrap}.village-toolbar button{min-height:44px}}@media(prefers-reduced-motion:reduce){.booth{transition:none}}
.village-node.direct,.village-node.downstream{animation:impact-cascade .65s ease-out both}@keyframes impact-cascade{from{opacity:.35}to{opacity:1}}@media(prefers-reduced-motion:reduce){.village-node{animation:none!important}}
.village-toolbar button[aria-pressed=true]{background:var(--pulse-primary);border-color:var(--pulse-primary);color:white}
.village-zoom{display:flex;align-items:center;gap:.5rem}.village-zoom output{min-width:3.5rem;text-align:center;font-size:.8rem}.village-node.direct .impact-ground,.village-node.downstream .impact-ground{animation:replay-highlight .9s ease-out both}@keyframes replay-highlight{0%,45%{stroke-width:6;filter:drop-shadow(0 0 8px #e11d4870)}100%{stroke-width:2;filter:none}}@media(prefers-reduced-motion:reduce){.impact-ground{animation:none!important}}
.village-scroll.fit{height:580px;max-height:75vh;overflow:hidden}.village-map{flex-shrink:0}.village-path{cursor:pointer;outline:none}.village-path:focus-visible path:last-child{stroke:var(--pulse-primary);stroke-width:5}@media(max-width:767px){.village-scroll.fit{height:480px}}
.village-toolbar{align-items:center}.village-map-controls{margin-left:auto;justify-content:flex-end;align-items:center;flex-wrap:wrap}.village-map-controls output{min-width:3rem;text-align:center;font-size:.75rem}.village-toolbar button[aria-pressed=true]{background:var(--pulse-primary-light);color:var(--pulse-primary)}@media(max-width:575px){.village-map-controls{width:100%;gap:.3rem}.village-map-controls button{padding:.4rem .5rem;font-size:.7rem}}
</style>
