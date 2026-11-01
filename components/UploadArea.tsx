"use client";

import { ChangeEvent, DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UploadQueue } from "@/components/UploadQueue";
import { uploadFileToDrive } from "@/lib/upload";
import { ACCEPT_ATTRIBUTE } from "@/lib/validation";
import type { UploadEntry } from "@/types/upload";

const CONCURRENCY = 2;
const allowedExtensions = new Set(["jpg", "jpeg", "png", "webp", "heic", "heif", "mp4", "mov"]);

function clientValidation(file: File): string | null {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!allowedExtensions.has(extension)) return `${file.name}: formato não permitido.`;
  return null;
}

export function UploadArea({ eventSlug, maxFileSizeGb }: { eventSlug: string; maxFileSizeGb: number }) {
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const [selectionError, setSelectionError] = useState("");
  const active = useRef(new Map<string, AbortController>());
  const inputRef = useRef<HTMLInputElement>(null);

  const update = useCallback((id: string, values: Partial<UploadEntry>) => {
    setEntries((current) => current.map((entry) => entry.id === id ? { ...entry, ...values } : entry));
  }, []);

  const runUpload = useCallback(async (entry: UploadEntry) => {
    const controller = new AbortController();
    active.current.set(entry.id, controller);
    update(entry.id, { status: "creating-session", error: undefined });
    try {
      await uploadFileToDrive(entry.file, eventSlug, entry.id, controller.signal,
        (bytes) => update(entry.id, { uploadedBytes: bytes, progress: bytes / entry.file.size * 100, status: "uploading" }),
        () => update(entry.id, { status: "retrying" })
      );
      update(entry.id, { uploadedBytes: entry.file.size, progress: 100, status: "completed" });
    } catch (error) {
      if (controller.signal.aborted) update(entry.id, { status: "cancelled", error: "Upload cancelado." });
      else update(entry.id, { status: "failed", error: error instanceof Error ? error.message : "Falha inesperada." });
    } finally { active.current.delete(entry.id); }
  }, [eventSlug, update]);

  useEffect(() => {
    const running = entries.filter((entry) => ["creating-session", "uploading", "retrying"].includes(entry.status)).length;
    const next = entries.filter((entry) => entry.status === "queued").slice(0, Math.max(0, CONCURRENCY - running));
    next.forEach((entry) => void runUpload(entry));
  }, [entries, runUpload]);

  useEffect(() => () => {
    active.current.forEach((controller) => controller.abort());
    entries.forEach((entry) => entry.previewUrl && URL.revokeObjectURL(entry.previewUrl));
  }, []); // entries are intentionally captured only for unmount cleanup

  const validate = (file: File) => {
    const typeError = clientValidation(file);
    if (typeError) return typeError;
    if (!file.size || file.size > maxFileSizeGb * 1024 ** 3) return `${file.name}: arquivo vazio ou acima de ${maxFileSizeGb} GB.`;
    return null;
  };
  const addFiles = (files: File[]) => {
    const errors = files.map(validate).filter(Boolean);
    const valid = files.filter((file) => !validate(file));
    setSelectionError(errors.join(" "));
    setEntries((current) => [...current, ...valid.map((file) => ({
      id: crypto.randomUUID(), file, progress: 0, uploadedBytes: 0, status: "queued" as const,
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined
    }))]);
  };

  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  };
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    addFiles(Array.from(event.dataTransfer.files));
  };
  const remove = (id: string) => setEntries((current) => {
    const found = current.find((entry) => entry.id === id);
    if (found?.previewUrl) URL.revokeObjectURL(found.previewUrl);
    return current.filter((entry) => entry.id !== id);
  });
  const retry = (id: string) => update(id, { status: "queued", progress: 0, uploadedBytes: 0, error: undefined });
  const allDone = useMemo(() => entries.length > 0 && entries.every((entry) => entry.status === "completed"), [entries]);
  const startOver = () => {
    entries.forEach((entry) => entry.previewUrl && URL.revokeObjectURL(entry.previewUrl));
    setEntries([]); setSelectionError("");
  };

  return (
    <>
      {!allDone && <div className="drop-zone" onDrop={handleDrop} onDragOver={(event) => event.preventDefault()}>
        <input ref={inputRef} className="sr-only" id="files" type="file" multiple accept={ACCEPT_ATTRIBUTE} onChange={handleInput} />
        <button className="primary-button" type="button" onClick={() => inputRef.current?.click()}>Adicionar fotos e vídeos</button>
        <p>ou arraste aqui</p>
        <small>JPG, PNG, WebP, HEIC/HEIF, MP4 e MOV</small>
        <small className="screen-warning">Para vídeos grandes, mantenha esta tela aberta e o celular desbloqueado.</small>
      </div>}
      {selectionError && <p className="page-error" role="alert">{selectionError}</p>}
      <UploadQueue entries={entries} onRetry={retry} onRemove={remove} />
      {allDone && <section className="success" aria-live="polite"><div className="check">✓</div><h2>Arquivos enviados!</h2><p>Obrigado por compartilhar<br />esse momento com a gente.</p><button className="primary-button" onClick={startOver}>Enviar mais fotos</button></section>}
    </>
  );
}
