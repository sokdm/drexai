import { test, expect, Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const editId = "e22222222222222222222222", projectId = "a22222222222222222222222", productionId = "b22222222222222222222222";
const videoId = "c22222222222222222222222", imageId = "d22222222222222222222222", audioId = "f22222222222222222222222";
const textStyle = { font: "Arial", size: 36, position: "bottom", preset: "clean" };
async function editorApi(page: Page) {
  const timeline = { clips: [
    { id: "first", sceneId: "scene1", kind: "video", assetId: videoId, label: "Opening shot", sourceIn: 0, duration: 2, transition: "cut", fit: "contain", text: "", textStyle },
    { id: "still", sceneId: "scene2", kind: "image", assetId: imageId, label: "Closing still", sourceIn: 0, duration: 3, transition: "cut", fit: "contain", text: "", textStyle },
  ], audio: [], captions: [], aspectRatio: "16:9", musicDecision: "pending" };
  const edit: any = { _id: editId, projectId, productionId, title: "Editor test project", revision: 0, timeline };
  const assets = [{ _id: videoId, type: "video", width: 854, height: 480, durationSeconds: 6.5, metadata: { name: "Original clip" } }, { _id: imageId, type: "image", width: 854, height: 480, metadata: { name: "Original still" } }, { _id: audioId, type: "audio", durationSeconds: 6, metadata: { name: "Original music", licenseConfirmed: true } }];
  const video = await readFile(new URL("../../backend/test-artifacts/phase10-final.mp4", import.meta.url));
  const image = await readFile(new URL("../../backend/test-artifacts/phase10-caption-preview.png", import.meta.url));
  const requests: string[] = [], exports: any[] = []; let savedProject = false;
  await page.route("**/editor-test-video.mp4", route => route.fulfill({ contentType: "video/mp4", body: video }));
  await page.route("**/editor-test-image.png", route => route.fulfill({ contentType: "image/png", body: image }));
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method(); requests.push(`${method} ${path}`);
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": request.headers().origin || "http://localhost:5173", "access-control-allow-credentials": "true", "access-control-allow-headers": "content-type,x-csrf-token", "access-control-allow-methods": "GET,POST,PUT,OPTIONS" } });
    let data: any = {};
    if (path === "/api/auth/me") data = { user: { id: "test", displayName: "Editor Tester", email: "editor@example.test", status: "active", emailVerified: true, onboarding: { completed: true } } };
    else if (path === "/api/editor/config") data = { productions: [{ _id: productionId, title: edit.title }], edits: [{ ...edit }] };
    else if (path === "/api/editor/edits") data = { edit };
    else if (path === `/api/editor/edits/${editId}`) {
      if (method === "PUT") { const body = request.postDataJSON(); expect(body.revision).toBe(edit.revision); edit.timeline = body.timeline; edit.revision++; data = { edit }; }
      else data = { edit, assets, exports, readiness: { queueEnabled: true, storageConfigured: true, workerOnline: true } };
    } else if (path.endsWith("/captions")) data = { captions: [{ id: "caption", text: "An original caption.", start: 0.2, end: 1.2, style: textStyle }], note: "Estimated phrase timing; review before export." };
    else if (path.endsWith("/suggestions")) data = { suggestions: [{ id: "fade", clipId: "first", label: "Fade the opening shot", reason: "Separate the opening scene", patch: { transition: "fade" } }] };
    else if (path.includes("/api/editor/assets/")) data = { url: path.includes(imageId) ? "/editor-test-image.png" : "/editor-test-video.mp4" };
    else if (path === `/api/editor/edits/${editId}/exports`) { const body = request.postDataJSON(); expect(body.revision).toBe(edit.revision); const job = { _id: "122222222222222222222222", editId, revision: body.revision, settings: body.settings, status: "queued", progress: 0 }; exports.unshift(job); data = { export: job }; }
    else if (path.endsWith("/download")) return route.fulfill({ contentType: "video/mp4", headers: { "content-disposition": 'attachment; filename="editor-export.mp4"' }, body: video });
    else if (path.endsWith("/save")) { savedProject = true; data = {}; }
    else if (path.includes("/api/editor/exports/")) { Object.assign(exports[0], { status: "completed", progress: 100, duration: 6.5, width: 854, height: 480, url: "/editor-test-video.mp4" }); data = { export: exports[0] }; }
    return route.fulfill({ json: data });
  });
  return { edit, requests, get savedProject() { return savedProject; } };
}

for (const width of [390, 1440]) test(`Phase 10 timeline edits, save/resume, captions and MP4 controls at ${width}px`, async ({ page }, testInfo) => {
  test.setTimeout(180000);
  const state = await editorApi(page); const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(theme => localStorage.setItem("theme", theme), width === 390 ? "light" : "dark");
  await page.setViewportSize({ width, height: 1000 }); await page.goto(`/dashboard/video-editor?editId=${editId}`);
  await expect(page.getByRole("region", { name: "Background music choice" })).toBeVisible();
  await page.getByRole("button", { name: "Continue without music", exact: true }).click();
  await page.getByRole("button", { name: "Select clip 1: Opening shot", exact: true }).click();
  await page.getByLabel("Source in (seconds)", { exact: true }).fill("0.1");
  await page.getByLabel("Clip duration (seconds)", { exact: true }).fill("1.8");
  await page.getByLabel("Preview position").fill("0.8");
  await page.getByRole("button", { name: "Split at playhead", exact: true }).click();
  await expect(page.locator(".editor-timeline-clip")).toHaveCount(3);
  await page.getByRole("button", { name: "Undo edit" }).click(); await expect(page.locator(".editor-timeline-clip")).toHaveCount(2);
  await page.getByRole("button", { name: "Redo edit" }).click(); await expect(page.locator(".editor-timeline-clip")).toHaveCount(3);
  await page.getByRole("button", { name: "Select clip 3: Closing still" }).click();
  await page.getByLabel("Image duration (seconds)").fill("2.5");
  await page.getByRole("button", { name: "Earlier", exact: true }).click();
  await expect(page.locator(".editor-timeline-clip").nth(1)).toContainText("Closing still");
  await page.getByRole("button", { name: "Intro", exact: true }).click(); await expect(page.locator(".editor-timeline-clip")).toHaveCount(4);
  await page.getByLabel("Title text", { exact: true }).fill("My original intro", { timeout: 10000 });
  await page.getByRole("button", { name: "Save timeline", exact: true }).click();
  await expect(page.getByText("Timeline saved", { exact: true })).toBeVisible();
  expect(state.edit.timeline.clips[0].text).toBe("My original intro"); expect(state.edit.timeline.musicDecision).toBe("none");
  await page.reload(); await expect(page.locator(".editor-timeline-clip")).toHaveCount(4);
  await page.getByRole("button", { name: "captions", exact: true }).click(); await page.getByRole("button", { name: "Generate captions", exact: true }).click();
  await page.locator(".editor-caption-item").filter({ hasText: "An original caption." }).click(); await page.getByLabel("Caption text", { exact: true }).fill("Edited caption");
  await page.getByLabel("Font", { exact: true }).selectOption("Georgia"); await page.getByLabel("Text position", { exact: true }).selectOption("top");
  await page.getByLabel("Canvas", { exact: true }).selectOption("9:16");
  await expect(page.locator(".editor-overlay").first()).toBeVisible();
  expect(await page.locator(".editor-overlay").first().evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThan(5);
  await page.screenshot({ path: testInfo.outputPath(`phase10-editor-${width}.png`), fullPage: true });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  const screen = await page.locator(".editor-screen").boundingBox(); expect(screen!.width / screen!.height).toBeCloseTo(9 / 16, 1);
  await page.getByLabel("Output resolution", { exact: true }).selectOption("480p");
  await page.getByRole("button", { name: /Export 480 × 854/ }).click();
  await expect(page.getByText("Your finished video is ready", { exact: false })).toBeVisible();
  expect(state.edit.timeline.captions[0].text).toBe("Edited caption");
  await page.getByRole("button", { name: "Save to project", exact: true }).click(); await expect.poll(() => state.savedProject).toBe(true);
  const downloadPromise = page.waitForEvent("download"); await page.getByRole("button", { name: "Download MP4", exact: true }).click(); const download = await downloadPromise; expect(download.suggestedFilename()).toBe("editor-export.mp4");
  await expect(page.getByRole("link", { name: "Continue to Publishing Tools" })).toHaveAttribute("href", /exportId=/);
  expect(errors).toEqual([]);
});

test("editor previews real MP4 playback and reorders clips by drag and drop", async ({ page }) => {
  test.setTimeout(120000); const state = await editorApi(page); await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto(`/dashboard/video-editor?editId=${editId}`);
  await page.getByRole("button", { name: "Continue without music" }).click();
  await expect.poll(() => page.locator(".editor-frame video").evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(3);
  await page.getByRole("button", { name: "Play rough cut", exact: true }).click(); await expect.poll(async () => Number(await page.getByLabel("Preview position").inputValue()), { timeout: 15000 }).toBeGreaterThan(0.4); await page.getByRole("button", { name: "Pause preview", exact: true }).click();
  await page.getByRole("button", { name: "Select clip 2: Closing still" }).dragTo(page.getByRole("button", { name: "Select clip 1: Opening shot" }));
  await page.getByRole("button", { name: "Save timeline", exact: true }).click(); await expect.poll(() => state.edit.timeline.clips[0].id).toBe("still");
});

test("image and video overlays share preview, timeline and saved edit",async({page})=>{
 const state=await editorApi(page);await page.goto("/dashboard/video-editor?editId="+editId);
 await page.getByRole("button",{name:"Continue without music",exact:true}).click();
 await page.getByRole("button",{name:"overlays",exact:true}).click();
 await page.getByRole("button",{name:"Overlay Original clip",exact:true}).click();
 await expect(page.getByLabel("Overlay: Original clip",{exact:true})).toBeAttached();
 await expect(page.locator(".editor-caption-track").filter({hasText:"Overlay 1"})).toBeVisible();
 await page.getByRole("button",{name:"Save timeline",exact:true}).click();
 await page.reload();await expect(page.getByLabel("Overlay: Original clip",{exact:true})).toBeAttached();
 await page.getByRole("button",{name:"overlays",exact:true}).click();await page.getByRole("button",{name:"Remove overlay",exact:true}).click();
 await expect(page.getByLabel("Overlay: Original clip",{exact:true})).toHaveCount(0);
});

test('stalled preview stops with a recovery message instead of buffering forever',async({page})=>{
 await editorApi(page);await page.goto('/dashboard/video-editor?editId='+editId);
 await page.getByRole('button',{name:'Continue without music',exact:true}).click();
 await expect.poll(()=>page.locator('.editor-frame video').evaluate((v:HTMLVideoElement)=>v.readyState)).toBeGreaterThanOrEqual(3);
 await page.getByRole('button',{name:'Play rough cut',exact:true}).click();
 await page.locator('.editor-frame video').evaluate((v:HTMLVideoElement)=>{v.play=()=>new Promise<void>(()=>{});v.pause();v.dispatchEvent(new Event('waiting'));});
 await expect(page.getByText(/Buffering/)).toBeVisible();
 await expect(page.getByText(/Video loading stalled/)).toBeVisible({timeout:22000});
 await expect(page.getByRole('button',{name:'Play rough cut',exact:true})).toBeVisible();
});

for(const width of [390,1024,1440])test('editor workspace stays bounded at '+width+'px',async({page})=>{
 await page.setViewportSize({width,height:900});await editorApi(page);await page.goto('/dashboard/video-editor?editId='+editId);await page.getByRole('button',{name:'Continue without music',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 if(width>=1000){const body=await page.locator('.editor-body').boundingBox(),timeline=await page.getByRole('region',{name:'Editing timeline',exact:true}).boundingBox();expect(body!.height).toBeLessThan(820);expect(timeline!.y+timeline!.height).toBeLessThanOrEqual(900);}
 await page.getByRole('button',{name:'effects',exact:true}).click();await expect(page.getByRole('button',{name:'Smooth all joins',exact:true})).toBeVisible();await page.getByRole('button',{name:'Smooth all joins',exact:true}).click();await page.getByRole('button',{name:'Select clip 1: Opening shot',exact:true}).click();await expect(page.getByLabel('Transition',{exact:true})).toHaveValue('dissolve');await page.screenshot({path:'frontend/test-results/editor-workspace-'+width+'.png',fullPage:true});
});

test('editor assistant sends on Enter, clears composer, applies a real proposal and restores conversation',async({page})=>{
 const state=await editorApi(page);let calls=0;await page.route('**/api/editor/edits/'+editId+'/command',route=>{calls++;const body=route.request().postDataJSON();expect(body.message).toBe('Smooth the joins');const explanation='Applied dissolve joins without shifting audio.';state.edit.assistantMessages=['You: '+body.message,explanation];return route.fulfill({json:{timeline:{...body.timeline,clips:body.timeline.clips.map((c:any,i:number)=>({...c,transition:i===0?'dissolve':'cut'}))},explanation,note:'Review or save the change.'}});});
 await page.goto('/dashboard/video-editor?editId='+editId);await page.getByRole('button',{name:'Continue without music',exact:true}).click();await page.getByLabel('Editing command',{exact:true}).fill('Smooth the joins');await page.getByLabel('Editing command',{exact:true}).press('Enter');await expect(page.getByLabel('Editing command',{exact:true})).toHaveValue('');await expect(page.getByRole('log')).toContainText('Applied dissolve');expect(calls).toBe(1);await page.getByRole('button',{name:'Select clip 1: Opening shot',exact:true}).click();await expect(page.getByLabel('Transition',{exact:true})).toHaveValue('dissolve');await page.reload();await expect(page.getByRole('log')).toContainText('Applied dissolve');
});
