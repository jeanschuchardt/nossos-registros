import { UsageError } from "./cli";

export async function googleAccessToken(): Promise<string> {
  for (const name of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"]) {
    if (!process.env[name]) throw new UsageError(`variável ${name} ausente ou vazia.`);
  }
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN!,
      grant_type: "refresh_token"
    })
  });
  const body = (await response.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!response.ok || !body.access_token) {
    const reason = body.error ?? `HTTP ${response.status}`;
    const hint = reason === "invalid_grant"
      ? " O refresh token expirou ou foi revogado. Gere um novo token e confirme que o app OAuth está em Production."
      : "";
    throw new UsageError(`não foi possível renovar o token do Google (${reason}).${hint}`);
  }
  return body.access_token;
}

/** Confere se a pasta existe, é uma pasta e não está na lixeira. Retorna o nome. */
export async function assertDriveFolder(accessToken: string, folderId: string): Promise<string> {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=id,name,mimeType,trashed&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const body = (await response.json().catch(() => ({}))) as {
    name?: string; mimeType?: string; trashed?: boolean; error?: { message?: string };
  };
  if (!response.ok) {
    throw new UsageError(`a pasta ${folderId} não está acessível (${response.status}): ${body.error?.message ?? "resposta desconhecida"}. `
      + "Com o escopo drive.file, o app só enxerga pastas que ele mesmo criou; omita --folder-id para criar uma.");
  }
  if (body.mimeType !== "application/vnd.google-apps.folder" || body.trashed) {
    throw new UsageError(`o ID ${folderId} não é uma pasta ativa no Drive.`);
  }
  return body.name ?? "sem nome";
}

/** Cria a pasta do evento pelo próprio app, o que garante acesso com o escopo drive.file. */
export async function createDriveFolder(accessToken: string, name: string, parentId?: string): Promise<string> {
  const response = await fetch("https://www.googleapis.com/drive/v3/files?fields=id,name&supportsAllDrives=true", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      ...(parentId ? { parents: [parentId] } : {})
    })
  });
  const body = (await response.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (!response.ok || !body.id) {
    throw new UsageError(`não foi possível criar a pasta no Drive (${response.status}): ${body.error?.message ?? "resposta desconhecida"}.`);
  }
  return body.id;
}
