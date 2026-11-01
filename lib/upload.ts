import type { InitiateUploadResponse } from "@/types/upload";

// 16 MiB = 64 * 256 KiB, as required by Drive for non-final chunks.
export const CHUNK_SIZE = 16 * 1024 * 1024;
const MAX_RETRIES = 5;

export class UploadError extends Error {}

async function initiate(file: File, eventSlug: string, idempotencyKey: string, signal: AbortSignal): Promise<InitiateUploadResponse> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch("/api/upload/initiate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Event-Slug": eventSlug },
      body: JSON.stringify({ filename: file.name, mimeType: file.type, size: file.size, idempotencyKey }),
      signal
    });
    const result = (await response.json().catch(() => ({}))) as Partial<InitiateUploadResponse> & { error?: string; retryable?: boolean };
    if (response.status === 409 && result.retryable && attempt < 4) {
      await delay(500 * (attempt + 1), signal);
      continue;
    }
    if (!response.ok || !result.uploadId) throw new UploadError(result.error ?? "Falha ao preparar o envio.");
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
    // Avoid an indefinitely stuck request after a mobile network transition.
    xhr.timeout = 5 * 60_000;
    xhr.setRequestHeader("Content-Range", `bytes ${start}-${end - 1}/${file.size}`);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    // Bytes sent are not yet bytes confirmed by Drive. Reserve 100% for 200/201.
    xhr.upload.onprogress = (event) => onProgress(Math.min(start + event.loaded, Math.floor(file.size * 0.99)));
    xhr.onload = () => resolve({ status: xhr.status, range: xhr.getResponseHeader("Range"), body: xhr.responseText });
    xhr.onerror = () => reject(new UploadError("Conexão interrompida."));
    xhr.ontimeout = () => reject(new UploadError("O chunk demorou demais; verificando o ponto de retomada."));
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
  if (response.status === 404) throw new UploadError("A sessão expirou. Tente enviar novamente.");
  if (response.status !== 308) throw new UploadError(`Não foi possível recuperar o upload (${response.status}).`);
  const match = response.headers.get("Range")?.match(/bytes=0-(\d+)/);
  return { offset: match ? Number(match[1]) + 1 : 0 };
}

async function confirmUpload(uploadId: string, eventSlug: string, driveFileId: string | undefined, signal: AbortSignal): Promise<void> {
  const response = await fetch(`/api/upload/${encodeURIComponent(uploadId)}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Event-Slug": eventSlug },
    body: JSON.stringify({ driveFileId }),
    signal
  });
  const result = (await response.json().catch(() => ({}))) as { error?: string; completed?: boolean };
  if (!response.ok || !result.completed) {
    throw new UploadError(result.error ?? "Não foi possível confirmar o arquivo enviado.");
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { window.clearTimeout(timer); reject(new DOMException("Cancelado", "AbortError")); }, { once: true });
  });
}

export async function uploadFileToDrive(
  file: File,
  eventSlug: string,
  idempotencyKey: string,
  signal: AbortSignal,
  onProgress: (uploadedBytes: number) => void,
  onRetry: () => void
): Promise<void> {
  const prepared = await initiate(file, eventSlug, idempotencyKey, signal);
  if (prepared.completed) { onProgress(file.size); return; }
  if (prepared.awaitingConfirmation) {
    await confirmUpload(prepared.uploadId, eventSlug, undefined, signal);
    onProgress(file.size);
    return;
  }
  const sessionUrl = prepared.sessionUrl!;
  let offset = 0;
  let retries = 0;

  while (offset < file.size) {
    try {
      const result = await requestChunk(sessionUrl, file, offset, signal, onProgress);
      if (result.status === 200 || result.status === 201) {
        const body = (() => { try { return JSON.parse(result.body) as { id?: string }; } catch { return {}; } })();
        await confirmUpload(prepared.uploadId, eventSlug, body.id, signal);
        onProgress(file.size);
        return;
      }
      if (result.status === 308) {
        const confirmed = result.range?.match(/bytes=0-(\d+)/);
        offset = confirmed ? Number(confirmed[1]) + 1 : Math.min(offset + CHUNK_SIZE, file.size);
        onProgress(offset);
        retries = 0;
        continue;
      }
      if (result.status === 404) throw new UploadError("A sessão expirou. Tente enviar novamente.");
      if (result.status < 500 && result.status !== 429) throw new UploadError(`Upload recusado (${result.status}).`);
      throw new UploadError(`Falha temporária (${result.status}).`);
    } catch (error) {
      if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
      if (error instanceof UploadError && /expirou|recusado/.test(error.message)) throw error;
      if (retries >= MAX_RETRIES) throw new UploadError("A conexão continuou instável. Toque em tentar novamente.");
      retries += 1;
      onRetry();
      await delay(Math.min(1000 * 2 ** (retries - 1), 16_000) + Math.random() * 500, signal);
      try {
        const recovered = await queryOffset(sessionUrl, file.size, signal);
        offset = recovered.offset;
        onProgress(offset);
        if (offset === file.size) {
          await confirmUpload(prepared.uploadId, eventSlug, recovered.driveFileId, signal);
          onProgress(file.size);
          return;
        }
      } catch (statusError) {
        if (statusError instanceof UploadError && /expirou/.test(statusError.message)) throw statusError;
        // Keep the last confirmed offset and retry after another backoff.
      }
    }
  }

  await confirmUpload(prepared.uploadId, eventSlug, undefined, signal);
  onProgress(file.size);
}
