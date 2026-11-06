import type { InitiateUploadResponse } from "@/types/upload";
import { confirmedOffsetFromRange, ProgressReporter } from "@/lib/upload-progress";

// 16 MiB = 64 * 256 KiB, como o Drive exige para chunks não finais.
export const CHUNK_SIZE = 16 * 1024 * 1024;
const MAX_RETRIES = 5;

export class UploadError extends Error {
  constructor(message: string, readonly permanent = false) { super(message); }
}
class SessionExpiredError extends UploadError {}

export interface EventAccess {
  slug: string;
  key: string;
}

async function initiate(file: File, access: EventAccess, idempotencyKey: string, signal: AbortSignal): Promise<InitiateUploadResponse> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch("/api/upload/initiate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Event-Slug": access.slug, "X-Event-Key": access.key },
      body: JSON.stringify({ filename: file.name, mimeType: file.type, size: file.size, idempotencyKey }),
      signal
    });
    const result = (await response.json().catch(() => ({}))) as Partial<InitiateUploadResponse> & {
      error?: string; retryable?: boolean; capacityExceeded?: boolean;
    };
    if (response.status === 409 && result.retryable && attempt < 4) {
      await delay(500 * (attempt + 1), signal);
      continue;
    }
    if (!response.ok || !result.uploadId || !result.uploadToken) {
      // Erros 4xx (exceto 429) não melhoram com nova tentativa automática.
      const permanent = response.status >= 400 && response.status < 500 && response.status !== 429;
      throw new UploadError(result.error ?? "Falha ao preparar o envio.", permanent);
    }
    if (!result.completed && !result.awaitingConfirmation && !result.sessionUrl) {
      throw new UploadError("O servidor não retornou uma sessão de upload.");
    }
    return result as InitiateUploadResponse;
  }
  throw new UploadError("A preparação do upload demorou mais que o esperado.");
}

function requestChunk(
  sessionUrl: string,
  file: File,
  start: number,
  signal: AbortSignal,
  onProgress: (bytes: number) => void
): Promise<{ status: number; range: string | null; body: string }> {
  const end = Math.min(start + CHUNK_SIZE, file.size);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", sessionUrl);
    // Evita uma requisição presa indefinidamente após troca de rede no celular.
    xhr.timeout = 5 * 60_000;
    xhr.setRequestHeader("Content-Range", `bytes ${start}-${end - 1}/${file.size}`);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    // Bytes enviados ainda não são bytes confirmados pelo Drive; 100% só com 200/201.
    xhr.upload.onprogress = (event) => onProgress(Math.min(start + event.loaded, Math.floor(file.size * 0.99)));
    xhr.onload = () => resolve({ status: xhr.status, range: xhr.getResponseHeader("Range"), body: xhr.responseText });
    xhr.onerror = () => reject(new UploadError("Conexão interrompida."));
    xhr.ontimeout = () => reject(new UploadError("O envio demorou demais; verificando o ponto de retomada."));
    xhr.onabort = () => reject(new DOMException("Upload cancelado", "AbortError"));
    const abort = () => xhr.abort();
    signal.addEventListener("abort", abort, { once: true });
    xhr.onloadend = () => signal.removeEventListener("abort", abort);
    xhr.send(file.slice(start, end));
  });
}

async function queryOffset(sessionUrl: string, total: number, signal: AbortSignal): Promise<{ offset: number; driveFileId?: string }> {
  const response = await fetch(sessionUrl, {
    method: "PUT",
    headers: { "Content-Range": `bytes */${total}` },
    signal
  });
  if (response.ok) {
    const body = (await response.json().catch(() => ({}))) as { id?: string };
    return { offset: total, driveFileId: body.id };
  }
  if (response.status === 404 || response.status === 410) throw new SessionExpiredError("A sessão expirou. Tente enviar novamente.");
  if (response.status !== 308) throw new UploadError(`Não foi possível recuperar o upload (${response.status}).`);
  return { offset: confirmedOffsetFromRange(response.headers.get("Range")) };
}

async function confirmUpload(uploadId: string, uploadToken: string, driveFileId: string | undefined, signal: AbortSignal): Promise<void> {
  const response = await fetch(`/api/upload/${encodeURIComponent(uploadId)}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Upload-Token": uploadToken },
    body: JSON.stringify({ driveFileId }),
    signal
  });
  const result = (await response.json().catch(() => ({}))) as { error?: string; completed?: boolean };
  if (!response.ok || !result.completed) {
    throw new UploadError(result.error ?? "Não foi possível confirmar o arquivo enviado.");
  }
}

/** A confirmação consulta o Drive; logo após o último chunk ele pode ainda não listar o arquivo. */
async function confirmWithRetry(uploadId: string, uploadToken: string, driveFileId: string | undefined, signal: AbortSignal): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await confirmUpload(uploadId, uploadToken, driveFileId, signal);
      return;
    } catch (error) {
      if (signal.aborted || attempt >= 3) throw error;
      await delay(1500 * (attempt + 1), signal);
    }
  }
}

function sendProgress(uploadId: string, uploadToken: string, confirmedBytes: number, state: "uploading" | "retry_pending" | "expired"): void {
  // Telemetria sem await: o Drive é a fonte do offset e o envio não espera a Vercel.
  void fetch(`/api/upload/${encodeURIComponent(uploadId)}/progress`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "X-Upload-Token": uploadToken },
    body: JSON.stringify({ confirmedBytes, state }),
    keepalive: true
  }).catch(() => undefined);
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { window.clearTimeout(timer); reject(new DOMException("Cancelado", "AbortError")); }, { once: true });
  });
}

export async function uploadFileToDrive(
  file: File,
  access: EventAccess,
  idempotencyKey: string,
  signal: AbortSignal,
  onProgress: (uploadedBytes: number) => void,
  onRetry: () => void
): Promise<void> {
  const prepared = await initiate(file, access, idempotencyKey, signal);
  const { uploadId, uploadToken } = prepared;
  if (prepared.completed) { onProgress(file.size); return; }
  if (prepared.awaitingConfirmation) {
    await confirmWithRetry(uploadId, uploadToken, undefined, signal);
    onProgress(file.size);
    return;
  }
  const sessionUrl = prepared.sessionUrl!;
  const reporter = new ProgressReporter((bytes, state) => sendProgress(uploadId, uploadToken, bytes, state));

  let offset: number;
  try {
    const initial = await queryOffset(sessionUrl, file.size, signal);
    if (initial.offset === file.size) {
      await confirmWithRetry(uploadId, uploadToken, initial.driveFileId, signal);
      onProgress(file.size);
      return;
    }
    offset = initial.offset;
  } catch (error) {
    if (error instanceof SessionExpiredError) reporter.report(0, "expired");
    throw error;
  }
  let retries = 0;
  onProgress(offset);
  reporter.report(offset, "uploading");

  while (offset < file.size) {
    try {
      const result = await requestChunk(sessionUrl, file, offset, signal, onProgress);
      if (result.status === 200 || result.status === 201) {
        const body = (() => { try { return JSON.parse(result.body) as { id?: string }; } catch { return {}; } })();
        await confirmWithRetry(uploadId, uploadToken, body.id, signal);
        onProgress(file.size);
        return;
      }
      if (result.status === 308) {
        // Sem Range, o Drive não guardou nenhum byte: recomeça do zero.
        offset = confirmedOffsetFromRange(result.range);
        onProgress(offset);
        reporter.report(offset, "uploading");
        retries = 0;
        continue;
      }
      if (result.status === 404 || result.status === 410) throw new SessionExpiredError("A sessão expirou. Tente enviar novamente.");
      if (result.status < 500 && result.status !== 429) throw new UploadError(`Upload recusado (${result.status}).`, true);
      throw new UploadError(`Falha temporária (${result.status}).`);
    } catch (error) {
      if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
      if (error instanceof SessionExpiredError) {
        reporter.report(offset, "expired");
        throw error;
      }
      if (error instanceof UploadError && error.permanent) throw error;
      if (retries >= MAX_RETRIES) throw new UploadError("A conexão continuou instável. Toque em tentar novamente.");
      retries += 1;
      onRetry();
      reporter.report(offset, "retry_pending");
      await delay(Math.min(1000 * 2 ** (retries - 1), 16_000) + Math.random() * 500, signal);
      try {
        const recovered = await queryOffset(sessionUrl, file.size, signal);
        offset = recovered.offset;
        onProgress(offset);
        reporter.report(offset, "uploading");
        if (offset === file.size) {
          await confirmWithRetry(uploadId, uploadToken, recovered.driveFileId, signal);
          onProgress(file.size);
          return;
        }
      } catch (statusError) {
        if (statusError instanceof SessionExpiredError) {
          reporter.report(offset, "expired");
          throw statusError;
        }
        // Mantém o último offset confirmado e tenta de novo após outro backoff.
      }
    }
  }

  await confirmWithRetry(uploadId, uploadToken, undefined, signal);
  onProgress(file.size);
}
