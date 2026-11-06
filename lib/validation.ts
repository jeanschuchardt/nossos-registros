// Regras de arquivos da V1 (decisão de 03/11/2026). Compartilhado entre
// navegador e servidor; o servidor é quem decide.
const MB = 1024 ** 2;
const GB = 1024 ** 3;

export const PHOTO_MAX_BYTES = 50 * MB;
export const VIDEO_MAX_BYTES = 5 * GB;

type Kind = "photo" | "video";

interface FileRule {
  kind: Kind;
  /** MIME gravado no Drive e no banco. */
  mime: string;
  /** MIMEs que navegadores costumam informar para a extensão. */
  accepted: readonly string[];
}

const RULES = {
  ".jpg": { kind: "photo", mime: "image/jpeg", accepted: ["image/jpeg", "image/pjpeg"] },
  ".jpeg": { kind: "photo", mime: "image/jpeg", accepted: ["image/jpeg", "image/pjpeg"] },
  ".png": { kind: "photo", mime: "image/png", accepted: ["image/png"] },
  ".webp": { kind: "photo", mime: "image/webp", accepted: ["image/webp"] },
  ".heic": { kind: "photo", mime: "image/heic", accepted: ["image/heic", "image/heic-sequence"] },
  ".heif": { kind: "photo", mime: "image/heif", accepted: ["image/heif", "image/heif-sequence"] },
  ".mp4": { kind: "video", mime: "video/mp4", accepted: ["video/mp4"] },
  ".mov": { kind: "video", mime: "video/quicktime", accepted: ["video/quicktime"] },
  ".m4v": { kind: "video", mime: "video/x-m4v", accepted: ["video/x-m4v", "video/mp4"] }
} as const satisfies Record<string, FileRule>;

type Extension = keyof typeof RULES;

export const ACCEPT_ATTRIBUTE = Object.keys(RULES).join(",");
export const ACCEPTED_FORMATS_LABEL = "Fotos JPG, PNG, WebP e HEIC até 50 MB · Vídeos MP4, MOV e M4V até 5 GB";

export interface FileMetadata {
  filename: string;
  mimeType: string;
  size: number;
}

function extensionOf(filename: string): Extension | undefined {
  const extension = filename.toLowerCase().match(/\.[a-z0-9]+$/)?.[0];
  return extension && extension in RULES ? (extension as Extension) : undefined;
}

function formatLimit(bytes: number): string {
  return bytes >= GB ? `${Math.round(bytes / GB * 10) / 10} GB` : `${Math.round(bytes / MB)} MB`;
}

export function maxBytesFor(kind: Kind, eventMaxBytes = Number.POSITIVE_INFINITY): number {
  return Math.min(kind === "photo" ? PHOTO_MAX_BYTES : VIDEO_MAX_BYTES, eventMaxBytes);
}

export function validateFileMetadata(value: unknown, eventMaxBytes = Number.POSITIVE_INFINITY):
  | { ok: true; value: FileMetadata }
  | { ok: false; error: string } {
  if (!value || typeof value !== "object") return { ok: false, error: "Dados inválidos." };
  const input = value as Record<string, unknown>;
  const filename = typeof input.filename === "string" ? input.filename.trim() : "";
  const mimeType = typeof input.mimeType === "string" ? input.mimeType.toLowerCase().trim() : "";
  const size = input.size;
  const extension = extensionOf(filename);

  if (!filename || filename.length > 255 || !extension) {
    return { ok: false, error: `${filename || "Arquivo"}: formato não permitido.` };
  }
  const rule: FileRule = RULES[extension];
  const limit = maxBytesFor(rule.kind, eventMaxBytes);
  if (!Number.isSafeInteger(size) || (size as number) <= 0) {
    return { ok: false, error: `${filename}: arquivo vazio ou inválido.` };
  }
  if ((size as number) > limit) {
    const label = rule.kind === "photo" ? "fotos" : "vídeos";
    return { ok: false, error: `${filename}: ${label} podem ter até ${formatLimit(limit)}.` };
  }
  // iOS/Safari pode omitir o MIME de HEIC/MOV; nesse caso vale a extensão.
  if (mimeType && !rule.accepted.includes(mimeType)) {
    return { ok: false, error: `${filename}: o tipo do arquivo não corresponde à extensão.` };
  }
  return { ok: true, value: { filename, mimeType: rule.mime, size: size as number } };
}
