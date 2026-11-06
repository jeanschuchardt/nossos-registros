"use client";

import { ChangeEvent, DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EventCover } from "@/components/EventCover";
import { UploadQueue } from "@/components/UploadQueue";
import type { EventDisplay } from "@/lib/event-display";
import { uploadFileToDrive, type EventAccess } from "@/lib/upload";
import { ACCEPT_ATTRIBUTE, validateFileMetadata } from "@/lib/validation";
import { forgetUpload, rememberUpload, restoreUploads } from "@/lib/upload-queue-store";
import { matchesOriginalFile } from "@/lib/upload-recovery";
import type { UploadEntry } from "@/types/upload";

const CONCURRENCY = 2;
const RUNNING = new Set<UploadEntry["status"]>(["creating-session", "uploading", "retrying"]);

export function UploadArea({ event }: { event: EventDisplay }) {
  const { slug: eventSlug, accessKey: eventKey, maxFileSizeBytes } = event;
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const [selectionError, setSelectionError] = useState("");
  const [autoResumed, setAutoResumed] = useState(0);
  const active = useRef(new Map<string, AbortController>());
  const inputRef = useRef<HTMLInputElement>(null);
  const entriesRef = useRef(entries);
  useEffect(() => { entriesRef.current = entries; }, [entries]);
  const access = useMemo<EventAccess>(() => ({ slug: eventSlug, key: eventKey }), [eventSlug, eventKey]);

  const update = useCallback((id: string, values: Partial<UploadEntry>) => {
    setEntries((current) => current.map((entry) => entry.id === id ? { ...entry, ...values } : entry));
  }, []);

  const runUpload = useCallback(async (entry: UploadEntry) => {
    if (!entry.file) return;
    const file = entry.file;
    const controller = new AbortController();
    active.current.set(entry.id, controller);
    update(entry.id, { status: "creating-session", error: undefined });
    try {
      await uploadFileToDrive(file, access, entry.id, controller.signal,
        (bytes) => update(entry.id, { uploadedBytes: bytes, progress: bytes / file.size * 100, status: "uploading" }),
        () => update(entry.id, { status: "retrying" })
      );
      update(entry.id, { uploadedBytes: file.size, progress: 100, status: "completed" });
      void forgetUpload(entry.id);
    } catch (error) {
      if (controller.signal.aborted) {
        update(entry.id, { status: "cancelled", error: "Envio cancelado." });
        void forgetUpload(entry.id);
      }
      else update(entry.id, { status: "failed", error: error instanceof Error ? error.message : "Falha inesperada." });
    } finally { active.current.delete(entry.id); }
  }, [access, update]);

  useEffect(() => {
    let cancelled = false;
    void restoreUploads(eventSlug).then((stored) => {
      if (cancelled) return;
      if (entriesRef.current.length || !stored.length) return;
      // Com cópia guardada, o envio volta para a fila sozinho; sem cópia, pede o arquivo.
      setAutoResumed(stored.filter((entry) => entry.file).length);
      const restored = stored.map((entry): UploadEntry => ({
        id: entry.id,
        file: entry.file,
        filename: entry.filename,
        size: entry.size,
        mimeType: entry.mimeType,
        lastModified: entry.lastModified,
        previewUrl: entry.file && entry.mimeType.startsWith("image/") ? URL.createObjectURL(entry.file) : undefined,
        progress: 0,
        uploadedBytes: 0,
        status: entry.file ? "queued" : "needs-file"
        }));
      setEntries((current) => current.length ? current : restored);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [eventSlug]);

  useEffect(() => {
    const running = entries.filter((entry) => RUNNING.has(entry.status)).length;
    const next = entries.filter((entry) => entry.status === "queued").slice(0, Math.max(0, CONCURRENCY - running));
    next.forEach((entry) => void runUpload(entry));
  }, [entries, runUpload]);

  // Avisa antes de fechar a aba ou recarregar enquanto houver envio pendente.
  const hasPendingWork = entries.some((entry) => entry.status === "queued" || RUNNING.has(entry.status));
  useEffect(() => {
    if (!hasPendingWork) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasPendingWork]);

  useEffect(() => {
    const controllers = active.current;
    return () => {
      controllers.forEach((controller) => controller.abort());
      // Lê a lista atual pelo ref; capturar `entries` aqui pegaria a lista vazia inicial.
      entriesRef.current.forEach((entry) => entry.previewUrl && URL.revokeObjectURL(entry.previewUrl));
    };
  }, []);

  const validate = (file: File) => {
    const result = validateFileMetadata({ filename: file.name, mimeType: file.type, size: file.size }, maxFileSizeBytes);
    return result.ok ? null : result.error;
  };
  const addFiles = (files: File[]) => {
    const errors = files.map(validate).filter(Boolean);
    const valid = files.filter((file) => !validate(file));
    setSelectionError(errors.join(" "));
    setEntries((current) => {
      const next = [...current];
      for (const file of valid) {
        const restoredIndex = next.findIndex((entry) => entry.status === "needs-file"
          && matchesOriginalFile(entry, file));
        if (restoredIndex >= 0) {
          next[restoredIndex] = {
            ...next[restoredIndex], file, mimeType: file.type, status: "queued", error: undefined,
            previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined
          };
          continue;
        }
        const entry: UploadEntry = {
          id: crypto.randomUUID(), file, filename: file.name, size: file.size,
          mimeType: file.type, lastModified: file.lastModified,
          progress: 0, uploadedBytes: 0, status: "queued",
          previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined
        };
        next.push(entry);
        void rememberUpload(entry, eventSlug);
      }
      return next;
    });
  };

  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  };
  // No computador, arquivos podem ser soltos em qualquer ponto da página.
  const handleDrop = (dropEvent: DragEvent<HTMLElement>) => {
    dropEvent.preventDefault();
    addFiles(Array.from(dropEvent.dataTransfer.files));
  };
  const chooseFiles = () => inputRef.current?.click();
  // Remove da tela e do IndexedDB; uploads em andamento nunca são removidos por aqui.
  const removeWhere = (predicate: (entry: UploadEntry) => boolean) => setEntries((current) => current.filter((entry) => {
    if (RUNNING.has(entry.status) || !predicate(entry)) return true;
    if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
    void forgetUpload(entry.id);
    return false;
  }));
  const remove = (id: string) => removeWhere((entry) => entry.id === id);
  const cancel = (id: string) => active.current.get(id)?.abort();
  const discardPending = () => removeWhere((entry) => entry.status === "needs-file");
  const clearList = () => { removeWhere(() => true); setSelectionError(""); setAutoResumed(0); };
  const pendingCount = entries.filter((entry) => entry.status === "needs-file").length;
  const retry = (id: string) => update(id, { status: "queued", progress: 0, uploadedBytes: 0, error: undefined });
  const allDone = useMemo(() => entries.length > 0 && entries.every((entry) => entry.status === "completed"), [entries]);
  const startOver = () => {
    entries.forEach((entry) => entry.previewUrl && URL.revokeObjectURL(entry.previewUrl));
    setEntries([]); setSelectionError("");
  };

  const cover = { name: event.name, dateLabel: event.dateLabel, coverUrl: event.coverUrl };
  const input = <input ref={inputRef} className="sr-only" id="files" type="file" multiple accept={ACCEPT_ATTRIBUTE} onChange={handleInput} />;
  const notices = (
    <>
      {pendingCount > 0 && (
        <section className="notice" role="status">
          <p>
            <strong>{pendingCount === 1 ? "1 envio não terminou." : `${pendingCount} envios não terminaram.`}</strong>{" "}
            {autoResumed > 0 && `Retomamos ${autoResumed} automaticamente. `}
            Para continuar de onde parou, selecione os mesmos arquivos de novo.
          </p>
          <div className="notice-actions">
            <button type="button" className="link-button" onClick={chooseFiles}>Selecionar arquivos</button>
            <button type="button" className="link-button muted" onClick={discardPending}>Descartar</button>
          </div>
        </section>
      )}
      {autoResumed > 0 && pendingCount === 0 && (
        <p className="notice" role="status">
          {autoResumed === 1 ? "Retomamos 1 envio que não tinha terminado." : `Retomamos ${autoResumed} envios que não tinham terminado.`}
        </p>
      )}
      {selectionError && <p className="notice notice-error" role="alert">{selectionError}</p>}
    </>
  );

  let content;
  if (entries.length === 0) {
    // Abertura: capa grande, mensagem e um único botão no alcance do polegar.
    content = (
      <>
        <EventCover {...cover} />
        <section className="panel welcome">
          <p className="welcome-message">Cada convidado viu esse dia de um jeito. Compartilhe o seu.</p>
          {notices}
          <div className="welcome-actions">
            <button className="primary-button" type="button" onClick={chooseFiles}>Enviar fotos e vídeos</button>
            <p className="fine-print">Sem cadastro · fotos até 50 MB · vídeos até 5 GB</p>
            <p className="fine-print drop-hint">ou arraste os arquivos para esta janela</p>
          </div>
        </section>
      </>
    );
  } else if (allDone) {
    content = (
      <>
        <EventCover {...cover} compact />
        <section className="panel success" aria-live="polite">
          <span className="success-check" aria-hidden="true">✓</span>
          <h2>{entries.length === 1 ? "Seu arquivo foi enviado" : `Seus ${entries.length} arquivos foram enviados`}</h2>
          <p>Obrigado por fazer parte de {event.name}.</p>
          <button className="primary-button" type="button" onClick={() => { startOver(); chooseFiles(); }}>Enviar mais fotos e vídeos</button>
        </section>
      </>
    );
  } else {
    content = (
      <>
        <EventCover {...cover} compact />
        <section className="panel queue-panel">
          {notices}
          <UploadQueue entries={entries} onRetry={retry} onRemove={remove} onCancel={cancel} onClear={clearList} onAdd={chooseFiles} />
        </section>
      </>
    );
  }

  return (
    <main className="event" onDrop={handleDrop} onDragOver={(dragEvent) => dragEvent.preventDefault()}>
      {/* Fica montado em todos os estados: "Enviar mais" abre o seletor durante a troca de tela. */}
      {input}
      {content}
    </main>
  );
}
