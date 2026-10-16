import { timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";

const FLW_BASE = "https://api.flutterwave.com/v3";

export function assertFlutterwaveReady() {
  if (env.FLUTTERWAVE_MODE !== "test") throw new Error("Live payments are disabled in Phase 3");
  if (!env.FLW_SECRET_KEY || !env.FLW_PUBLIC_KEY) throw new Error("Flutterwave test keys are not configured");
  if (!env.FLW_SECRET_KEY.includes("_TEST")) throw new Error("Only Flutterwave TEST MODE secret keys are allowed");
}

export async function createCheckout(payload: { tx_ref: string; amount: number; currency: string; redirect_url: string; customer: { email: string; name: string }; customizations: any }) {
  assertFlutterwaveReady();
  const response = await fetch(`${FLW_BASE}/payments`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.FLW_SECRET_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok || data.status !== "success") throw new Error(data.message ?? "Could not create payment");
  return data.data as { link: string };
}

export async function verifyTransaction(id: string | number) {
  assertFlutterwaveReady();
  const response = await fetch(`${FLW_BASE}/transactions/${id}/verify`, { headers: { Authorization: `Bearer ${env.FLW_SECRET_KEY}` } });
  const data = await response.json();
  if (!response.ok || data.status !== "success") throw new Error(data.message ?? "Could not verify payment");
  return data.data;
}

export function verifyWebhookHash(headerHash?: string) {
  if (!env.FLW_WEBHOOK_HASH) return false;
  if (!headerHash) return false;
  const received = Buffer.from(headerHash), expected = Buffer.from(env.FLW_WEBHOOK_HASH);
  return received.length === expected.length && timingSafeEqual(received, expected);
}
