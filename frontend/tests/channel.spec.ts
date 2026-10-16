import { test, expect, Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const id = "a33333333333333333333333";
const channel = { id: "my-channel", title: "My Creator Channel", handle: "@mycreator", thumbnail: "/assets/drex-ai-references.png", description: "Original stories and ideas.", statistics: { subscriberCount: "1400", videoCount: "12", viewCount: "52000" }, url: "https://www.youtube.com/channel/my-channel" };
const video = { id: "own-video", title: "My original video", thumbnail: "/assets/drex-ai-references.png", url: "https://www.youtube.com/watch?v=own-video", privacy: "private", duration: "PT48S", statistics: { viewCount: "200" } };
async function mockChannel(page: Page, permission = true) {
  const uploads: any[] = [], state = { starts: [] as any[], chunks: 0, thumbnails: 0, loseResponse: false, release: () => {} };
  const gate = new Promise<void>(resolve => { state.release = resolve; });
  page.on("dialog", dialog => dialog.accept());
  await page.route("**/api/**", async route => {
    const req = route.request(), path = new URL(req.url()).pathname, method = req.method();
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": req.headers().origin || "http://localhost:5173", "access-control-allow-credentials": "true", "access-control-allow-headers": "content-type,x-csrf-token,x-upload-offset", "access-control-allow-methods": "GET,POST,PUT" } });
    let data: any = {};
    if (path === "/api/auth/me") data = { user: { id: "test", displayName: "Creator", email: "creator@example.test", status: "active", emailVerified: true, onboarding: { completed: true } } };
    else if (path === "/api/youtube/config") data = { configured: true, oauthConfigured: true, connection: { channelId: channel.id, channelTitle: channel.title } };
    else if (path === "/api/youtube/my-channel") data = { channel, videos: [video], canUpload: permission, nextPageToken: null };
    else if (path === "/api/youtube/uploads" && method === "GET") data = { uploads };
    else if (path === "/api/youtube/uploads" && method === "POST") { const body = req.postDataJSON(); state.starts.push(body); const upload = { ...body, _id: id, channelId: channel.id, uploadedBytes: 0, status: "uploading" }; uploads.unshift(upload); data = { upload }; }
    else if (path.endsWith("/chunk")) {
      state.chunks++; expect(req.headers()["x-upload-offset"]).toBe("0"); expect(req.postDataBuffer()!.length).toBe(uploads[0].fileSize);
      if (state.loseResponse) return route.fulfill({ status: 503, json: { error: "Upload interrupted. Resume to continue." } });
      await gate; Object.assign(uploads[0], { status: "completed", uploadedBytes: uploads[0].fileSize, videoId: "uploaded-video", videoUrl: "https://www.youtube.com/watch?v=uploaded-video" }); data = { upload: uploads[0] };
    } else if (path === `/api/youtube/uploads/${id}`) { Object.assign(uploads[0], { status: "completed", uploadedBytes: uploads[0].fileSize, videoUrl: "https://www.youtube.com/watch?v=uploaded-video" }); data = { upload: uploads[0] }; }
    else if (path.endsWith("/thumbnail")) { state.thumbnails++; expect(req.headers()["content-type"]).toBe("image/png"); data = { thumbnail: "/assets/drex-ai-references.png" }; }
    return route.fulfill({ json: data });
  });
  return state;
}
async function fillUpload(page: Page) {
  await page.getByRole("button", { name: "Upload video", exact: true }).click();
  await page.getByLabel("Choose YouTube video", { exact: true }).setInputFiles({ name: "original.mp4", mimeType: "video/mp4", buffer: await readFile(new URL("../../backend/test-artifacts/phase10-final.mp4", import.meta.url)) });
  await page.getByLabel("Video title", { exact: true }).fill("My next original video"); await page.getByLabel("Made for kids", { exact: true }).selectOption("no"); await page.getByLabel("Altered or synthetic content", { exact: true }).selectOption("yes");
}
for (const width of [390, 1440]) test(`connected channel profile, upload feedback and thumbnail pictures at ${width}px`, async ({ page }, info) => {
  test.setTimeout(120000); const state = await mockChannel(page), errors: string[] = []; page.on("pageerror", err => errors.push(err.message));
  await page.addInitScript(theme => localStorage.setItem("theme", theme), width === 390 ? "light" : "dark"); await page.setViewportSize({ width, height: 1000 }); await page.goto("/dashboard/youtube-channel");
  await expect(page.getByRole("heading", { name: channel.title, exact: true })).toBeVisible(); await expect(page.locator(".my-yt-stats")).toContainText("1,400"); await expect(page.locator(".my-yt-video-grid")).toContainText("private");
  await fillUpload(page); await expect(page.getByLabel("Video visibility")).toHaveValue("private"); await page.getByRole("button", { name: "Upload to YouTube", exact: true }).click();
  await expect(page.getByRole("region", { name: "Video upload progress" })).toContainText("Uploading to YouTube"); await expect(page.getByRole("progressbar", { name: "Uploaded video bytes" })).toHaveAttribute("value", "0"); state.release();
  await expect(page.getByRole("button", { name: "Uploaded", exact: true })).toBeDisabled(); await expect(page.getByRole("status")).toContainText("Uploaded to YouTube"); expect(state.starts.length).toBe(1); expect(state.starts[0].privacy).toBe("private"); expect(state.starts[0].madeForKids).toBe(false); expect(state.starts[0].syntheticMedia).toBe(true);
  await page.reload(); await page.getByRole("button", { name: "Upload video", exact: true }).click(); await expect(page.locator(".my-yt-upload-history")).toContainText("My next original video"); await expect(page.locator(".my-yt-upload-history")).toContainText("Uploaded");
  await page.getByRole("button", { name: "Pictures", exact: true }).click(); await expect(page.getByRole("link", { name: "Open YouTube Posts" })).toHaveAttribute("href", `${channel.url}/posts`); await expect(page.getByText("Picture posts are created on YouTube.", { exact: false })).toBeVisible();
  await page.getByLabel("Video for thumbnail", { exact: true }).selectOption(video.id); const picker = page.waitForEvent("filechooser"); await page.getByRole("button", { name: "Upload thumbnail picture", exact: true }).click(); await (await picker).setFiles({ name: "thumbnail.png", mimeType: "image/png", buffer: await readFile(new URL("../public/assets/drex-ai-references.png", import.meta.url)) });
  await expect(page.getByRole("status")).toContainText("Thumbnail updated on YouTube"); expect(state.thumbnails).toBe(1);
  await page.screenshot({ path: info.outputPath(`my-channel-${width}.png`), fullPage: true }); await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1); expect(errors).toEqual([]);
});
test("lost upload response resumes the same session without reposting the video", async ({ page }) => {
  const state = await mockChannel(page); state.loseResponse = true; await page.goto("/dashboard/youtube-channel"); await fillUpload(page); await page.getByRole("button", { name: "Upload to YouTube", exact: true }).click(); await expect(page.getByRole("alert")).toContainText("Upload interrupted");
  await page.locator(".my-yt-upload-form").getByRole("button", { name: "Resume upload", exact: true }).click(); await expect(page.getByRole("button", { name: "Uploaded", exact: true })).toBeDisabled(); expect(state.starts.length).toBe(1); expect(state.chunks).toBe(1);
});
test("read-only connections show the enable-uploads step", async ({ page }) => {
  await mockChannel(page, false); await page.goto("/dashboard/youtube-channel"); await expect(page.getByRole("button", { name: "Enable uploads", exact: true })).toBeVisible(); await expect(page.getByRole("button", { name: "Change thumbnail", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Upload video", exact: true }).click(); await expect(page.getByRole("button", { name: "Upload to YouTube", exact: true })).toBeDisabled();
});

test("Phase 11 draft metadata reaches uploader and declining confirmation sends no upload", async ({ page }) => {
  const state = await mockChannel(page);
  await page.route("**/api/publishing/drafts/*", route => route.fulfill({ json: { draft: { _id: "c11111111111111111111111", metadata: { title: "Reviewed publishing title", description: "Reviewed publishing description", keywords: ["original story", "city"] } } } }));
  await page.goto("/dashboard/youtube-channel?draftId=c11111111111111111111111");
  await expect(page.getByLabel("Video title", { exact: true })).toHaveValue("Reviewed publishing title"); await expect(page.getByLabel("Video description", { exact: true })).toHaveValue("Reviewed publishing description"); await expect(page.getByLabel("Video tags", { exact: true })).toHaveValue("original story, city");
  await page.getByLabel("Choose YouTube video", { exact: true }).setInputFiles({ name: "original.mp4", mimeType: "video/mp4", buffer: await readFile(new URL("../../backend/test-artifacts/phase10-final.mp4", import.meta.url)) });
  await page.getByLabel("Made for kids", { exact: true }).selectOption("no"); await page.getByLabel("Altered or synthetic content", { exact: true }).selectOption("yes");
  page.removeAllListeners("dialog"); page.on("dialog", d => d.dismiss()); await page.getByRole("button", { name: "Upload to YouTube", exact: true }).click(); await expect(page.getByRole("button", { name: "Upload to YouTube", exact: true })).toBeEnabled(); expect(state.starts.length).toBe(0);
  page.removeAllListeners("dialog"); page.on("dialog", d => d.accept()); await page.getByRole("button", { name: "Upload to YouTube", exact: true }).click(); await expect.poll(() => state.starts.length).toBe(1); expect(state.starts[0].confirmed).toBe(true); expect(state.starts[0].title).toBe("Reviewed publishing title"); expect(state.starts[0].tags).toEqual(["original story", "city"]); state.release(); await expect(page.getByRole("button", { name: "Uploaded", exact: true })).toBeDisabled();
});
