import { test, expect } from "@playwright/test";
for (const width of [390, 1440]) test(`saved settings, errors and device controls at ${width}px`, async ({ page }) => {
 await page.setViewportSize({ width, height: 1000 });
 const user: any = { id: "customer", displayName: "Customer", email: "customer@example.test", status: "active", emailVerified: true, onboarding: { completed: true }, preferences: { appearance: "system", supportEmails: true } };
 let fail = false, revoked = false, saved: any;
 await page.route("**/api/**", route => {
  const req = route.request(), p = new URL(req.url()).pathname; let data: any = {};
  if (p === "/api/auth/me") data = { user };
  else if (p === "/api/wallet") data = { wallet: { availableCredits: 500, reservedCredits: 0 } };
  else if (p === "/api/account/sessions") data = { sessions: [{ _id: "current", userAgent: "This browser", current: true, createdAt: new Date().toISOString() }, ...(!revoked ? [{ _id: "other", userAgent: "Other browser", current: false, createdAt: new Date().toISOString() }] : [])] };
  else if (p === "/api/account/sessions/other") { revoked = true; data = { ok: true }; }
  else if (p === "/api/account/profile") { if (fail) return route.fulfill({ status: 503, json: { error: "Settings service unavailable" } }); saved = req.postDataJSON(); Object.assign(user, { displayName: saved.displayName, preferences: saved.preferences }); data = { user }; }
  return route.fulfill({ json: data });
 });
 await page.goto("/dashboard/settings"); await page.getByLabel("Display name", { exact: true }).fill("Updated Customer");
 await page.getByLabel("Support reply emails").uncheck(); await page.getByRole("combobox", { name: "Appearance", exact: true }).selectOption("light");
 await page.getByRole("button", { name: "Save settings", exact: true }).click(); await expect(page.getByRole("status")).toHaveText("Settings saved");
 expect(saved.profilePictureUrl).toBe(""); expect(saved.preferences.supportEmails).toBe(false);
 await page.reload(); await expect(page.getByLabel("Display name", { exact: true })).toHaveValue("Updated Customer"); await expect(page.getByLabel("Support reply emails")).not.toBeChecked();
 await page.getByRole("button", { name: "Sign out this device", exact: true }).click(); await expect(page.getByText("Other browser", { exact: true })).toHaveCount(0);
 fail = true; await page.getByRole("button", { name: "Save settings", exact: true }).click(); await expect(page.getByRole("alert")).toHaveText("Settings service unavailable"); await expect(page.getByText("Settings saved", { exact: true })).toHaveCount(0);
 await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});
test("existing admin has wallet records and accurate missing-provider status", async ({ page }) => {
 const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
 await page.route("**/api/**", route => {
  const p = new URL(route.request().url()).pathname; let data: any = {};
  if (p === "/api/auth/me") data = { user: null };
  else if (p === "/api/admin/me") data = { user: { displayName: "Admin", role: "admin" } };
  else if (p === "/api/admin/operations/wallets") data = { rows: [{ customer: "customer@example.test", availableCredits: 1250, reservedCredits: 0 }] };
  else if (p === "/api/admin/provider-account") data = { stale: true, balance: { error: "Management key required. Add OPENROUTER_MANAGEMENT_KEY privately in Render." }, instructions: "Keys stay server-side." };
  else if (p === "/api/admin/provider-usage") data = { daily: [], models: [], providerActivity: [], note: "Local usage and account activity are separate." };
  return route.fulfill({ json: data });
 });
 await page.goto("/admin?section=Wallets"); await expect(page.getByText("1250", { exact: true })).toBeVisible();
 await page.getByRole("navigation", { name: "Admin sections" }).getByRole("button", { name: "OpenRouter", exact: true }).click();
 await expect(page.getByText(/Management key required/)).toBeVisible(); await expect(page.getByText("Some records are stale or unavailable.")).toBeVisible(); expect(errors).toEqual([]);
});
