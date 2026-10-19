import { test, expect } from "@playwright/test";

for (const width of [390, 1440]) test(`production activity and budget live inside chat at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 950 });
  const productionId = "a11111111111111111111111", projectId = "b11111111111111111111111";
  let approvals = 0, approved = false, manual = false;
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    let data: any = {};
    if (path === "/api/auth/me") data = { user: { id: "user", displayName: "Creator", email: "creator@example.test", status: "active", emailVerified: true, onboarding: { completed: true } } };
    if (path === "/api/wallet") data = { wallet: { availableCredits: 100 } };
    if (path === "/api/studio/config") data = { projects: [{ _id: projectId, title: "Original production", approvedAt: new Date().toISOString(), scenes: [] }], characters: [], imageModels: [], videoModels: [], voiceModels: [], readiness: { queueEnabled: true, workerOnline: true, storageConfigured: true, providerConfigured: true } };
    if (path === "/api/studio/productions") data = { productions: [] };
    if (path === "/api/studio/asset-packs") data = { packs: [], assets: [] };
    if (path === "/api/ai/agent/conversations") data = { conversations: [] };
    if (path.endsWith("/events")) return route.fulfill({ contentType: "text/event-stream", body: ": heartbeat\n\n" });
    if (path.endsWith("/approve")) { approvals++; expect(route.request().postDataJSON().approvedCredits).toBe(12); approved = true; }
    if(path==="/api/ai/agent/approvals")data={wallet:{availableCredits:approved?88:100},approvals:[{_id:"d11111111111111111111111",productionId,scope:"operation",operation:"Image generation",models:["Selected image model"],quantity:3,credits:12,status:approved?"approved":"pending",expiresAt:new Date(Date.now()+600000).toISOString(),progress:{completed:0,total:3,productionStatus:approved?"queued":"draft"},transaction:approved?{status:"reserved",settled:0,remaining:12}:null}]};
    if (path === `/api/studio/productions/${productionId}`) data = { production: { _id: productionId, projectId, title: "Original production", status: approved ? "queued" : "draft", snapshot: { scenes: [], characters: [], manual }, steps: [], settings: {}, estimate: { credits: 12, missingPricing: [], renderCredits: 0 }, timeline: [], maxCredits: approved ? 12 : 0, approvedAt: approved ? new Date().toISOString() : undefined, expiresAt: new Date(Date.now() + 600000).toISOString() }, assets: [], exports: [], events: [{ _id: "event1", createdAt: new Date().toISOString(), level: "waiting", message: "Real saved production plan awaits approval", stepKey: "plan" }] };
    if(path===`/api/studio/productions/${productionId}/edit`)data={edit:{_id:"c11111111111111111111111",revision:2,timeline:{clips:[{id:"title1",kind:"title",label:"Saved manual title",text:"My manual edit",sourceIn:0,duration:2,transition:"cut"}],overlays:[],audio:[],captions:[],aspectRatio:"16:9",musicDecision:"none"}},assets:[]};
    return route.fulfill({ json: data });
  });
  await page.goto(`/dashboard/ai-studio?productionId=${productionId}&projectId=${projectId}`);
  await expect(page.locator(".agent-feed").getByText("Real saved production plan awaits approval")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Live activity", exact: true })).toHaveCount(0);
  await page.locator(".agent-feed").getByRole("button", { name: "Approve 12 Credits", exact: true }).click();
  await expect.poll(() => approvals).toBe(1);
  await expect(page.locator(".agent-transaction")).toContainText("Transaction: reserved");
  manual=true;await page.reload();await expect(page.getByRole("link",{name:"Open this timeline in Video Editor"})).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});
