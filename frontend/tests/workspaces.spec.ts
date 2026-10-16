import { expect, test, Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const projectId = "a11111111111111111111111";
const productionId = "b11111111111111111111111";
const settings = { imageModel: "gemini-nano-banana-2.1", videoModel: "veo-3.1-generate-preview", voiceModel: "gemini-3.8-flash-tts", aspectRatio: "16:9", resolution: "1K", quality: "720p", voiceId: "Kore", language: "English", style: "cinematic", narration: true, video: true, targetSeconds: 60, maxClipsPerScene: 3, characterVoices: {} };
const scenes = [1, 2].map(order => ({ _id: `scene-${order}`, order, title: order === 1 ? "A new perspective" : "The discovery", approved: true, imagePrompt: "Original illustrated city", videoMotionPrompt: "Gentle camera movement", narration: "An original story begins.", dialogue: "", characters: [] }));
const project = { _id: projectId, title: "The Quiet City", summary: "A two-scene original story.", approvedAt: new Date().toISOString(), scenes };
const config = {
  projects: [project], characters: [],
  imageModels: [{ id: settings.imageModel, resolutions: ["1K", "2K"], aspectRatios: ["16:9", "9:16"], maxImages: 4 }],
  videoModels: [{ id: settings.videoModel, qualities: ["720p", "1080p"], durations: [8], aspectRatios: ["16:9", "9:16"], maxQuantity: 1 }],
  voiceModels: [{ id: settings.voiceModel, voices: ["Kore", "Puck"], languages: ["English"], styles: ["cinematic"], multiSpeaker: true }],
  readiness: { queueEnabled: true, storageConfigured: true, providerConfigured: true, workerOnline: true }
};

async function mockApi(page: Page, completed = false) {
  const niches: any[] = [];
  const requests: string[] = [];
  const production: any = { _id: productionId, projectId, title: project.title, status: completed ? "completed" : "draft", settings, snapshot: { ...project, characters: [], niche: { name: "Original stories" } }, steps: scenes.map(scene => ({ key: `${scene._id}-image`, sceneId: scene._id, label: `Scene ${scene.order}: image`, kind: "image", status: completed ? "completed" : "pending", assetId: completed ? `asset-${scene.order}` : undefined, credits: 3, charged: completed })), estimate: { credits: 6, images: 2, audioSegments: 0, maxClips: 0, maxVideoSeconds: 0, missingPricing: [], coverage: "Still-image test production." }, expiresAt: new Date(Date.now() + 600000).toISOString(), createdAt: new Date().toISOString(), maxCredits: completed ? 6 : 0,
    timeline: completed ? scenes.map((scene, index) => ({ sceneId: scene._id, order: scene.order, title: scene.title, startSeconds: index * 2, durationSeconds: 2, imageAssetId: `asset-${scene.order}`, clips: [], audio: [] })) : [] };
  const assets = completed ? scenes.map(scene => ({ _id: `asset-${scene.order}`, type: "image" })) : [];
  const editorId = "e11111111111111111111111";
  const editorTimeline = { clips: scenes.map(scene => ({ id: scene._id, sceneId: scene._id, kind: "image", assetId: `asset-${scene.order}`, label: scene.title, sourceIn: 0, duration: 2, transition: "cut", fit: "contain", text: "", textStyle: { font: "Arial", size: 36, position: "bottom", preset: "clean" } })), audio: [], captions: [], aspectRatio: "16:9", musicDecision: "none" };
  const edit = { _id: editorId, productionId, projectId, title: project.title, revision: 0, timeline: editorTimeline };
  // All APIs are intercepted. These browser tests never spend real credits or call providers.
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    requests.push(`${method} ${path}`);
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": request.headers().origin || "http://localhost:5173", "access-control-allow-credentials": "true", "access-control-allow-headers": "content-type,x-csrf-token", "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE" } });
    let data: any = {};
    if (path === "/api/auth/me") data = { user: { id: "test", displayName: "Studio Tester", email: "tester@example.test", emailVerified: true, status: "active", onboarding: { completed: true } } };
    else if (path === "/api/publishing/dashboard") data = { exports: [], projects: [], drafts: [], account: null, history: [], platforms: [{ id: "youtube", label: "YouTube", mode: "oauth", ratio: "16:9" }] };
    else if (path === "/api/editor/config") data = { productions: [], edits: [] };
    else if (path === "/api/editor/edits") data = { edit };
    else if (path === `/api/editor/edits/${editorId}`) data = { edit, assets, exports: [], readiness: { queueEnabled: false, workerOnline: false, storageConfigured: false } };
    else if (path.startsWith("/api/editor/assets/")) data = { url: "/assets/drex-ai-references.png" };
    else if (path === "/api/studio/config") data = config;
    else if (path === "/api/studio/productions") data = { productions: [production] };
    else if (path.endsWith("/events")) return route.fulfill({ contentType: "text/event-stream", body: ": test connection\n\n" });
    else if (path === "/api/studio/plans") data = { production };
    else if (path.endsWith("/approve")) { production.status = "queued"; production.maxCredits = request.postDataJSON().maxCredits; data = { production }; }
    else if (path.endsWith("/control")) { production.status = "cancelled"; data = { production }; }
    else if (path.startsWith("/api/studio/assets/")) data = { url: "/assets/drex-ai-references.png" };
    else if (path.startsWith("/api/studio/productions/")) data = { production, assets, events: [{ _id: "event-1", createdAt: new Date().toISOString(), level: completed ? "success" : "waiting", message: completed ? "Your video production is ready for review." : "Plan ready for approval." }] };
    else if (path === "/api/ai/niches") {
      if (method === "POST") niches.push({ ...request.postDataJSON(), _id: String(niches.length + 1) });
      data = { niches };
    } else if (path.startsWith("/api/ai/niches/")) {
      const id = path.split("/")[4]; const index = niches.findIndex(n => n._id === id);
      if (method === "PATCH") niches[index] = { ...niches[index], ...request.postDataJSON() };
      if (path.endsWith("/select")) niches.forEach(n => n.selected = n._id === id);
      if (path.endsWith("/duplicate")) niches.push({ ...niches[index], name: niches[index].name + " copy", _id: "copy", selected: false });
      if (method === "DELETE") niches.splice(index, 1);
    }
    else if (path === "/api/ai/projects") data = { projects: [project] };
    else if (path.startsWith("/api/ai/projects/")) data = { project };
    else if (path === "/api/images/config") data = { models: config.imageModels, stylePresets: ["Cinematic"], characters: [] };
    else if (path === "/api/videos/config") data = { models: config.videoModels, images: [] };
    else if (path === "/api/voice/config") data = { models: config.voiceModels, projects: [project] };
    else if (path.endsWith("/jobs") || path === "/api/voice/library") data = { jobs: [], assets: [] };
    else if (path === "/api/youtube/config") data = { configured: true, connection: null };
    else if (path === "/api/youtube/collections") data = { collections: [], history: [] };
    else if (path.startsWith("/api/youtube/")) data = { items: [] };
    else if (path === "/api/account/sessions") data = { sessions: [] };
    else if (path === "/api/wallet") data = { wallet: { availableCredits: 100 }, packages: [], payments: [], ledger: [] };
    return route.fulfill({ json: data });
  });
  return { requests, production, niches };
}

const features = ["youtube-research", "youtube-channel", "ai-assistant", "my-niches", "script-builder", "text-to-image", "image-to-video", "voice-studio", "ai-studio", "video-editor", "projects", "media-library", "publishing", "credit-wallet", "notifications", "support", "feedback", "settings"];
for (const width of [390, 1024, 1440, 1920]) test(`all workspaces close and fit at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 1000 }); await mockApi(page);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  for (const slug of features) {
    await page.goto(`/dashboard/${slug}`);
    await expect(page.getByRole("link", { name: "Close workspace", exact: true })).toBeVisible();
    await expect(page.locator(".feature-workspace")).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth), { message: `${slug} overflows at ${width}px` }).toBeLessThanOrEqual(1);
    if (["my-niches", "ai-studio", "youtube-research"].includes(slug)) await page.screenshot({ path: testInfo.outputPath(`${slug}-${width}.png`) });
    await page.getByRole("link", { name: "Close workspace", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  }
  expect(errors).toEqual([]);
});

test("browse, customize, save, select, duplicate, and delete niches", async ({ page }, testInfo) => {
  await mockApi(page); await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/dashboard/my-niches");
  await expect(page.locator("article")).toHaveCount(36);
  await page.getByLabel("Niche category").selectOption("Technology");
  expect(await page.locator("article").count()).toBeGreaterThan(0);
  expect(await page.locator("article").count()).toBeLessThan(36);
  await page.getByRole("button", { name: "Use idea" }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill("My original niche");
  await page.screenshot({ path: testInfo.outputPath("niche-editor.png"), fullPage: true });
  await page.getByRole("button", { name: "Save niche" }).click();
  await expect(page.getByRole("heading", { name: "My original niche" })).toBeVisible();
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await expect(page.getByRole("button", { name: "Selected", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Duplicate My original niche", exact: true }).click();
  await expect(page.locator("article")).toHaveCount(2);
  page.on("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Delete My original niche copy", exact: true }).click();
  await expect(page.locator("article")).toHaveCount(1);
});

test("production requires approval and restores its state on reload", async ({ page }, testInfo) => {
  const state = await mockApi(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/dashboard/ai-studio?projectId=${projectId}`);
  await page.getByRole("button", { name: "Prepare estimate" }).click();
  await expect(page.getByRole("region", { name: "Production quote" })).toBeVisible();
  expect(state.requests.some(r => r.endsWith("/approve"))).toBe(false);
  await page.getByLabel("Approved spending limit").fill("5");
  await expect(page.getByRole("button", { name: "Approve & start" })).toBeDisabled();
  await page.getByLabel("Approved spending limit").fill("6");
  await page.screenshot({ path: testInfo.outputPath("studio-quote.png"), fullPage: true });
  await page.getByRole("button", { name: "Approve & start" }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Pause pending", exact: true })).toBeVisible();
  await expect(page.getByRole("log")).toContainText("Plan ready for approval.");
});

test("completed rough cut plays and hands off the same production", async ({ page }, testInfo) => {
  await mockApi(page, true); await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/dashboard/ai-studio?productionId=${productionId}`);
  await page.getByRole("button", { name: "Preview rough cut", exact: true }).click();
  await page.getByRole("button", { name: "Play rough cut", exact: true }).click();
  await expect.poll(async () => Number(await page.getByLabel("Preview position").inputValue())).toBeGreaterThan(0.5);
  await page.getByRole("button", { name: "Pause preview" }).click();
  await page.screenshot({ path: testInfo.outputPath("studio-preview.png"), fullPage: true });
  await page.getByRole("link", { name: "Continue to Editor" }).click();
  await expect(page).toHaveURL(/video-editor\?(?:productionId|editId)=/);
  await expect(page.getByRole("region", { name: "Rough cut preview" })).toBeVisible();
});

test("rough cut synchronizes playable video and measured audio", async ({ page }) => {
  const state = await mockApi(page, true);
  await page.goto("/dashboard/ai-studio");
  const webm = await page.evaluate(async () => {
    const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 180;
    const ctx = canvas.getContext("2d")!;
    const stream = canvas.captureStream(15);
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
    const chunks: BlobPart[] = [];
    const result = new Promise<string>(resolve => {
      recorder.ondataavailable = event => chunks.push(event.data);
      recorder.onstop = () => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.readAsDataURL(new Blob(chunks, { type: "video/webm" })); stream.getTracks().forEach(track => track.stop()); };
    });
    recorder.start(); let frame = 0;
    const timer = setInterval(() => { ctx.fillStyle = frame++ % 2 ? "#168278" : "#f9f9f9"; ctx.fillRect(0, 0, 320, 180); }, 60);
    await new Promise(resolve => setTimeout(resolve, 2300)); clearInterval(timer); recorder.stop(); return result;
  });
  const wav = Buffer.alloc(44 + 96000);
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(96000, 40);
  state.production.timeline[0].clips = [{ assetId: "video", startSeconds: 0, durationSeconds: 2 }];
  state.production.timeline[0].audio = [{ assetId: "audio", startSeconds: 0, durationSeconds: 2 }];
  await page.route(`**/api/studio/productions/${productionId}`, route => route.fulfill({ json: { production: state.production, assets: [{ _id: "asset-1", type: "image" }, { _id: "asset-2", type: "image" }, { _id: "video", type: "video" }, { _id: "audio", type: "audio" }], events: [] } }));
  await page.route("**/api/studio/assets/video/url", route => route.fulfill({ json: { url: "data:video/webm;base64," + webm } }));
  await page.route("**/api/studio/assets/audio/url", route => route.fulfill({ json: { url: "data:audio/wav;base64," + wav.toString("base64") } }));
  await page.goto(`/dashboard/ai-studio?productionId=${productionId}`);
  await page.getByRole("button", { name: "Preview rough cut", exact: true }).click();
  await page.getByRole("button", { name: "Play rough cut", exact: true }).click();
  const preview = page.getByRole("region", { name: "Rough cut preview" });
  await expect.poll(() => preview.locator("video").evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0.2);
  await expect.poll(() => preview.locator("audio").evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(0.2);
  expect(await preview.locator("audio").evaluate((audio: HTMLAudioElement) => audio.duration)).toBe(2);
  await expect(page.getByLabel("Preview position")).toHaveValue("4", { timeout: 10000 });
});

for (const width of [390, 1440]) test(`video upload, quote approval, and result zones at ${width}px`, async ({ page }, testInfo) => {
  await mockApi(page); await page.setViewportSize({ width, height: 900 });
  let uploaded = false, generation: any = null;
  const asset = { _id: "c11111111111111111111111", url: "/assets/drex-ai-references.png", width: 1536, height: 1024, metadata: { name: "Scene reference.png" } };
  await page.route("**/api/videos/config", route => route.fulfill({ json: { models: config.videoModels, images: uploaded ? [asset] : [] } }));
  await page.route("**/api/videos/source-images", route => { expect(route.request().headers()["content-type"]).toBe("image/png"); uploaded = true; return route.fulfill({ status: 201, json: { asset } }); });
  await page.route("**/api/videos/quote", route => route.fulfill({ json: { quote: { credits: 6 } } }));
  await page.route("**/api/videos/generate", route => { generation = route.request().postDataJSON(); return route.fulfill({ status: 202, json: { job: { _id: "job-1", status: "queued" } } }); });
  await page.route("**/api/videos/jobs", route => route.fulfill({ json: { assets: [], jobs: generation ? [{ _id: "job-1", status: "queued", model: settings.videoModel, motionPrompt: generation.motionPrompt, approvedCredits: 6 }] : [] } }));
  await page.goto("/dashboard/image-to-video");
  await expect(page.getByRole("textbox", { name: /URL/i })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Result preview" })).toBeVisible();
  await page.getByLabel("Upload source image").setInputFiles({ name: "bad.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg />") });
  await expect(page.getByRole("alert")).toContainText("PNG, JPEG, or WebP");
  expect(uploaded).toBe(false);
  await page.getByLabel("Upload source image").setInputFiles({ name: "Scene reference.png", mimeType: "image/png", buffer: await readFile(new URL("../public/assets/drex-ai-references.png", import.meta.url)) });
  await expect(page.getByAltText("Selected source image")).toBeVisible();
  await expect.poll(() => page.getByAltText("Selected source image").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await page.getByLabel("Motion prompt").fill("A gentle cinematic camera movement.");
  await page.getByRole("button", { name: "Preview cost", exact: true }).click();
  expect(generation).toBeNull();
  await expect(page.getByRole("button", { name: "Generate / 6 credits" })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath(`video-upload-${width}.png`), fullPage: true });
  await page.getByRole("button", { name: "Generate / 6 credits" }).click();
  await expect.poll(() => generation?.sourceImageAssetId).toBe(asset._id);
  expect(generation.sourceImageUrl).toBeUndefined(); expect(generation.approvedCredits).toBe(6);
  await expect(page.getByRole("heading", { name: "Generation in progress" })).toBeVisible();
  await page.getByRole("tab", { name: "History (1)" }).click();
  await expect(page.locator(".job-list")).toContainText("queued");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});
