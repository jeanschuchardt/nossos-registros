import "server-only";
import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { database } from "@/lib/db";

export type RateLimitScope = "initiate" | "progress" | "confirm";

// Por minuto e por IP. Um local de evento com Wi-Fi compartilhado coloca muitos
// convidados atrás do mesmo IP, então os limites são generosos; o token do
// evento é a barreira principal contra uso indevido.
function limitFor(scope: RateLimitScope): number {
  const configured = Number(process.env.SESSION_RATE_LIMIT_PER_MINUTE ?? "120") || 120;
  const base = Math.max(1, configured);
  if (scope === "initiate") return base;
  if (scope === "confirm") return base * 2;
  return base * 5;
}

export function clientKey(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export function clientKeyHash(request: NextRequest): string {
  return createHash("sha256").update(`client:${clientKey(request)}`).digest("hex");
}

export async function consumeRateLimit(scope: RateLimitScope, request: NextRequest): Promise<boolean> {
  const keyHash = createHash("sha256").update(`${scope}:${clientKey(request)}`).digest("hex");
  const result = await database.query<{ allowed: boolean }>(
    "SELECT consume_rate_limit($1, $2, 60) AS allowed",
    [keyHash, limitFor(scope)]
  );
  // Limpeza amortizada: sem job agendado, a tabela não cresce indefinidamente.
  if (Math.random() < 0.01) {
    void database.query("DELETE FROM rate_limit_windows WHERE reset_at < now() - interval '1 hour'")
      .catch(() => undefined);
  }
  return result.rows[0]?.allowed ?? false;
}
