import { createHash, createHmac, randomBytes } from "node:crypto";
import { env } from "../config/env.js";

export function createOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function signToken(value: string) {
  return createHmac("sha256", env.SESSION_SECRET).update(value).digest("hex");
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("hex");
}
