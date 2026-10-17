import {test,expect} from "@playwright/test";
// Reuse the existing workspace fixtures through the end-to-end workspace suite.
test("reference stylesheet is scoped to production tools",async({page})=>{
 await page.route("**/api/**",route=>{const path=new URL(route.request().url()).pathname;let data:any={};if(path==="/api/auth/me")data={user:{id:"user",displayName:"Creator",email:"creator@example.test",status:"active",emailVerified:true,onboarding:{completed:true}}};if(path==="/api/studio/config")data={projects:[],characters:[],imageModels:[],videoModels:[],voiceModels:[],readiness:{queueEnabled:true,workerOnline:true,storageConfigured:true,providerConfigured:true}};if(path==="/api/ai/agent/conversations")data={conversations:[]};if(path==="/api/studio/asset-packs")data={packs:[],assets:[]};return route.fulfill({json:data});});
 await page.addInitScript(()=>localStorage.setItem("theme","dark"));await page.setViewportSize({width:1280,height:800});await page.goto("/dashboard/ai-studio");await expect(page.getByRole("heading",{name:"AI Production Assistant",exact:true})).toBeVisible();await expect(page.getByRole("heading",{name:"Project setup",exact:true})).toBeVisible();
 await page.screenshot({path:"frontend/test-results/reference-studio-dark.png",fullPage:true});
 await page.getByRole("button",{name:"Product Commercials",exact:true}).click();await expect(page.getByLabel("Product name",{exact:true})).toBeVisible();await page.screenshot({path:"frontend/test-results/reference-commercial-dark.png",fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
