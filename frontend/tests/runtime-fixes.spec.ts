import { test, expect } from "@playwright/test";
async function setup(page: any) {
  const state = { balance: 250, failScript: false };
  await page.route("**/api/**", (route: any) => {
    const path = new URL(route.request().url()).pathname;
    let data: any = {};
    if (path === "/api/auth/me") data = { user: { id: "customer", displayName: "Customer", email: "customer@example.test", status: "active", emailVerified: true, onboarding: { completed: true } } };
    else if (path === "/api/wallet") data = { wallet: { availableCredits: state.balance, reservedCredits: 0 }, packages: [], ledger: [], payments: [] };
    else if (path === "/api/ai/niches") data = { niches: [] };
    else if (path === "/api/ai/quote") data = { quote: { allowed: true, credits: 1 } };
    else if (path === "/api/ai/scripts/generate") return route.fulfill({ status: 503, json: { error: "Gemini is temporarily unavailable. Please try again." } });
    return route.fulfill({ json: data });
  }); return state;
}
test("dashboard uses the real wallet and refreshes administrator credits", async ({ page }) => {
  const state = await setup(page); await page.goto("/dashboard");
  await expect(page.getByLabel("Available credit balance")).toHaveText("250");
  state.balance = 1250; await page.getByRole("button", { name: "Refresh balance", exact: true }).click();
  await expect(page.getByLabel("Available credit balance")).toHaveText("1,250");
  await page.getByRole("link", { name: "Open wallet", exact: true }).click();
  await expect(page.getByText("1250", { exact: true })).toBeVisible();
  state.balance = 1500; await page.getByRole("button", { name: "Refresh balance", exact: true }).click();
  await expect(page.getByText("1500", { exact: true })).toBeVisible();
});
test("script generation failure stops loading and shows the backend error", async ({ page }) => {
  await setup(page); await page.goto("/dashboard/script-builder");
  await page.getByRole("button", { name: "Generate structured script" }).click();
  await expect(page.getByRole("alert")).toContainText("Gemini is temporarily unavailable");
  await expect(page.getByRole("button", { name: "Generate structured script" })).toBeEnabled();
  await expect(page.getByText("Gemini is planning scenes", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Your script appears here" })).toBeVisible();
});
