import { LOGIN_FAILURE_WINDOW_MS, LOGIN_MAX_FAILURES } from "@/lib/constants";

const failures = new Map<string, { count: number; resetAt: number }>();
export function loginKey(email: string, ip: string) { return `${email.toLowerCase()}|${ip}`; }
export function isRateLimited(key: string) { const entry = failures.get(key); return !!entry && entry.resetAt > Date.now() && entry.count >= LOGIN_MAX_FAILURES; }
export function recordFailure(key: string) { const current = failures.get(key); const now = Date.now(); const entry = !current || current.resetAt <= now ? { count: 1, resetAt: now + LOGIN_FAILURE_WINDOW_MS } : { ...current, count: current.count + 1 }; failures.set(key, entry); }
export function clearFailures(key: string) { failures.delete(key); }
