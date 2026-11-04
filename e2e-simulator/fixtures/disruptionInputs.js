// Test restored/programmatic parent state without weakening production controls
// or adding a test-only API to the application.
export async function setRawInterval(page, values, index=0) {
 await page.locator('.disruption-interval').nth(index).evaluate((el,values)=>{
  const component=el.__vueParentComponent
  for(const [key,value] of Object.entries(values)) component.emit('update:'+key,value)
 },values)
}
