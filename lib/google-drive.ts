import type { FileMetadata } from "@/lib/validation";
import { buildDriveFilename } from "@/lib/filename";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const DRIVE_FILES_ENDPOINT = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_ENDPOINT = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,mimeType,parents";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variável de ambiente ausente: ${name}`);
  return value;
}

export class GoogleAuthError extends Error {}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function requestAccessToken(): Promise<{ value: string; expiresAt: number }> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requiredEnv("GOOGLE_CLIENT_ID"),
      client_secret: requiredEnv("GOOGLE_CLIENT_SECRET"),
      refresh_token: requiredEnv("GOOGLE_REFRESH_TOKEN"),
      grant_type: "refresh_token"
    }),
    cache: "no-store"
  });
  const json = (await response.json().catch(() => ({}))) as {
    access_token?: string; expires_in?: number; error?: string;
  };
  if (!response.ok || !json.access_token) {
    // invalid_grant = refresh token revogado/expirado: exige ação manual, não adianta repetir.
    const reason = json.error ?? `HTTP ${response.status}`;
    if (reason === "invalid_grant") {
      console.error("ALERTA: refresh token do Google inválido; gere um novo token (npm run check:google).");
      throw new GoogleAuthError("Falha ao renovar token Google (invalid_grant).");
    }
    throw new Error(`Falha ao renovar token Google (${reason}).`);
  }
  const lifetimeMs = Math.max(60, json.expires_in ?? 3600) * 1000;
  return { value: json.access_token, expiresAt: Date.now() + lifetimeMs };
}

async function getAccessToken(): Promise<string> {
  // Reaproveita o token entre requisições na mesma instância, com 5 min de folga.
  if (cachedToken && cachedToken.expiresAt - 5 * 60_000 > Date.now()) return cachedToken.value;
  try {
    cachedToken = await requestAccessToken();
  } catch (error) {
    if (error instanceof GoogleAuthError) throw error;
    // Uma nova tentativa para falhas transitórias de rede ou 5xx do Google.
    await new Promise((resolve) => setTimeout(resolve, 300));
    cachedToken = await requestAccessToken();
  }
  return cachedToken.value;
}

function forgetTokenOn401(response: Response): void {
  if (response.status === 401) cachedToken = null;
}

interface DriveFile {
  id: string;
  name: string;
  size?: string;
  mimeType?: string;
  parents?: string[];
  trashed?: boolean;
}

export interface ExpectedDriveFile {
  driveFilename: string;
  driveFolderId: string;
  mimeType: string;
  sizeBytes: number;
}

function assertDriveFile(file: DriveFile, expected: ExpectedDriveFile): DriveFile {
  if (file.trashed || file.name !== expected.driveFilename
    || Number(file.size) !== expected.sizeBytes
    || file.mimeType !== expected.mimeType
    || !file.parents?.includes(expected.driveFolderId)) {
    throw new Error("O arquivo no Drive não corresponde ao upload esperado.");
  }
  return file;
}

export async function verifyDriveFile(fileId: string | undefined, expected: ExpectedDriveFile): Promise<DriveFile> {
  const accessToken = await getAccessToken();
  const headers = { Authorization: `Bearer ${accessToken}` };
  if (fileId) {
    const response = await fetch(
      `${DRIVE_FILES_ENDPOINT}/${encodeURIComponent(fileId)}?fields=id,name,size,mimeType,parents,trashed`,
      { headers, cache: "no-store" }
    );
    forgetTokenOn401(response);
    if (!response.ok) throw new Error(`Não foi possível verificar o arquivo no Drive (${response.status}).`);
    return assertDriveFile((await response.json()) as DriveFile, expected);
  }

  const escapedName = expected.driveFilename.replace(/['\\]/g, "\\$&");
  const query = `name = '${escapedName}' and '${expected.driveFolderId}' in parents and trashed = false`;
  const response = await fetch(
    `${DRIVE_FILES_ENDPOINT}?q=${encodeURIComponent(query)}&fields=files(id,name,size,mimeType,parents,trashed)&pageSize=2`,
    { headers, cache: "no-store" }
  );
  forgetTokenOn401(response);
  if (!response.ok) throw new Error(`Não foi possível reconciliar o arquivo no Drive (${response.status}).`);
  const body = (await response.json()) as { files?: DriveFile[] };
  if (body.files?.length !== 1) throw new Error("O arquivo concluído ainda não foi localizado no Drive.");
  return assertDriveFile(body.files[0], expected);
}

export async function createResumableSession(metadata: FileMetadata, browserOrigin: string, driveFolderId: string): Promise<{ sessionUrl: string; uploadName: string }> {
  const accessToken = await getAccessToken();
  const uploadName = buildDriveFilename(metadata.filename);
  const response = await fetch(UPLOAD_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Origin: browserOrigin,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": metadata.mimeType,
      "X-Upload-Content-Length": String(metadata.size)
    },
    body: JSON.stringify({ name: uploadName, parents: [driveFolderId] }),
    cache: "no-store"
  });
  forgetTokenOn401(response);
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`Drive recusou a sessão (${response.status}): ${detail}`);
  }
  const sessionUrl = response.headers.get("location");
  if (!sessionUrl) throw new Error("Drive não retornou a URL da sessão.");
  return { sessionUrl, uploadName };
}
