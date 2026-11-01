import "server-only";
import pg from "pg";

const globalForDatabase = globalThis as typeof globalThis & { databasePool?: pg.Pool };

function connectionString(): string {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL não está configurada.");
  return value;
}

export const database = globalForDatabase.databasePool ?? new pg.Pool({
  connectionString: connectionString(),
  max: 5,
  idleTimeoutMillis: 20_000,
  connectionTimeoutMillis: 10_000,
  application_name: "nossos-registros-web"
});

if (process.env.NODE_ENV !== "production") globalForDatabase.databasePool = database;
