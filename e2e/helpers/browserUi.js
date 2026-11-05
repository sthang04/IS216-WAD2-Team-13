// Shared browser UI audit for every exercised state. Tests still follow Setup -> Actions -> Assert.
// Scrollable tables/timelines may be wider internally; the page and ordinary controls must fit.
import {test as base,expect} from '@playwright/test'
// Inspect actual rendered text ranges, rather than assuming a visible box means
// its text fits. Native editable fields scroll their values; explicit ellipsis /
// line clamping and content inside scrollports are intentional presentation.
export async function findTextClipping(root){
 return root.evaluate(container=>{
  const issues=[],walker=document.createTreeWalker(container,NodeFilter.SHOW_TEXT)
  const visible=e=>e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})&&!e.closest('svg,.visually-hidden,.sr-only,script,style,option')
  let node
  while(node=walker.nextNode()){
   if(!node.textContent.trim()||!visible(node.parentElement))continue
   const element=node.parentElement,style=getComputedStyle(element)
   if(element.closest('input,textarea,select')||style.textOverflow==='ellipsis'||Number(style.webkitLineClamp)>0)continue
   const range=document.createRange();range.selectNodeContents(node)
   for(const box of range.getClientRects()){
    // Off-screen document/scrollport content is allowed; inspect what the user can see.
    if(box.width<1||box.height<1||box.right<=0||box.left>=innerWidth||box.bottom<=0||box.top>=innerHeight)continue
    for(let parent=element;parent&&parent!==document.documentElement;parent=parent.parentElement){
     const css=getComputedStyle(parent),bounds=parent.getBoundingClientRect()
     if(css.textOverflow==='ellipsis'||Number(css.webkitLineClamp)>0)break
     if(/auto|scroll/.test(css.overflowX+' '+css.overflowY))break
     const left=bounds.left+parent.clientLeft,top=bounds.top+parent.clientTop
     const clippedX=/hidden|clip/.test(css.overflowX)&&(box.left<left-1||box.right>left+parent.clientWidth+1)
     const clippedY=/hidden|clip/.test(css.overflowY)&&(box.top<top-1||box.bottom>top+parent.clientHeight+1)
     if(clippedX||clippedY){issues.push(node.textContent.trim().slice(0,100)+' is clipped by '+parent.tagName.toLowerCase()+'.'+parent.className);break}
    }
   }
  }
  return [...new Set(issues)].slice(0,12)
 })
}

// Compare peer controls: nested icons/labels, menus layered over the page, and
// fixed navigation covering scrollable content are not sibling-control collisions.
// Real clicks and assertControlUsable additionally check that overlays do not block actions.
export async function findElementOverlaps(root){
 return root.evaluate(container=>{
  const controls=[...container.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea')].filter(e=>
   !e.closest('svg,.visually-hidden,.sr-only')&&e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}))
  const issues=[],name=e=>(e.getAttribute('aria-label')||e.textContent||e.id||e.tagName).trim().slice(0,70)
  for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++){
   const a=controls[i],b=controls[j]
   if(a.parentElement!==b.parentElement||a.contains(b)||b.contains(a))continue
   const x=a.getBoundingClientRect(),y=b.getBoundingClientRect()
   // A password/clear button may sit in an input's reserved padding, but
   // must not cover the editable content area. Do not exempt arbitrary overlaps.
   const field=a.matches('input')?a:b.matches('input')?b:null,adornment=field===a?b:a
   if(field&&adornment.matches('button')&&getComputedStyle(adornment).position==='absolute'){
    const f=field.getBoundingClientRect(),d=adornment.getBoundingClientRect(),css=getComputedStyle(field)
    if(d.left>=f.right-parseFloat(css.paddingRight)-1||d.right<=f.left+parseFloat(css.paddingLeft)+1)continue
   }
   if(x.width<2||x.height<2||y.width<2||y.height<2)continue
   const w=Math.min(x.right,y.right,innerWidth)-Math.max(x.left,y.left,0)
   const h=Math.min(x.bottom,y.bottom,innerHeight)-Math.max(x.top,y.top,0)
   // Ignore the one-pixel shared borders used by input/button groups.
   if(w>2&&h>2)issues.push(name(a)+' overlaps '+name(b))
  }
  return issues.slice(0,12)
 })
}
export async function assertTextNotClipped(page,root=page.locator('body')){
 await expect.poll(()=>findTextClipping(root),{message:'Rendered text is not accidentally clipped by a hidden/clip container'}).toEqual([])
}
export async function assertElementsNotOverlapping(page,root=page.locator('body')){
 await expect.poll(()=>findElementOverlaps(root),{message:'Visible peer controls do not overlap'}).toEqual([])
}

export async function assertPageLayout(page){
 await expect.poll(()=>page.evaluate(()=>{
  const width=innerWidth,issues=[]
  if(Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)>width+1)issues.push('Page has horizontal overflow')
  for(const element of document.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea,[role=dialog],.modal-content,.pf-notification-panel')){
   if(element.closest('svg')||element.closest('.visually-hidden,.sr-only'))continue
   if(!element.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}))continue
   const box=element.getBoundingClientRect()
   if(box.width<=1||box.height<=1||box.x>=-1&&box.right<=width+1)continue
   // Local horizontal scrolling is intentional for tables, heatmaps and timelines.
   let scrollable=false
   for(let parent=element.parentElement;parent&&parent!==document.body;parent=parent.parentElement){
    if(/auto|scroll/.test(getComputedStyle(parent).overflowX)&&parent.scrollWidth>parent.clientWidth+1){scrollable=true;break}
   }
   if(!scrollable)issues.push((element.getAttribute('aria-label')||element.textContent||element.tagName).trim().slice(0,90)+' extends outside the screen')
  }
  return issues.slice(0,12)
 }),{message:'The exercised UI state has no clipped horizontal controls or page overflow'}).toEqual([])
 await assertTextNotClipped(page)
 await assertElementsNotOverlapping(page)
}
export async function assertBoxOnScreen(page,locator,label){
 await expect(locator).toBeVisible()
 await expect.poll(async()=>{
  const box=await locator.boundingBox(),size=page.viewportSize()
  return !!box&&box.x>=-1&&box.y>=-1&&box.x+box.width<=size.width+1&&box.y+box.height<=size.height+1
 },{message:label+' fits completely inside the screen'}).toBe(true)
}
export async function assertControlUsable(page,locator,label){
 await locator.scrollIntoViewIfNeeded()
 await assertBoxOnScreen(page,locator,label)
 await assertTextNotClipped(page,locator)
 await expect.poll(()=>locator.evaluate(element=>{
  const box=element.getBoundingClientRect(),hit=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2)
  return !!hit&&(hit===element||element.contains(hit))
 }),{message:label+' is reachable without another layer covering it'}).toBe(true)
}
export const test=base.extend({
 uiLayoutAudit:[async({page},use,info)=>{
  await use()
  // Preserve the original failure if the workflow failed; audit successful states only.
  if(!page.isClosed()&&info.status===info.expectedStatus)await assertPageLayout(page)
 },{auto:true}]
})
export {expect}

// Use real browser pointer input for notification swipe gestures. CDP supplies
// touch movement on Chromium; desktop uses the normal mouse, with no DOM service calls.
export async function swipeLeft(page,locator,touch){
 await locator.scrollIntoViewIfNeeded()
 const box=await locator.boundingBox(),start=box.x+box.width-16,end=box.x+16,y=box.y+box.height/2
 if(touch){
  const session=await page.context().newCDPSession(page)
  try{
   await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:start,y,id:0}]})
   for(let step=1;step<=8;step++)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start+(end-start)*step/8,y,id:0}]})
   await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
  }finally{await session.detach()}
 }else{
  await page.mouse.move(start,y);await page.mouse.down()
  await page.mouse.move(end,y,{steps:8});await page.mouse.up()
 }
}

// Readability is distinct from clipping: text may fit its box yet split words.
// Use rendered text-line positions so a wrapped status cannot pass on visibility alone.
export async function assertSingleLineText(locator,label){
 await expect(locator).toBeVisible()
 await expect.poll(()=>locator.evaluate(element=>{
  const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT),tops=[];let node
  while(node=walker.nextNode()){
   if(!node.textContent.trim())continue
   const range=document.createRange();range.selectNodeContents(node)
   for(const box of range.getClientRects())if(box.width>0&&box.height>0&&!tops.some(top=>Math.abs(top-box.top)<1))tops.push(box.top)
  }
  return tops.length
 }),{message:label+' stays on one readable line'}).toBe(1)
}
