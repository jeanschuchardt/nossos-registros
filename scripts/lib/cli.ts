import pg from "pg";

/** Lê argumentos no formato --chave valor. Flags sem valor viram "true". */
export function parseArgs(argv = process.argv.slice(2)): Map<string, string> {
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      args.set(token.slice(2), next);
      index += 1;
    } else {
      args.set(token.slice(2), "true");
    }
  }
  return args;
}

export class UsageError extends Error {}

export function databaseClient(applicationName: string): pg.Client {
  const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!connectionString) throw new UsageError("Defina DATABASE_URL_UNPOOLED ou DATABASE_URL.");
  return new pg.Client({ connectionString, application_name: applicationName });
}

export function siteUrl(): string {
  const value = process.env.NEXT_PUBLIC_SITE_URL;
  if (!value) throw new UsageError("Defina NEXT_PUBLIC_SITE_URL.");
  return value;
}

export function eventUrl(slug: string, accessToken: string): string {
  const url = new URL(`/e/${slug}`, siteUrl());
  url.searchParams.set("k", accessToken);
  return url.toString();
}

export async function run(task: () => Promise<void>, failurePrefix: string): Promise<void> {
  try {
    await task();
  } catch (error) {
    const message = error instanceof Error ? error.message : "erro desconhecido";
    console.error(`ERRO: ${error instanceof UsageError ? message : `${failurePrefix}: ${message}`}`);
    process.exitCode = 1;
  }
}
