import {test,expect} from '@playwright/test';
test('watch iframe has its real YouTube origin before API initialization; realtime uses one WebSocket',async({page})=>{
 let sockets=0,polling=0;
 await page.addInitScript(()=>{document.cookie='drex_csrf=fixture; path=/';(window as any).playerFrames=[];(window as any).YT={Player:function(frame:HTMLIFrameElement,options:any){(window as any).playerFrames.push({tag:frame.tagName,src:frame.src});this.getIframe=()=>frame;this.destroy=()=>{};setTimeout(()=>options.events.onReady(),0);}};});
 await page.routeWebSocket('**/socket.io/**',ws=>{sockets++;ws.send('0'+JSON.stringify({sid:'fixture',upgrades:[],pingInterval:25000,pingTimeout:20000}));ws.onMessage(message=>{if(String(message).startsWith('40'))ws.send('40'+JSON.stringify({sid:'fixture'}));});});
 await page.route('**/socket.io/**',route=>{polling++;return route.abort();});
 await page.route('https://www.youtube.com/embed/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body>Mock licensed player</body></html>'}));
 await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;let data:any={};if(path==='/api/auth/me')data={user:{id:'fixture',displayName:'Tester',status:'active',emailVerified:true,onboarding:{completed:true}}};if(path==='/api/wallet')data={wallet:{availableCredits:209}};if(path==='/api/youtube/config')data={configured:true};if(path==='/api/youtube/watch/fixture')data={video:{id:'fixture',title:'Test film',url:'https://www.youtube.com/watch?v=fixture',embeddable:true}};if(path.endsWith('/recommendations')||path.endsWith('/comments'))data={items:[]};return route.fulfill({json:data});});
 await page.goto('/dashboard/youtube-research/watch/fixture');
 await expect(page.locator('.yt-watch-player iframe')).toHaveAttribute('src',/^https:\/\/www.youtube.com\/embed\/fixture\?/);
 await expect.poll(()=>page.evaluate(()=>(window as any).playerFrames.length)).toBe(1);
 const frame=await page.evaluate(()=>(window as any).playerFrames[0]);expect(frame.tag).toBe('IFRAME');expect(frame.src).toContain('origin=http');
 await expect(page.locator('.yt-watch-player iframe')).not.toHaveAttribute('allowfullscreen');
 await expect.poll(()=>sockets).toBe(1);await page.waitForTimeout(600);expect(sockets).toBe(1);expect(polling).toBe(0);
});
