import {test,expect} from '@playwright/test';
test('agent restores saved history after refresh and keeps new chats separate',async({page})=>{
 const old='a11111111111111111111111',fresh='b11111111111111111111111';let sent=false;
 await page.addInitScript(()=>localStorage.setItem('drex-agent:research:general','a11111111111111111111111'));
 await page.route('**/api/**',route=>{const req=route.request(),p=new URL(req.url()).pathname;let data:any={};
 if(p==='/api/auth/me')data={user:{id:'user',displayName:'Creator',email:'creator@example.test',status:'active',emailVerified:true,onboarding:{completed:true}}};
 if(p==='/api/ai/agent/limits')data={remaining:19,limit:20,resetsAt:new Date(Date.now()+14400000).toISOString()};
 if(p==='/api/ai/agent/conversations')data={conversations:[{_id:old,title:'Ocean project'},{_id:fresh,title:'New adventure'}]};
 if(p===`/api/ai/agent/conversations/${old}`)data={conversation:{messages:[{role:'user',content:'Remember Mara wears a blue coat'},{role:'assistant',content:'Saved original story context'}]}};
 if(p===`/api/ai/agent/conversations/${fresh}`)data={conversation:{messages:[{role:'user',content:'A new adventure'},{role:'assistant',content:'New independent response'}]}};
 if(p==='/api/ai/agent/tasks')data={tasks:[]};if(p==='/api/ai/agent/quote')data={quote:{allowed:true,credits:0}};
 if(p==='/api/ai/agent/chat'){expect(req.postDataJSON().conversationId).toBeUndefined();sent=true;return route.fulfill({contentType:'text/event-stream',body:'event: conversation\ndata: {"id":"b11111111111111111111111"}\n\nevent: delta\ndata: {"text":"New independent response"}\n\nevent: done\ndata: {}\n\n'});}
 return route.fulfill({json:data});});
 await page.goto('/dashboard/ai-assistant');await expect(page.getByText('Saved original story context',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'New chat',exact:true}).click();await expect(page.getByText('Saved original story context',{exact:true})).toHaveCount(0);await page.getByLabel('Message YouTube Chef').fill('A new adventure');await page.getByRole('button',{name:'Send',exact:true}).click();await expect(page.getByText('New independent response',{exact:true})).toBeVisible();expect(sent).toBe(true);await expect.poll(()=>page.evaluate(()=>localStorage.getItem('drex-agent:research:general'))).toBe(fresh);
 await page.getByLabel('Agent chat history').selectOption(old);await expect(page.getByText('Saved original story context',{exact:true})).toBeVisible();
});
