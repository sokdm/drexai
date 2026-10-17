import { test, expect } from "@playwright/test";
const id = "a11111111111111111111111";
const image = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700"><defs><linearGradient id="a" x2="1" y2="1"><stop stop-color="#243670"/><stop offset="1" stop-color="#b578ba"/></linearGradient></defs><path fill="url(#a)" d="M0 0h1200v700H0z"/><path fill="#182844" d="m0 500 200-200 250 120 200-260 230 240 320-170v470H0"/><circle cx="980" cy="150" r="80" fill="#f0cb9f"/></svg>');
for (const width of [390,1440]) test(`image studio shared canvas, billing approval and manual tools at ${width}px`, async ({page},info)=>{
 let state:any={}, generates:any[]=[], transforms:any[]=[], assets:any[]=[{_id:id,url:image,prompt:"A cinematic landscape",contentType:"image/png",metadata:{tool:"generate"}}];
 const errors:string[]=[]; page.on("pageerror",e=>errors.push(e.message));
 await page.route("**/api/**",async route=>{
  const req=route.request(),path=new URL(req.url()).pathname,method=req.method();
  if(method==="OPTIONS")return route.fulfill({status:204,headers:{"access-control-allow-origin":req.headers().origin||"http://localhost:5174","access-control-allow-credentials":"true","access-control-allow-headers":"content-type,x-csrf-token","access-control-allow-methods":"GET,POST,PUT,DELETE,OPTIONS"}});
  let data:any={};
  if(path==="/api/auth/me")data={user:{id:"test",displayName:"Studio Tester",email:"image@example.test",emailVerified:true,status:"active",onboarding:{completed:true}}};
  else if(path==="/api/wallet")data={wallet:{availableCredits:1000}};
  else if(path==="/api/images/config")data={models:[{id:"openrouter/test-image",label:"Verified test model",aspectRatios:["16:9","1:1"],resolutions:["1K"],maxImages:4,characterReference:true}],stylePresets:["Cinematic","Anime","Photoreal","Editorial"],characters:[]};
  else if(path==="/api/images/studio/state"){if(method==="PUT")state=req.postDataJSON();data={state,projects:[]};}
  else if(path==="/api/images/studio/capabilities")data={references:true};
  else if(path==="/api/images/jobs")data={jobs:[],assets};
  else if(path.endsWith("/url"))data={url:image};
  else if(path==="/api/images/quote")data={quote:{credits:5,model:"openrouter/test-image"}};
  else if(path==="/api/images/generate"){generates.push(req.postDataJSON());data={job:{status:"queued"}};}
  else if(path.endsWith("/transform")){transforms.push(req.postDataJSON());const asset={...assets[0],_id:"b11111111111111111111111",metadata:{tool:"manual"}};assets=[asset,...assets];data={asset};}
  else if(path==="/api/ai/agent/conversations")data={conversations:[]};
  return route.fulfill({json:data});
 });
 await page.addInitScript(() => localStorage.setItem("theme", "dark"));
 await page.setViewportSize({width,height:1000}); await page.goto("/dashboard/text-to-image");
 await expect(page.getByRole("heading",{name:"AI Image Studio"})).toBeVisible();
 await expect(page.getByText("1,000 credits",{exact:true})).toBeVisible();
 await page.getByRole("textbox",{name:"Prompt",exact:true}).fill("A beautiful cinematic city at sunset");
 await expect(page.getByRole("button",{name:"Generate / 5 credits",exact:true})).toBeEnabled(); expect(generates).toHaveLength(0);
 await page.getByRole("button",{name:"Generate / 5 credits",exact:true}).click(); await expect.poll(()=>generates.length).toBe(1); expect(generates[0].approvedCredits).toBe(5); expect(generates[0].requestId).toMatch(/^[a-f0-9-]{36}$/);
 await page.getByRole("button",{name:"AI Editor",exact:true}).click(); await expect(page.getByLabel("Reference image",{exact:true})).toHaveValue(id);
 await page.getByRole("button",{name:"Rotate image",exact:true}).click(); await expect.poll(()=>transforms.length).toBe(1); expect(generates).toHaveLength(1);
 await page.getByRole("button",{name:"Undo manual edit"}).click();
 await page.getByRole("button",{name:"BG Remover",exact:true}).click(); await expect(page.getByRole("button",{name:"Background removal unavailable"})).toBeDisabled();
 await page.getByRole("button",{name:"Prompt Assistant",exact:true}).click(); await expect(page.getByRole("button",{name:"New conversation"})).toBeAttached();
 await page.getByRole("button",{name:"Generate",exact:true}).click();
 await expect.poll(()=>state.prompt).toBe("A beautiful cinematic city at sunset");
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true); expect(errors).toEqual([]);
 await page.screenshot({path:info.outputPath(`image-studio-${width}.png`),fullPage:true});
});
