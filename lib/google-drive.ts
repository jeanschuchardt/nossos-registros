import type { FileMetadata } from "@/lib/validation";
import { buildDriveFilename } from "@/lib/filename";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const UPLOAD_ENDPOINT = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name";

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

export async function createResumableSession(metadata: FileMetadata, browserOrigin: string): Promise<{ sessionUrl: string; uploadName: string }> {
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
    body: JSON.stringify({ name: uploadName, parents: [requiredEnv("GOOGLE_DRIVE_FOLDER_ID")] }),
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
