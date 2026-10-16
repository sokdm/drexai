import { test } from "node:test";
import assert from "node:assert/strict";
import { env } from "../dist/config/env.js";
import { redisConnection } from "../dist/services/redisConnection.js";
test("Render Redis URL parsing retains TLS, credentials and database without exposing them", () => {
  const previous = env.REDIS_URL;
  try {
    env.REDIS_URL = "rediss://user:p%40ss@redis.example.test:6380/2";
    const connection = redisConnection(true);
    assert.equal(connection.host, "redis.example.test"); assert.equal(connection.port, 6380);
    assert.equal(connection.password, "p@ss"); assert.equal(connection.db, 2); assert.deepEqual(connection.tls, {});
    assert.equal(connection.maxRetriesPerRequest, null); assert.equal(redisConnection(false).maxRetriesPerRequest, 1);
    env.REDIS_URL = "https://redis.example.test"; assert.throws(() => redisConnection());
    env.REDIS_URL = "redis://redis.example.test/not-a-db"; assert.throws(() => redisConnection());
  } finally { env.REDIS_URL = previous; }
});
