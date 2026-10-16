import { test, expect, Page } from "@playwright/test";

const video = { id: "video-1", title: "Wisdom drill", channelTitle: "Wisdom Studio", thumbnail: "/assets/drex-ai-references.png", duration: "PT48S", publishedAt: "2026-10-15T12:00:00Z", description: "An original comedy idea.", url: "https://www.youtube.com/watch?v=video-1", statistics: { viewCount: "1078", likeCount: "215", commentCount: "13" } };
const channel = { id: "channel-1", title: "Wisdom Studio", thumbnail: video.thumbnail, description: "Original comedy and storytelling.", url: "https://www.youtube.com/@wisdom", statistics: { subscriberCount: "10000", videoCount: "42" } };
async function mockResearch(page: Page) {
  const collection: any = { _id: "collection-1", name: "Saved Research", items: [] };
  const state = { saves: 0, failNextSave: false, chats: [] as any[], releaseAnalysis: () => {} };
  const analysisGate = new Promise<void>(resolve => { state.releaseAnalysis = resolve; });
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": request.headers().origin || "http://localhost:5173", "access-control-allow-credentials": "true", "access-control-allow-headers": "content-type,x-csrf-token", "access-control-allow-methods": "GET,POST,DELETE" } });
    let data: any = {};
    if (path === "/api/auth/me") data = { user: { id: "test", displayName: "Research Tester", email: "research@example.test", status: "active", emailVerified: true, onboarding: { completed: true } } };
    else if (path === "/api/youtube/config") data = { configured: true, oauthConfigured: true, connection: { channelTitle: "My channel" } };
    else if (path === "/api/youtube/collections") data = { collections: [collection], history: [{ _id: "history-1", kind: "channel", query: { value: "wisdom" }, createdAt: "2026-10-15T12:00:00Z" }, { _id: "history-2", kind: "popular", query: { regionCode: "NG" }, createdAt: "2026-10-15T11:00:00Z" }] };
    else if (path.endsWith("/items") && method === "POST") {
      state.saves++; if (state.failNextSave) { state.failNextSave = false; return route.fulfill({ status: 503, json: { error: "Could not save right now. Please try again." } }); }
      const body = request.postDataJSON(); if (!collection.items.some((item: any) => item.youtubeId === body.youtubeId && item.itemType === body.itemType)) collection.items.push({ ...body, _id: `saved-${collection.items.length}` });
      data = { collection };
    } else if (method === "DELETE") { collection.items = collection.items.filter((item: any) => !path.endsWith(item._id)); data = { collection }; }
    else if (path === "/api/youtube/channel") data = { channel, uploads: [video] };
    else if (path === "/api/youtube/popular" || path === "/api/youtube/search/videos") data = { items: [video] };
    else if (path === "/api/ai/quote") data = { quote: { allowed: true, credits: 1 } };
    else if (path === "/api/ai/analyze-channel") { await analysisGate; data = { evidence: { channel, uploads: [video], competitors: [video], note: "Public metadata snapshot. AI inferences are estimates." }, analysis: { keywords: ["comedy ideas"], contentGaps: [{ topic: "Everyday stories", evidence: "A limited sample", opportunity: "Try an original series" }], contentBriefs: [{ title: "A fresh story", audience: "Comedy viewers", hook: "Start with a question", outline: ["Opening", "Story", "Close"], keywords: ["comedy"], rationale: "Original storytelling" }], mainNiche: "**Original comedy**", contentThemes: ["Everyday humour"], publishingPatterns: "Post consistently.", creativeOpportunities: ["Try a short story series."], potentialNicheIdeas: [{ name: "Everyday stories", rationale: "Relatable ideas for your audience." }], limitations: ["Based on public videos only."] } }; }
    else if (path === "/api/ai/chat") { state.chats.push(request.postDataJSON()); data = { conversation: { _id: "chat-1" }, answer: "## Your next idea\n\n**Create an original story.**\n\n- Focus on one clear moment.\n- Keep the opening simple." }; }
    else if (path === "/api/youtube/analytics/summary") data = { data: { columnHeaders: [{ name: "day" }, { name: "views" }, { name: "estimatedMinutesWatched" }, { name: "averageViewDuration" }], rows: [["2026-10-14", 100, 120, 30], ["2026-10-15", 200, 240, 60]] } };
    return route.fulfill({ json: data });
  });
  return state;
}

for (const width of [390, 1440]) test(`YouTube research saves real state and opens animated Chef analysis at ${width}px`, async ({ page }, info) => {
  test.setTimeout(120000); const state = await mockResearch(page), errors: string[] = []; page.on("pageerror", err => errors.push(err.message));
  await page.addInitScript(theme => localStorage.setItem("theme", theme), width === 390 ? "light" : "dark"); await page.setViewportSize({ width, height: 1000 }); await page.goto("/dashboard/youtube-research");
  const card = page.locator(".yt-video").first(); await expect(card).toContainText("48 seconds"); await card.getByRole("button", { name: "Save video Wisdom drill", exact: true }).click(); await expect(card.getByRole("button", { name: "Saved video Wisdom drill", exact: true })).toBeDisabled(); expect(state.saves).toBe(1);
  await page.reload(); await expect(card.getByRole("button", { name: "Saved video Wisdom drill", exact: true })).toBeDisabled();
  await page.locator(".yt-tabs").getByRole("button", { name: /^Saved/ }).click(); await expect(page.locator(".yt-saved-item")).toContainText("Wisdom drill");
  await page.getByText("Recent searches", { exact: true }).click(); await expect(page.locator(".yt-history")).toContainText("Channel search for wisdom"); await expect(page.locator(".yt-history")).toContainText("Trending videos in Nigeria"); expect(await page.locator(".yt-history").innerText()).not.toContain('{"');
  await page.getByRole("button", { name: "Remove Wisdom drill from saved", exact: true }).click(); await expect(page.getByText("Save something you want to revisit")).toBeVisible();
  await page.locator(".yt-tabs").getByRole("button", { name: "Channels", exact: true }).click(); await page.getByLabel("Search YouTube", { exact: true }).fill("wisdom"); await page.getByRole("button", { name: "Search", exact: true }).click(); await expect(page.locator(".yt-channel")).toContainText("Wisdom Studio");
  await page.getByRole("button", { name: "Analyse channel", exact: true }).click(); await expect(page.getByRole("status", { name: "Analysing channel" })).toBeVisible(); await expect(page.getByRole("region", { name: "YouTube Chef", exact: true })).toBeInViewport();
  expect(await page.locator(".yt-thinking-mark span").first().evaluate(el => getComputedStyle(el).animationName)).toBe("yt-dot"); state.releaseAnalysis();
  await expect(page.locator(".yt-chat-feed")).toContainText("Original comedy"); await expect(page.getByRole("status", { name: "Analysing channel" })).toHaveCount(0); const analysis = await page.locator(".yt-chat-feed").innerText(); expect(analysis).not.toContain("**"); expect(analysis).not.toContain("mainNiche");
  await page.getByLabel("Message YouTube Chef", { exact: true }).fill("Give me a fresh idea"); await page.getByRole("button", { name: "Send message to YouTube Chef", exact: true }).click(); await expect(page.locator(".yt-chat-feed")).toContainText("Create an original story."); expect(await page.locator(".yt-chat-feed").innerText()).not.toContain("##");
  await page.getByLabel("Message YouTube Chef", { exact: true }).fill("Make it shorter"); await page.getByRole("button", { name: "Send message to YouTube Chef", exact: true }).click(); await expect.poll(() => state.chats.length).toBe(2); expect(state.chats[1].conversationId).toBe("chat-1");
  await page.screenshot({ path: info.outputPath(`youtube-chef-${width}.png`), fullPage: true });
  await page.locator(".yt-side-tabs").getByRole("button", { name: "Analytics", exact: true }).click(); await expect(page.locator(".yt-analytics")).toContainText("300"); await expect(page.locator(".yt-analytics")).toContainText("6 hours"); await expect(page.locator(".yt-analytics")).toContainText("50 seconds"); await expect(page.locator("pre")).toHaveCount(0); expect(await page.locator(".youtube-workspace").innerText()).not.toContain("columnHeaders");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1); expect(errors).toEqual([]);
});
test("failed save can be retried and filters have readable names", async ({ page }) => {
  const state = await mockResearch(page); state.failNextSave = true; await page.goto("/dashboard/youtube-research"); const card = page.locator(".yt-video").first();
  await card.getByRole("button", { name: "Save video Wisdom drill", exact: true }).click(); await expect(page.getByRole("alert")).toContainText("Please try again"); await expect(card.getByRole("button", { name: "Save video Wisdom drill", exact: true })).toBeEnabled();
  await card.getByRole("button", { name: "Save video Wisdom drill", exact: true }).click(); await expect(card.getByRole("button", { name: "Saved video Wisdom drill", exact: true })).toBeDisabled(); expect(state.saves).toBe(2);
  await page.getByRole("button", { name: "Filters", exact: true }).click(); await page.getByLabel("Country", { exact: true }).selectOption("NG"); await expect(page.getByLabel("Country", { exact: true }).locator("option:checked")).toHaveText("Nigeria");
  await expect(page.getByLabel("Video length", { exact: true }).locator("option:checked")).toHaveText("Any length"); await expect(page.getByLabel("Sort by", { exact: true }).locator("option:checked")).toHaveText("Most relevant");
});
