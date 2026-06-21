import { createClient } from "redis";

let client = null;

export async function connectRedis() {
  if (client) return client;

  client = createClient({
    url: process.env.REDIS_URL || "redis://localhost:6379",
  });

  // Log whether REDIS_URL is set for easier debugging
  console.log("REDIS_URL exists:", !!process.env.REDIS_URL);

  client.on("error", (err) => {
    console.warn("Redis connection error (caching disabled):", err.message);
  });

  client.on("connect", () => {
    console.log("Redis connected");
  });

  try {
    await client.connect();
  } catch (err) {
    console.warn("Redis unavailable — running without cache");
    client = null;
  }

  return client;
}

export function getRedis() {
  return client;
}

/**
 * Get cached value by key. Returns null if Redis is down or key missing.
 */
export async function cacheGet(key) {
  if (!client) return null;
  try {
    const data = await client.get(key);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

/**
 * Set cached value with optional TTL (seconds). No-op if Redis is down.
 */
export async function cacheSet(key, value, ttl = 300) {
  if (!client) return;
  try {
    await client.setEx(key, ttl, JSON.stringify(value));
  } catch {
    // silently ignore cache failures
  }
}

/**
 * Delete one or more cache keys. No-op if Redis is down.
 */
export async function cacheDel(...keys) {
  if (!client || keys.length === 0) return;
  try {
    await client.del(keys);
  } catch {
    // silently ignore
  }
}

/**
 * Invalidate all product-related cache keys
 * (called when a product is created/updated/deleted).
 */
export async function invalidateProductCache() {
  if (!client) return;
  try {
    // Scan and delete all keys matching product:* pattern
    let cursor = 0;
    do {
      const result = await client.scan(cursor, {
        match: "product:*",
        count: 50,
      });
      cursor = result.cursor;
      if (result.keys.length > 0) {
        await client.del(result.keys);
      }
    } while (cursor !== 0);
  } catch {
    // silently ignore
  }
}

/**
 * Cache product query result — keyed by a hash of all query params.
 */
export function productCacheKey(params) {
  const q = params || {};
  return `product:${JSON.stringify({
    s: q.search || "",
    c: q.category || "",
    min: q.min || "",
    max: q.max || "",
    p: q.page || 1,
    l: q.limit || 6,
  })}`;
}

/**
 * Blacklist a JWT token until it naturally expires.
 * Used during logout to invalidate tokens before expiry.
 */
export async function blacklistToken(token, ttlSeconds) {
  if (!client) return;
  try {
    await client.setEx(`bl:${token}`, ttlSeconds, "1");
  } catch {
    // silently ignore
  }
}

/**
 * Check if a token has been blacklisted.
 */
export async function isTokenBlacklisted(token) {
  if (!client) return false;
  try {
    const result = await client.get(`bl:${token}`);
    return result === "1";
  } catch {
    return false;
  }
}
