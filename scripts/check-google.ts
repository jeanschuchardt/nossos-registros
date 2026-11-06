import pg from "pg";

const required = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REFRESH_TOKEN"
] as const;

for (const name of required) {
  if (!process.env[name]) {
    console.error(`ERRO: variável ${name} ausente ou vazia.`);
    process.exit(1);
  }
}

async function checkGoogle(): Promise<void> {
const slugIndex = process.argv.indexOf("--slug");
const slug = slugIndex >= 0 ? process.argv[slugIndex + 1] : undefined;
if (!slug) throw new Error("Use --slug <slug-do-evento>.");
const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("Defina DATABASE_URL_UNPOOLED ou DATABASE_URL.");
const client = new pg.Client({ connectionString, application_name: "nossos-registros-check-google" });
await client.connect();
const eventResult = await client.query<{ drive_folder_id: string }>(
  "SELECT drive_folder_id FROM events WHERE slug = $1",
  [slug]
);
await client.end();
const event = eventResult.rows[0];
if (!event) throw new Error("Evento não encontrado.");

const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN!,
    grant_type: "refresh_token"
  })
});

const tokenBody = (await tokenResponse.json().catch(() => ({}))) as {
  access_token?: string;
  error?: string;
  error_description?: string;
};

if (!tokenResponse.ok || !tokenBody.access_token) {
  const reason = tokenBody.error ?? `HTTP ${tokenResponse.status}`;
  console.error(`ERRO: não foi possível renovar o token (${reason}).`);
  if (reason === "invalid_grant") {
    console.error("O refresh token expirou ou foi revogado. Gere um novo token e confirme que o app OAuth está em Production.");
  }
  process.exit(1);
}

console.log("OK: refresh token válido; access token renovado.");

const folderId = encodeURIComponent(event.drive_folder_id);
const folderResponse = await fetch(
  `https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name,mimeType,trashed&supportsAllDrives=true`,
  { headers: { Authorization: `Bearer ${tokenBody.access_token}` } }
);
const folderBody = (await folderResponse.json().catch(() => ({}))) as {
  name?: string;
  mimeType?: string;
  trashed?: boolean;
  error?: { message?: string };
};

if (!folderResponse.ok) {
  console.error(`ERRO: a pasta não está acessível (${folderResponse.status}): ${folderBody.error?.message ?? "resposta desconhecida"}`);
  process.exit(1);
}
if (folderBody.mimeType !== "application/vnd.google-apps.folder" || folderBody.trashed) {
  console.error("ERRO: a pasta configurada para o evento não está ativa.");
  process.exit(1);
}

console.log(`OK: pasta do Drive acessível (${folderBody.name ?? "sem nome"}).`);
}

checkGoogle().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "erro desconhecido";
  console.error(`ERRO: falha de rede ao acessar o Google (${message}).`);
  process.exit(1);
});
