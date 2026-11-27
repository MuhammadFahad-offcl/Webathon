/**
 * In-memory sliding-window rate limiter (same idea as Member 1's login limiter, but a real
 * sliding window and configurable, so tests can shrink the limit). Per server instance:
 * good enough for a single deployment; a shared store would be needed when scaling out.
 */

export type RateLimiterOptions = { limit: number; windowMs: number; now?: () => number };
export type RateLimitResult = { allowed: true; remaining: number } | { allowed: false; retryAfterMs: number };

/** Above this many tracked keys, idle keys are swept so memory stays bounded. */
const SWEEP_THRESHOLD = 5_000;

export function createRateLimiter(options: RateLimiterOptions) {
  let { limit, windowMs } = options;
  const now = options.now ?? Date.now;
  const hits = new Map<string, number[]>();

  function sweep(cutoff: number) {
    for (const [key, times] of hits) if (!times.length || times[times.length - 1] <= cutoff) hits.delete(key);
  }

  return {
    /** Records one request for `key`; refuses it once `limit` requests fall inside the window. */
    hit(key: string): RateLimitResult {
      const t = now();
      const cutoff = t - windowMs;
      if (hits.size > SWEEP_THRESHOLD) sweep(cutoff);
      const times = (hits.get(key) ?? []).filter((time) => time > cutoff);
      if (times.length >= limit) {
        hits.set(key, times);
        return { allowed: false, retryAfterMs: Math.max(0, times[0] + windowMs - t) };
      }
      times.push(t);
      hits.set(key, times);
      return { allowed: true, remaining: limit - times.length };
    },
    configure(next: { limit?: number; windowMs?: number }) {
      limit = next.limit ?? limit;
      windowMs = next.windowMs ?? windowMs;
    },
    reset() {
      hits.clear();
    },
  };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;

/** Client IP as seen by the platform proxy (first `x-forwarded-for` hop), else "unknown". */
export function clientIp(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}
