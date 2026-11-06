import "server-only";
import { createHash } from "node:crypto";
import { database } from "@/lib/db";

export async function allowSessionCreation(key: string): Promise<boolean> {
  const limit = Math.max(1, Number(process.env.SESSION_RATE_LIMIT_PER_MINUTE ?? "120") || 120);
  const keyHash = createHash("sha256").update(`initiate:${key}`).digest("hex");
  const result = await database.query<{ allowed: boolean }>(
    "SELECT consume_rate_limit($1, $2, 60) AS allowed",
    [keyHash, limit]
  );
  return result.rows[0]?.allowed ?? false;
}
