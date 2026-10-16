import { test, expect } from "@playwright/test";
for (const kind of ["image", "video"] as const) test(`${kind} save downloads without opening another tab`, async ({ page }) => {
 const id = "a11111111111111111111111", plural = kind === "image" ? "images" : "videos";
 await page.route("**/api/**", route => {
  const p = new URL(route.request().url()).pathname; let data: any = {};
  if (p === "/api/auth/me") data = { user: { id: "customer", displayName: "Customer", email: "customer@example.test", status: "active", emailVerified: true, onboarding: { completed: true } } };
  else if (p === `/api/${plural}/config`) data = { models: [], stylePresets: [], characters: [], images: [] };
  else if (p === `/api/${plural}/jobs`) data = { jobs: [], assets: [{ _id: id, prompt: "Saved output", contentType: kind === "image" ? "image/png" : "video/mp4" }] };
  else if (p.endsWith("/download")) return route.fulfill({ contentType: kind === "image" ? "image/png" : "video/mp4", body: Buffer.from("download-test-bytes") });
  else if (p.endsWith("/url")) data = { url: "" };
  return route.fulfill({ json: data });
 });
 await page.goto(`/dashboard/${kind === "image" ? "text-to-image" : "image-to-video"}`);
 const tabs = page.context().pages().length;
 const download = page.waitForEvent("download");
 await page.getByRole("button", { name: "Download result", exact: true }).click();
 expect((await download).suggestedFilename()).toBe(`drex-${kind}-${id}.${kind === "image" ? "png" : "mp4"}`);
 expect(page.context().pages().length).toBe(tabs);
 await expect(page.getByText("Download started.", { exact: true })).toBeVisible();
});
