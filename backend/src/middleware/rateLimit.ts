import type { NextFunction, Request, Response } from "express";

export interface RateLimitOptions {
  /** Length of the fixed window, in milliseconds. */
  windowMs: number;
  /** Maximum requests allowed per client key within one window. */
  max: number;
}

/**
 * Minimal fixed-window, per-client-IP rate limiter. In-process on purpose:
 * this app is a single backend container, so there is no shared store to key
 * on. Once a client exceeds `max` within the window it gets a 429 with a
 * generic body (plus Retry-After) and nothing that describes the limit.
 */
export function createRateLimiter({ windowMs, max }: RateLimitOptions) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return function rateLimit(req: Request, res: Response, next: NextFunction): void {
    const now = Date.now();
    const key = req.ip ?? "unknown";

    let entry = hits.get(key);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;

    // Drop expired buckets now and then so a long-running process cannot grow
    // the map without bound.
    if (hits.size > 10_000) {
      for (const [candidate, bucket] of hits) {
        if (now >= bucket.resetAt) hits.delete(candidate);
      }
    }

    if (entry.count > max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSeconds));
      res.status(429).json({ error: "Too many requests" });
      return;
    }

    next();
  };
}
