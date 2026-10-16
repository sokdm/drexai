import { test, expect } from "@playwright/test";

// Explicit opt-in: streams a public YouTube API demo through the official player.
// Only Drex metadata/auth requests are mocked. No comments are posted.
test("official YouTube embed loads and plays a public demo", async ({ page }) => {
  test.skip(process.env.LIVE_YOUTUBE_PLAYER !== "1", "Set LIVE_YOUTUBE_PLAYER=1 to exercise the real YouTube player.");
  test.setTimeout(90000);
  page.on("requestfailed", r => { if (/youtube|googlevideo|ytimg/.test(r.url())) console.log("Player network failure", r.url().split("?")[0], r.failure()?.errorText); });
  page.on("response", r => { if (/youtube.com\/embed/.test(r.url())) console.log("Embed HTTP status", r.status()); });
  await page.route("**/api/**", route => {
    const p = new URL(route.request().url()).pathname;
    let data: any = {};
    if (p === "/api/auth/me") data = { user: { id: "test", displayName: "Tester", email: "test@example.test", status: "active", emailVerified: true, onboarding: { completed: true } } };
    else if (p.endsWith("/config")) data = { configured: true, oauthConfigured: false, connection: null };
    else if (p.endsWith("/collections")) data = { collections: [], history: [] };
    else if (/\/watch\/[^/]+$/.test(p)) data = { video: { id: "M7lc1UVf-VE", title: "YouTube IFrame API demo", channelTitle: "YouTube Developers", embeddable: true, url: "https://www.youtube.com/watch?v=M7lc1UVf-VE" } };
    else data = { items: [] };
    return route.fulfill({ json: data });
  });
  await page.goto("/dashboard/youtube-research/watch/M7lc1UVf-VE");
  const frame = page.frameLocator(".yt-watch-player iframe");
  try { await expect(frame.getByRole("button", { name: /^Play/ }).first()).toBeVisible({ timeout: 30000 }); } catch (e) { console.log("Player frames", page.frames().map(f => f.url())); console.log("Player bounds", await page.locator(".yt-watch-player iframe").boundingBox()); console.log("Player buttons", await frame.getByRole("button").allTextContents()); for (const f of page.frames().filter(f => f.url().includes("youtube.com/embed"))) console.log("Embed document", (await f.locator("body").innerText()).slice(0, 1500)); throw e; }
  await frame.getByRole("button", { name: /^Play/ }).first().click();
  await expect.poll(() => frame.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 30000 }).toBeGreaterThan(1);
  await expect(frame.getByRole("button", { name: /Full screen/i })).toBeVisible();
});
