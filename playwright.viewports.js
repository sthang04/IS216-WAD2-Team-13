// Shared viewport matrix: all suites use these exact desktop and mobile dimensions.
export const viewports = [[1280,800],[1440,900],[1920,1080],[390,844],[375,667],[320,568]]
export function viewportProjects(prefix='') {
 return viewports.map(([width,height])=>({
  name:prefix+(width>=1024?'desktop-':'mobile-')+width+'x'+height,
  use:{viewport:{width,height},...(width<1024?{isMobile:true,hasTouch:true}:{})},
 }))
}
