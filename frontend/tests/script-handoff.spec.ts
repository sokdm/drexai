import {test,expect} from '@playwright/test';
for(const width of [390,1440])test(`review approval opens actual Studio plan and readable saved-project card at ${width}px`,async({page})=>{
 const id='a11111111111111111111111',pid='b11111111111111111111111',cid='c11111111111111111111111';let plans=0,paid=0;
 let project:any={_id:id,title:'The Hidden Isle',summary:'An explorer discovers an island.',targetDuration:'20 seconds',scenes:[1,2,3].map(n=>({_id:String(n).repeat(24),order:n,title:'Discovery '+n,sceneDescription:'A cinematic scene. '.repeat(12),narration:'The explorer finds an island.',dialogue:'',imagePrompt:'A realistic island',videoMotionPrompt:'Slow pan',estimatedDurationSeconds:7,approved:false})),prompts:{},versions:[]};let production:any;
 await page.addInitScript(({id,cid})=>{localStorage.setItem('theme','dark');localStorage.setItem('drex-agent:studio:'+id,cid);},{id,cid});
 await page.route('**/api/**',route=>{const req=route.request(),path=new URL(req.url()).pathname;let data:any={};
 if(req.method()==='POST'&&/generate|produce|\/approvals\/.*approve/.test(path))paid++;
 if(path==='/api/auth/me')data={user:{id:'fixture',displayName:'Tester',status:'active',emailVerified:true,onboarding:{completed:true}}};
 if(path==='/api/wallet')data={wallet:{availableCredits:209}};
 if(path==='/api/ai/projects')data={projects:[project]};if(path===`/api/ai/projects/${id}`)data={project};if(path.endsWith('/scene-images'))data={assets:[]};if(path==='/api/ai/niches')data={niches:[]};if(path.includes('/scripts/history'))data={jobs:[],conversations:[]};
 if(path===`/api/ai/projects/${id}/approve`){project={...project,approvedAt:new Date().toISOString(),scenes:project.scenes.map((s:any)=>({...s,approved:true}))};data={project};}
 if(path.endsWith('/continue-ai-studio')){expect(project.approvedAt).toBeTruthy();data={project};}
 if(path==='/api/studio/config')data={projects:[project],characters:[],imageModels:[],videoModels:[],voiceModels:[],readiness:{queueEnabled:true,storageConfigured:true,providerConfigured:true,workerOnline:true}};
 if(path==='/api/studio/productions')data={productions:[]};
 if(path==='/api/studio/plans'){plans++;expect(req.postDataJSON().settings.targetSeconds).toBe(20);production={_id:pid,projectId:id,title:project.title,status:'draft',settings:req.postDataJSON().settings,snapshot:{scenes:project.scenes,characters:[],requiresScriptReview:true},timeline:[],steps:[],estimate:{credits:15,missingPricing:[]},expiresAt:new Date(Date.now()+600000).toISOString()};data={production};}
 if(path===`/api/studio/productions/${pid}`)data={production,assets:[],events:[],exports:[]};
 if(path.endsWith('/events'))return route.fulfill({contentType:'text/event-stream',body:': heartbeat\n\n'});
 if(path==='/api/ai/agent/conversations')data={conversations:[{_id:cid,title:'Island story'}]};if(path===`/api/ai/agent/conversations/${cid}`)data={conversation:{projectId:id,messages:[{role:'assistant',content:'Your scenes are saved.'}]}};if(path==='/api/ai/agent/tasks')data={tasks:[]};if(path==='/api/ai/agent/limits')data={remaining:11,resetsAt:new Date(Date.now()+14400000).toISOString()};
 return route.fulfill({json:data});});
 await page.setViewportSize({width,height:1000});await page.goto('/dashboard/script-builder?projectId='+id);
 await expect(page.getByLabel('Scene 1 Scene description',{exact:true})).toBeVisible();
 await expect(page.getByLabel('Scene 1 title',{exact:true})).toHaveValue('Discovery 1');
 await page.getByRole('button',{name:'Approve and continue to AI Studio',exact:true}).click();
 await expect(page).toHaveURL(new RegExp('productionId='+pid));await expect(page.locator('.reference-project-heading h2')).toHaveText('The Hidden Isle');
 await expect(page.locator('.agent-project')).toContainText('Script approved. Ready for production planning.');await expect(page.locator('.agent-project')).not.toContainText('Review and approve scenes');
 expect(plans).toBe(1);expect(paid).toBe(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 const copy=await page.locator('.agent-project>div').boundingBox();expect(copy!.width).toBeGreaterThan(140);
});
