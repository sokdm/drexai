import {test,expect} from "@playwright/test";
for(const width of [390,1440])test(`story tool approval saves three scenes into the Studio storyboard at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:950});let completed=false,approvals=0,lookups=0;
 const taskId="a11111111111111111111111",projectId="b11111111111111111111111",productionId="c11111111111111111111111";
 const scenes=[1,2,3].map(n=>({_id:String(n).repeat(24),order:n,title:`Saved scene ${n}`,narration:"Real saved script fixture",imagePrompt:"Original visual",videoMotionPrompt:"Camera follows",estimatedDurationSeconds:30}));
 const project={_id:projectId,title:"Ocean story",targetDuration:"90 seconds",scenes};
 const task=()=>({_id:taskId,status:completed?"completed":"awaiting_approval",input:{settings:{sceneCount:3,targetDuration:"90 seconds"}},quote:{credits:1},events:[{tool:"script_builder",message:completed?"Saved all three scenes":"Waiting for creation approval"}]});
 const production={_id:productionId,projectId,title:project.title,status:"draft",settings:{},snapshot:{scenes,characters:[]},steps:[],estimate:{credits:6,missingPricing:[]},timeline:[],expiresAt:new Date(Date.now()+600000).toISOString()};
 await page.route("**/api/**",route=>{const path=new URL(route.request().url()).pathname;let data:any={};
 if(path.includes("lookup"))lookups++;
 if(path==="/api/auth/me")data={user:{id:"fixture",displayName:"Creator",status:"active",emailVerified:true,onboarding:{completed:true}}};
 if(path==="/api/wallet")data={wallet:{availableCredits:completed?271:272}};
 if(path==="/api/studio/config")data={projects:[],characters:[],imageModels:[],videoModels:[],voiceModels:[],readiness:{queueEnabled:true,workerOnline:true,storageConfigured:true,providerConfigured:true}};
 if(path==="/api/studio/productions")data={productions:[]};
 if(path==="/api/ai/agent/conversations")data={conversations:[]};
 if(path==="/api/ai/agent/limits")data={remaining:20,resetsAt:new Date(Date.now()+14400000).toISOString()};
 if(path==="/api/ai/agent/quote")data={quote:{allowed:true,credits:0,toolRequest:true}};
 if(path==="/api/ai/agent/chat"){expect(route.request().postDataJSON().workspace).toBe("production");return route.fulfill({contentType:"text/event-stream",body:`event: conversation\ndata: {"id":"d11111111111111111111111"}\n\nevent: task\ndata: ${JSON.stringify({task:task()})}\n\nevent: delta\ndata: {"text":"Approve the script creation tool below."}\n\nevent: done\ndata: {}\n\n`});}
 if(path===`/api/ai/agent/tasks/${taskId}/approve`){approvals++;expect(route.request().postDataJSON().approvedCredits).toBe(1);completed=true;data={task:task()};}
 if(path===`/api/ai/agent/tasks/${taskId}`)data={task:task(),job:{logs:[]},project:completed?project:null,production:completed?production:null};
 if(path===`/api/studio/productions/${productionId}`)data={production,assets:[],events:[],exports:[]};
 if(path.endsWith("/events"))return route.fulfill({contentType:"text/event-stream",body:": heartbeat\n\n"});
 return route.fulfill({json:data});});
 await page.goto("/dashboard/ai-studio");await page.getByLabel("Message YouTube Chef").fill("Create a three-scene story about an ocean city");await page.getByRole("button",{name:"Send",exact:true}).click();
 await expect(page.getByRole("button",{name:"Approve 1 credits and create story",exact:true})).toBeVisible();expect(approvals).toBe(0);await expect(page.getByText("272 credits",{exact:true})).toBeVisible();
 await page.getByRole("button",{name:"Approve 1 credits and create story",exact:true}).click();await expect(page.locator(".reference-project-heading h2")).toHaveText("Ocean story");
 await expect(page.getByText("Saved scene 3",{exact:true}).first()).toBeVisible();await expect(page.getByRole("region",{name:"Story creation task"})).toContainText("3 scenes saved");expect(approvals).toBe(1);expect(lookups).toBe(0);await expect(page.locator(".agent-feed pre")).toHaveCount(0);await expect(page.getByText("271 credits",{exact:true})).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
});
