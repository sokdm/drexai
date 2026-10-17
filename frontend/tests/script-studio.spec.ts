import { test, expect } from "@playwright/test";
const id="a11111111111111111111111";
for(const width of [390,1440])test(`script builder editing and quote approval at ${width}px`,async({page},info)=>{
 let generated=0,saves=0,logoutRequests=0;let project:any={_id:id,title:"The Hidden City",summary:"An original discovery",targetDuration:"8 minutes",scenes:[1,2,3].map(n=>({_id:`b${n}`.padEnd(24,"1"),order:n,title:`Discovery ${n}`,narration:"Original narration",dialogue:"Explorer: What is this?",sceneDescription:"Underwater ruins",imagePrompt:"An original city",videoMotionPrompt:"Slow pan",estimatedDurationSeconds:30})),versions:[],prompts:{durationEstimate:{requestedSeconds:480,estimatedSeconds:90,needsReview:true}}};
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem("theme","dark"));
 await page.route("**/api/**",async route=>{const req=route.request(),path=new URL(req.url()).pathname,method=req.method();if(method==="OPTIONS")return route.fulfill({status:204,headers:{"access-control-allow-origin":req.headers().origin||"http://localhost:5174","access-control-allow-credentials":"true","access-control-allow-headers":"content-type,x-csrf-token","access-control-allow-methods":"GET,POST,PATCH,OPTIONS"}});let data:any={}; if(path === "/api/auth/logout") logoutRequests++;
 if(path==="/api/auth/me")data={user:{id:"test",displayName:"Tester",status:"active",emailVerified:true,onboarding:{completed:true}}};
 else if(path==="/api/wallet")data={wallet:{availableCredits:1000}};
 else if(path==="/api/ai/niches")data={niches:[]};
 else if(path==="/api/ai/projects")data={projects:[project]};
 else if(path.endsWith("/scene-images"))data={assets:[]};
 else if(path.endsWith("/scenes")){saves++;project={...project,...req.postDataJSON()};data={project};}
 else if(path===`/api/ai/projects/${id}`)data={project};
 else if(path==="/api/ai/scripts/quote")data={quote:{allowed:true,credits:9}};
 else if(path==="/api/ai/scripts/generate"){generated++;data={job:{_id:"c11111111111111111111111",status:"queued",logs:[]}};}
 else if(path.includes("/scripts/jobs/"))data={job:{status:"completed",logs:[...Array.from({length:30},(_,i)=>({stage:"writing",message:`Saved scene ${i+1}. A long detailed production activity message that must wrap inside the panel without overlapping its footer.`,at:new Date().toISOString()})),{stage:"saving",message:"Script saved",at:new Date().toISOString()}]},project};
 return route.fulfill({json:data});});
 await page.setViewportSize({width,height:1000});await page.goto(`/dashboard/script-builder?projectId=${id}`);
 await expect(page.getByLabel("Project title")).toHaveValue("The Hidden City");
 await expect(page.getByText("This draft is approximately 90 seconds",{exact:false})).toBeVisible();
 await page.getByRole("button",{name:"Dialogue",exact:true}).click();await page.getByLabel("Scene 1 Dialogue",{exact:true}).fill("Explorer: We found it.");
 await page.getByRole("button",{name:"Save draft",exact:true}).click();await expect.poll(()=>saves).toBe(1);expect(project.scenes[0].dialogue).toBe("Explorer: We found it.");
 await page.getByRole("button",{name:"Prompts",exact:true}).click();await expect(page.getByLabel("Scene 1 Image prompt",{exact:true})).toBeVisible();
 await page.getByRole("button",{name:"Generate Script",exact:true}).click();await expect(page.getByRole("button",{name:"Confirm 9 credits",exact:true})).toBeVisible();expect(generated).toBe(0);
 await page.getByRole("button",{name:"Confirm 9 credits",exact:true}).click();await expect.poll(()=>generated).toBe(1);await expect(page.getByText("Script saved",{exact:true})).toBeVisible();
 const feed = page.getByRole("log", {name:"Generation activity messages"});
 await expect.poll(()=>feed.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop)).toBeLessThan(3);
 const logBox=await feed.boundingBox(), footerBox=await page.getByRole("button",{name:"Approve and continue to AI Studio"}).boundingBox();
 expect(logBox!.y+logBox!.height).toBeLessThanOrEqual(footerBox!.y);
 await feed.evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event("scroll"));});
 await expect(page.getByRole("button",{name:"Jump to latest activity"})).toBeVisible();
 await page.getByRole("button",{name:"Jump to latest activity"}).click();
 await expect.poll(()=>feed.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop)).toBeLessThan(3);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(errors).toEqual([]);
 await page.screenshot({path:info.outputPath(`script-studio-${width}.png`),fullPage:true});
 await page.getByRole("link",{name:"1,000 credits",exact:true}).click(); await expect(page).toHaveURL(/\/dashboard\/credit-wallet$/); await expect(page.getByRole("heading",{name:"Credit Wallet",exact:true})).toBeVisible(); expect(logoutRequests).toBe(0);
 await page.goto("/dashboard/wallet"); await expect(page).toHaveURL(/\/dashboard\/credit-wallet$/); await expect(page.getByRole("heading",{name:"Credit Wallet",exact:true})).toBeVisible(); expect(logoutRequests).toBe(0);
});
