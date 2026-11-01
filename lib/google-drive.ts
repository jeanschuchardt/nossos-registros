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

async function getAccessToken(): Promise<string> {
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
  if (!response.ok) throw new Error(`Falha ao renovar token Google (${response.status}).`);
  const json = (await response.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("Google não retornou um access token.");
  return json.access_token;
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
    if (!response.ok) throw new Error(`Não foi possível verificar o arquivo no Drive (${response.status}).`);
    return assertDriveFile((await response.json()) as DriveFile, expected);
  }

  const escapedName = expected.driveFilename.replace(/['\\]/g, "\\$&");
  const query = `name = '${escapedName}' and '${expected.driveFolderId}' in parents and trashed = false`;
  const response = await fetch(
    `${DRIVE_FILES_ENDPOINT}?q=${encodeURIComponent(query)}&fields=files(id,name,size,mimeType,parents,trashed)&pageSize=2`,
    { headers, cache: "no-store" }
  );
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
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`Drive recusou a sessão (${response.status}): ${detail}`);
  }
  const sessionUrl = response.headers.get("location");
  if (!sessionUrl) throw new Error("Drive não retornou a URL da sessão.");
  return { sessionUrl, uploadName };
}
