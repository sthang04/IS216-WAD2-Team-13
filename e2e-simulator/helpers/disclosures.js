// Actions: expand the visualization through its native disclosure control.
export async function openTimeline(page){const panel=page.locator('#impact-timeline');if(!(await panel.evaluate(e=>e.open)))await panel.locator(':scope > summary').click()}
export async function openFacilityHeatmap(page){const panel=page.locator('#impact-facilities');if(!(await panel.evaluate(e=>e.open)))await panel.locator(':scope > summary').click()}
