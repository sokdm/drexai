import dotenv from "dotenv";
import Redis from "ioredis";
dotenv.config({ path: ".env", quiet: true });
dotenv.config({ path: "../.env", quiet: true });
const configured = key => !!process.env[key]?.trim();
for (const [label, keys] of [
  ["MongoDB", ["MONGODB_URI"]], ["Gemini", ["GEMINI_API_KEY"]],
  ["Private R2", ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]],
  ["Email delivery", ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "EMAIL_FROM"]], ["Talking avatars", ["HEYGEN_API_KEY", "AVATAR_PRESENTERS_JSON"]]
]) { const missing = keys.filter(key => !configured(key)); console.log(`${label}: ${missing.length ? "missing " + missing.join(", ") : "configuration present (not provider-verified)"}`); }
if (!configured("REDIS_URL")) { console.log("Redis: REDIS_URL is missing. Queue flags have not been changed."); process.exitCode = 1; }
else {
  let redis;
  try {
    const url = new URL(process.env.REDIS_URL);
    if (!["redis:", "rediss:"].includes(url.protocol)) throw new Error("unsupported scheme");
    redis = new Redis(process.env.REDIS_URL, { lazyConnect: true, connectTimeout: 5000, maxRetriesPerRequest: 1, retryStrategy: () => null });
    redis.on("error", () => {});
    await redis.connect(); const pong = await redis.ping();
    if (pong !== "PONG") throw new Error("unexpected response");
    console.log("Redis: connection verified (PING/PONG).");
    try { const result = await redis.config("GET", "maxmemory-policy"); console.log("Redis eviction policy: " + result[1] + (result[1] !== "noeviction" ? " — set noeviction before queue use." : "")); } catch { console.log("Redis eviction policy: provider restricts inspection; verify noeviction in its dashboard."); }
  } catch { console.log("Redis: connection failed. Check URL, TLS, network access and provider availability. Credentials are not printed."); process.exitCode = 1; }
  finally { redis?.disconnect(); }
}
for (const key of ["IMAGE_QUEUE_ENABLED", "STUDIO_QUEUE_ENABLED", "RENDER_QUEUE_ENABLED"]) console.log(`${key}: ${process.env[key] === "true" ? "enabled" : "disabled"}`);
