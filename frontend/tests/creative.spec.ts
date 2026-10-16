import { test, expect } from "@playwright/test";
for (const width of [390, 1440]) test(`short-clip add-on preserves editor start layout at ${width}px`, async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    const data = path === "/api/auth/me" ? { user: { id: "test", displayName: "Creator", email: "creator@example.test", status: "active", emailVerified: true, onboarding: { completed: true } } }
      : path === "/api/editor/config" ? { productions: [], edits: [] }
      : path === "/api/creative/config" ? { storageConfigured: true, workerOnline: true, analysisConfigured: true, maxSourceBytes: 1073741824, presenters: [] }
      : path === "/api/creative/jobs" ? { jobs: [{ _id: "job", kind: "shorts", name: "My prepared clips", status: "completed", progress: 100, result: { note: "AI estimates. Review before export.", clips: [{ editId: "clip1", title: "A useful moment", hook: "Start here", score: 70, reason: "A clear idea", start: 5, end: 25 }] } }] }
      : path === "/api/creative/quote" ? { quote: { allowed: true, credits: 25 } } : {};
    return route.fulfill({ json: data });
  });
  await page.setViewportSize({ width, height: 1000 }); await page.goto("/dashboard/video-editor");
  await expect(page.getByRole("heading", { name: "Video Editor", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Long video to short clips", exact: true }).click();
  await page.getByLabel("Source MP4").setInputFiles({ name: "source.mp4", mimeType: "video/mp4", buffer: Buffer.from("UI test source only") });
  await page.getByLabel("Number of clips").selectOption("20"); await page.getByRole("button", { name: "Preview credit cost" }).click();
  await expect(page.getByRole("button", { name: "Confirm and start for 25 credits" })).toBeVisible();
  await expect(page.getByText("Estimated engagement: 70/100.", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Review and export clip" })).toHaveAttribute("href", /editId=clip1/);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]); await page.screenshot({ path: info.outputPath(`short-clips-${width}.png`), fullPage: true });
});
