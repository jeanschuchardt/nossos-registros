const windows = new Map<string, { count: number; resetAt: number }>();

export function allowSessionCreation(key: string): boolean {
  const now = Date.now();
  const limit = Math.max(1, Number(process.env.SESSION_RATE_LIMIT_PER_MINUTE ?? "120") || 120);
  const current = windows.get(key);
  if (!current || current.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  if (windows.size > 5_000) {
    for (const [entryKey, value] of windows) if (value.resetAt <= now) windows.delete(entryKey);
  }
  return true;
}
