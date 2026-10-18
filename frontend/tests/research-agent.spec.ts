import { test, expect } from "@playwright/test";
for (const width of [390, 1440]) test(`research chat quotes, streams, and resumes memory at ${width}px`, async ({ page }, info) => {
 await page.setViewportSize({ width, height: 950 }); let calls = 0;
 await page.route("**/api/**", route => { const req = route.request(), p = new URL(req.url()).pathname; let data: any = {};
  if (p === "/api/auth/me") data = { user: { id: "customer", displayName: "Customer", email: "customer@example.test", status: "active", emailVerified: true, onboarding: { completed: true } } };
  if (p === "/api/ai/agent/conversations") data = { conversations: [{ _id: "a11111111111111111111111", title: "Saved research" }] };
  if (p === "/api/ai/agent/quote") data = { quote: { allowed: true, credits: 8 } };
  if (p.endsWith("/agent/conversations/a11111111111111111111111")) data = { conversation: { messages: [{ role: "user", content: "Previous question" }, { role: "assistant", content: "Saved answer" }] } };
  if (p === "/api/ai/agent/chat") { calls++; expect(req.postDataJSON().approvedCredits).toBe(8); return route.fulfill({ contentType: "text/event-stream", body: 'event: conversation\ndata: {"id":"a11111111111111111111111"}\n\nevent: progress\ndata: {"text":"Searching YouTube"}\n\nevent: tool\ndata: {"name":"search_videos","status":"completed"}\n\nevent: delta\ndata: {"text":"Evidence based "}\n\nevent: delta\ndata: {"text":"content idea."}\n\nevent: done\ndata: {}\n\n' }); }
  return route.fulfill({ json: data });
 });
 await page.goto("/dashboard/ai-assistant"); await page.getByLabel("Message YouTube Chef").fill("Find a content opportunity");
 page.on("dialog",d=>d.accept());
 await page.getByRole("button", { name: "Send", exact: true }).click();
 await expect(page.getByText("Evidence based content idea.", { exact: true })).toBeVisible(); expect(calls).toBe(1);await expect(page.getByText("search videos",{exact:true})).toBeVisible();
 await expect(page.getByLabel("Message YouTube Chef")).toHaveValue("");
 await expect(page.getByRole("checkbox")).toHaveCount(0);
 const composer = await page.getByLabel("Message YouTube Chef").boundingBox(); expect(composer!.height).toBeLessThanOrEqual(88);
 if (width > 800) { await page.getByRole("button", { name: "Saved research" }).click(); await expect(page.getByText("Saved answer", { exact: true })).toBeVisible(); }
 await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
 await page.screenshot({ path: info.outputPath(`research-agent-${width}.png`), fullPage: true });
});
