import { test, expect, Page } from "@playwright/test";
const id = "abcdefghijk", next = "lmnopqrstuv";
const video = (key = id) => ({ id: key, title: key === id ? "Original research video" : "Related story", channelTitle: "Creator Studio", channelId: "UCcreator", thumbnail: "/assets/drex-ai-references.png", statistics: { viewCount: "1200", likeCount: "42" }, duration: "PT2M", publishedAt: "2026-10-15T12:00:00Z", description: "The original video description.", embeddable: true, url: `https://www.youtube.com/watch?v=${key}` });
async function setup(page: Page, scope = false) {
  const state = { posts: [] as any[], disabled: false, quota: false, sorts: [] as string[] };
  await page.addInitScript(() => { (window as any).YT = { Player: class { frame: HTMLIFrameElement; constructor(node: HTMLElement, options: any) { this.frame = document.createElement("iframe"); this.frame.src = `https://www.youtube.com/embed/${options.videoId}?controls=1&origin=${encodeURIComponent(options.playerVars.origin)}`; this.frame.allowFullscreen = true; node.replaceWith(this.frame); (window as any).testPlayerOptions = options; setTimeout(() => options.events.onReady(), 0); } getIframe() { return this.frame; } destroy() { this.frame.remove(); } } }; });
  await page.route("https://www.youtube.com/embed/**", route => route.fulfill({ contentType: "text/html", body: '<button onclick="this.textContent=\'Paused\'">Play</button>' }));
  await page.route("**/api/**", route => {
    const req = route.request(), url = new URL(req.url()), p = url.pathname;
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": req.headers().origin || "http://localhost:5174", "access-control-allow-credentials": "true", "access-control-allow-headers": "content-type,x-csrf-token", "access-control-allow-methods": "GET,POST" } });
    let data: any = {};
    if (p === "/api/auth/me") data = { user: { id: "test", displayName: "Tester", email: "test@example.test", status: "active", emailVerified: true, onboarding: { completed: true } } };
    else if (p.endsWith("/config")) data = { configured: true, oauthConfigured: true, connection: { channelTitle: "My channel", scopes: scope ? ["https://www.googleapis.com/auth/youtube.force-ssl"] : [] } };
    else if (p.endsWith("/collections")) data = { collections: [{ _id: "saved", items: [{ _id: "bookmark", itemType: "video", youtubeId: id, ...video(), metadata: video() }] }], history: [] };
    else if (p.endsWith("/popular") || p.endsWith("/search/videos")) data = { items: [video()] };
    else if (p.endsWith("/recommendations")) { if (state.quota) return route.fulfill({ status: 429, json: { error: "YouTube's request limit has been reached." } }); data = { items: [video(p.includes(next) ? id : next)], nextPageToken: url.searchParams.has("pageToken") ? null : "next-page" }; }
    else if (p.includes("/comment-replies/")) data = { items: [{ id: "reply-1", author: "Reply author", text: "A real reply", likes: 2, date: "2026-10-15" }] };
    else if (p.endsWith("/comments")) { if (req.method() === "POST") { state.posts.push(req.postDataJSON()); data = { comment: { id: "posted" }, moderationNotice: "YouTube may hold comments for review." }; } else { state.sorts.push(url.searchParams.get("order") || ""); data = { disabled: state.disabled, items: state.disabled ? [] : [{ id: "comment-1", author: "Viewer", text: "Great video <script>plain text</script>", likes: 8, date: "2026-10-15", replyCount: 1, canReply: true }] }; } }
    else if (/\/watch\/[^/]+$/.test(p)) data = { video: video(p.split("/").pop()) };
    return route.fulfill({ json: data });
  }); return state;
}
for (const width of [390, 1440]) test(`watch navigation from Trending, Videos and Saved preserves research at ${width}px`, async ({ page }, info) => {
  await setup(page); await page.setViewportSize({ width, height: 1000 }); await page.goto("/dashboard/youtube-research");
  await page.getByRole("button", { name: "View Original research video", exact: true }).click(); await expect(page).toHaveURL(new RegExp(`/watch/${id}$`));
  await expect(page.locator(".yt-watch-player iframe")).toHaveAttribute("src", /youtube.com\/embed\/abcdefghijk/); await page.frameLocator(".yt-watch-player iframe").getByRole("button", { name: "Play", exact: true }).click(); await expect(page.frameLocator(".yt-watch-player iframe").getByRole("button", { name: "Paused" })).toBeVisible();
  await expect(page.locator(".yt-watch-comments")).toContainText("Great video <script>plain text</script>"); await expect(page.getByRole("button", { name: "Authorize commenting" })).toBeVisible();
  await page.getByRole("button", { name: "View 1 replies" }).click(); await expect(page.locator(".yt-watch-replies")).toContainText("A real reply"); await page.getByRole("button", { name: "Hide replies" }).click(); await expect(page.locator(".yt-watch-replies")).toHaveCount(0);
  await page.getByLabel("Sort comments").selectOption("time"); await expect(page.getByLabel("Sort comments")).toHaveValue("time");
  await page.locator(".yt-watch-rec").first().click(); await expect(page).toHaveURL(new RegExp(`/watch/${next}$`)); await expect(page.locator(".yt-watch h1")).toHaveText("Related story"); await expect(page.locator(".yt-watch-rec")).toContainText("Original research video");
  await page.getByRole("link", { name: "Back to research", exact: true }).click(); await expect(page.locator(".yt-tabs button[aria-current=page]")).toHaveText("Trending");
  await page.getByLabel("Search YouTube", { exact: true }).fill("original topic"); await page.getByRole("button", { name: "Search", exact: true }).click(); await page.getByRole("button", { name: "View Original research video", exact: true }).click(); await page.getByRole("link", { name: "Back to research", exact: true }).click(); await expect(page.getByLabel("Search YouTube", { exact: true })).toHaveValue("original topic"); await expect(page.locator(".yt-tabs button[aria-current=page]")).toHaveText("Videos");
  await page.locator(".yt-tabs").getByRole("button", { name: /^Saved/ }).click(); await page.locator(".yt-saved-item h3 a").click(); await expect(page.locator(".yt-watch h1")).toHaveText("Original research video");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  if (width === 390) expect(await page.locator(".yt-watch-recommendations").evaluate(el => el.getBoundingClientRect().top)).toBeLessThan(await page.locator(".yt-watch-comments").evaluate(el => el.getBoundingClientRect().top));
  await page.screenshot({ path: info.outputPath(`watch-${width}.png`), fullPage: true }); await page.getByRole("button", { name: "Ask YouTube Chef", exact: true }).click(); await expect(page.getByLabel("Message YouTube Chef", { exact: true })).toBeVisible();
});
test("authorized comment and reply posting uses selected video and confirmed response", async ({ page }) => {
  const state = await setup(page, true); await page.goto(`/dashboard/youtube-research/watch/${id}`); await page.getByLabel("Add a comment", { exact: true }).fill("My original comment"); await page.getByRole("button", { name: "Post comment", exact: true }).click(); await expect(page.getByRole("status")).toContainText("Comment posted"); expect(state.posts[0]).toEqual({ text: "My original comment" });
  await page.getByRole("button", { name: "Reply", exact: true }).click(); await page.getByLabel("Write a reply").fill("My reply"); await page.getByRole("button", { name: "Post reply", exact: true }).click(); await expect.poll(() => state.posts.length).toBe(2); expect(state.posts[1]).toEqual({ text: "My reply", parentId: "comment-1" });
});
test("disabled comments, quota limits and player errors have useful fallback states", async ({ page }) => {
  const state = await setup(page); state.disabled = true; state.quota = true; await page.goto(`/dashboard/youtube-research/watch/${id}`); await expect(page.getByText("Comments are turned off for this video.")).toBeVisible(); await expect(page.getByRole("button", { name: "Retry recommendations" })).toBeVisible(); await expect(page.locator(".yt-watch-player iframe")).toBeVisible(); await page.evaluate(() => (window as any).testPlayerOptions.events.onError({ data: 150 })); await expect(page.getByText("The owner does not allow this video to be embedded.")).toBeVisible(); await expect(page.getByRole("link", { name: "Watch on YouTube", exact: true })).toHaveAttribute("href", /youtube.com\/watch/);
});
