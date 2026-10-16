import { env } from "../config/env.js";
export function redisConnection(worker = false) {
  const url = new URL(env.REDIS_URL);
  if (!["redis:", "rediss:"].includes(url.protocol)) throw new Error("REDIS_URL must use redis:// or rediss://");
  const db = Number(url.pathname.slice(1) || 0);
  if (!Number.isInteger(db) || db < 0) throw new Error("Invalid Redis database number");
  return { host: url.hostname, port: Number(url.port || 6379), username: decodeURIComponent(url.username) || undefined, password: decodeURIComponent(url.password) || undefined, db, ...(url.protocol === "rediss:" ? { tls: {} } : {}), maxRetriesPerRequest: worker ? null : 1, connectTimeout: 5000 };
}
