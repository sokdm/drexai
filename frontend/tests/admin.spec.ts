import { test, expect, Page } from "@playwright/test";
async function setup(page: Page) {
  const state = { signedIn: false, maintenance: false, packageUpdates: [] as any[], pricingUpdates: [] as any[], policies: [] as any[], controls: [] as any[], adjustments: [] as any[] };
  const userId = "a11111111111111111111111";
  await page.route("**/api/**", route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname;
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": req.headers().origin || "http://localhost:5174", "access-control-allow-credentials": "true", "access-control-allow-headers": "content-type,x-admin-csrf,x-csrf-token", "access-control-allow-methods": "GET,POST,PATCH,PUT" } });
    let data: any = {};
    if (p === "/api/platform-status") data = { maintenance: state.maintenance && !state.signedIn, message: "Scheduled platform improvements are underway." };
    else if (p === "/api/auth/me") data = { user: null };
    else if (p === "/api/admin/me") { if (!state.signedIn) return route.fulfill({ status: 401, json: { error: "Administrator sign-in required" } }); data = { user: { _id: "admin", displayName: "Administrator", email: "admin@example.test", role: "admin" } }; }
    else if (p === "/api/admin/login-options") data = { method: "totp" };
    else if (p === "/api/admin/login") { const b = req.postDataJSON(); if (b.code !== "123456") return route.fulfill({ status: 401, json: { error: "Invalid administrator credentials or authentication code" } }); state.signedIn = true; data = { user: { id: "admin", displayName: "Administrator", email: b.email }, csrf: "test-csrf" }; }
    else if (p === "/api/admin/logout") { state.signedIn = false; data = { ok: true }; }
    else if (p === "/api/admin/overview") data = { totalUsers: 12, newUsers: 3, activeUsers: 4, suspendedUsers: 1, revenue: { USD: 65, NGN: 5000 }, creditsSold: 6000, consumed: 100, refunded: 4, liabilities: 5900, estimatedExpenses: 2, verifiedExpenses: null, estimatedMarginPct: 96.9, estimatedCreditUsageRevenueUsd: 1.08, liabilityEstimatedUsd: 63.92, costCoverage: { estimatedReservations: 2, totalReservations: 4 }, storageBytes: 1048576, jobs: [{ kind: "image", statuses: [{ _id: "completed", count: 5 }, { _id: "failed", count: 1 }] }], daily: [{ day: "2026-10-15", revenueUsd: 15, consumed: 20, estimatedCostUsd: 1 }, { day: "2026-10-16", revenueUsd: 50, consumed: 80, estimatedCostUsd: 1 }], costGroups: { provider: [{ label: "gemini", estimatedUsd: 2, reservations: 2, failedOrReleasedUsd: 1 }] }, limitations: ["No verified provider billing records are integrated; actual expenses are unavailable."] };
    else if (p === "/api/admin/configuration") data = { packages: [{ key: "starter", name: "Starter", credits: 1000, amount: 15, currency: "USD", active: true, sortOrder: 1, promotion: "" }], rules: [], providers: [], controls: null, catalog: [{ provider: "gemini", model: "gemini-nano-banana-2.1", configured: true, type: "image" }] };
    else if (p === "/api/admin/packages") { state.packageUpdates.push(req.postDataJSON()); data = { ok: true }; }
    else if (p === "/api/admin/pricing") { state.pricingUpdates.push(req.postDataJSON()); data = { ok: true }; }
    else if (p === "/api/admin/providers") { state.policies.push(req.postDataJSON()); data = { ok: true }; }
    else if (p === "/api/admin/controls") { state.controls.push(req.postDataJSON()); state.maintenance = req.postDataJSON().maintenance; data = { ok: true }; }
    else if (p === "/api/admin/users") data = { users: [{ _id: userId, displayName: "Customer", email: "customer@example.test", role: "user", status: "active", aiRestricted: false }] };
    else if (p === `/api/admin/users/${userId}`) data = { user: { _id: userId, displayName: "Customer", email: "customer@example.test", role: "user", status: "active" }, wallet: { availableCredits: 100, reservedCredits: 0 }, ledger: [], support: [], feedback: [], jobs: [] };
    else if (p.endsWith("/adjust")) { state.adjustments.push(req.postDataJSON()); data = { ok: true }; }
    else if (p === "/api/admin/jobs") data = { jobs: [{ _id: "job1", userId, status: "processing", model: "test-image", estimatedCostUsd: .02, verifiedCostUsd: null, attempts: 1 }] };
    else if (p.startsWith("/api/admin/reports/")) data = { rows: [] };
    else if (p === "/api/admin/support/config") data = { staff: true, categories: ["General inquiry"] };
    else if (p === "/api/admin/support/agents") data = { agents: [] };
    else if (p === "/api/admin/support/tickets") data = { tickets: [] };
    else if (p === "/api/admin/feedback/admin") data = { feedback: [] };
    return route.fulfill({ json: data });
  }); return state;
}
async function login(page: Page) { await page.goto("/admin"); await expect(page).toHaveURL(/\/admin\/login$/); await page.getByLabel("Administrator email").fill("admin@example.test"); await page.getByLabel("Password", { exact: true }).fill("test-password"); await page.getByLabel("Verification code").fill("123456"); await page.getByRole("button", { name: "Verify and sign in" }).click(); await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible(); }
for (const width of [390, 1440]) test(`Phase 13 secure admin navigation, reports and audited forms at ${width}px`, async ({ page }, info) => {
  const state = await setup(page), errors: string[] = []; page.on("pageerror", e => errors.push(e.message)); page.on("dialog", d => d.accept()); await page.setViewportSize({ width, height: 1000 }); await login(page);
  await expect(page.getByText("$65.00", { exact: true })).toBeVisible(); await expect(page.getByRole("img", { name: "Recorded revenue by day (USD)" })).toBeVisible(); await expect(page.getByText("No verified provider billing records are integrated; actual expenses are unavailable.")).toBeVisible();
  await page.getByRole("button", { name: "Packages", exact: true }).click(); await page.getByLabel("Package name", { exact: true }).fill("Starter promotion"); await page.getByLabel("Reason for change", { exact: true }).fill("Approved package promotional display update"); await page.getByRole("button", { name: "Save and audit change" }).click(); await expect(page.getByRole("status")).toContainText("saved and audited"); expect(state.packageUpdates[0].name).toBe("Starter promotion");
  await page.getByRole("button", { name: "Providers", exact: true }).click(); await page.getByLabel("Reason for policy change").fill("Set conservative provider admission limits"); await page.getByLabel("Maximum concurrent provider calls").fill("1"); await page.getByRole("button", { name: "Save and audit change" }).click(); await expect.poll(() => state.policies.length).toBe(1); expect(state.policies[0].maxConcurrent).toBe(1);
  await page.getByRole("button", { name: "Users", exact: true }).click(); await page.getByRole("button", { name: "View account" }).click(); await page.getByLabel("Documented reason").fill("Approved customer service goodwill credit"); await page.getByLabel("Credit adjustment", { exact: true }).fill("10"); await page.getByRole("button", { name: "Apply documented adjustment" }).click(); await expect.poll(() => state.adjustments.length).toBe(1); expect(state.adjustments[0].credits).toBe(10);
  await page.getByRole("button", { name: "Jobs", exact: true }).click(); await expect(page.locator(".admin-table")).toContainText("processing"); await expect(page.getByRole("button", { name: "Cancel eligible job" })).toHaveCount(0);
  await page.getByRole("button", { name: "Support", exact: true }).click(); await expect(page.getByRole("heading", { name: "Support administration", exact: true })).toBeVisible(); await page.getByRole("button", { name: "Feedback", exact: true }).click(); await expect(page.getByRole("heading", { name: "Feedback review", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Controls", exact: true }).click(); await page.getByLabel("Maintenance mode", { exact: true }).check(); await page.getByLabel("Reason for change", { exact: true }).fill("Approved scheduled maintenance window"); await page.getByRole("button", { name: "Apply platform controls" }).click(); await expect.poll(() => state.controls.length).toBe(1); expect(state.controls[0].maintenance).toBe(true);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1); expect(errors).toEqual([]); await page.screenshot({ path: info.outputPath(`admin-${width}.png`), fullPage: true });
});
test("maintenance shows a public screen while admin sign-in remains available", async ({ page }) => {
  const state = await setup(page); state.maintenance = true; await page.goto("/"); await expect(page.getByRole("heading", { name: "We’ll be back shortly" })).toBeVisible(); await page.getByRole("link", { name: "Administrator sign in" }).click(); await expect(page.getByLabel("Verification code")).toBeVisible();
});

test("email OTP sign-in requests a code before opening the administrator dashboard", async ({ page }) => {
  const state = await setup(page); let sent = false;
  await page.route("**/api/admin/login-options", route => route.fulfill({ json: { method: "email" } }));
  await page.route("**/api/admin/login", route => { const body = route.request().postDataJSON(); if (!body.challengeId) { sent = true; return route.fulfill({ json: { challengeId: "private-test-challenge", message: "A sign-in code has been sent to your administrator email." } }); } state.signedIn = true; return route.fulfill({ json: { user: { id: "admin", email: body.email } } }); });
  await page.goto("/admin/login"); await page.getByLabel("Administrator email").fill("admin@example.test"); await page.getByLabel("Password", { exact: true }).fill("test-password");
  await expect(page.getByLabel("Verification code")).toHaveCount(0); await page.getByRole("button", { name: "Send sign-in code" }).click(); await expect(page.getByRole("status")).toContainText("sent"); expect(sent).toBe(true);
  await page.getByLabel("Verification code").fill("123456"); await page.getByRole("button", { name: "Verify and sign in" }).click(); await expect(page).toHaveURL(/\/admin$/);
});
