// SUPPORT FILE PURPOSE: disclosures.js supplies shared setup or controlled data for the browser workflows.
// Keep this support code: the Playwright tests depend on consistent setup and isolated state.
// Actions: expand the visualization through its native disclosure control.
export async function openTimeline(page){const panel=page.locator('#impact-timeline');if(!(await panel.evaluate(e=>e.open)))await panel.locator(':scope > summary').click()}
export async function openFacilityHeatmap(page){const panel=page.locator('#impact-facilities');if(!(await panel.evaluate(e=>e.open)))await panel.locator(':scope > summary').click()}
