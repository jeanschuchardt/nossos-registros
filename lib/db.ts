import "server-only";
import pg from "pg";

const globalForDatabase = globalThis as typeof globalThis & { databasePool?: pg.Pool };

function connectionString(): string {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL não está configurada.");
  return value;
}

function createPool(): pg.Pool {
  const pool = new pg.Pool({
    connectionString: connectionString(),
    max: 5,
    // O Neon encerra conexões ociosas; liberar antes evita reutilizar uma conexão morta.
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    application_name: "nossos-registros-web"
  });
  // Sem este handler, um cliente ocioso derrubado pelo servidor derruba o processo.
  pool.on("error", (error) => {
    console.warn("Conexão ociosa do banco encerrada", { error: error.message });
  });
  return pool;
}

export const database = globalForDatabase.databasePool ?? createPool();

if (process.env.NODE_ENV !== "production") globalForDatabase.databasePool = database;

const TRANSIENT_MESSAGES = [
  "Connection terminated unexpectedly",
  "Connection terminated due to connection timeout",
  "ECONNRESET",
  "server closed the connection unexpectedly"
];

export function isTransientConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: string }).code;
  return code === "ECONNRESET" || code === "57P01" || TRANSIENT_MESSAGES.some((message) => error.message.includes(message));
}

/** Consulta somente leitura com uma nova tentativa quando a conexão cai. */
export async function readQuery<Row extends pg.QueryResultRow>(text: string, values: unknown[]): Promise<pg.QueryResult<Row>> {
  try {
    return await database.query<Row>(text, values);
  } catch (error) {
    if (!isTransientConnectionError(error)) throw error;
    return database.query<Row>(text, values);
  }
}
