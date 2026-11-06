import { ProgressBar } from "@/components/ProgressBar";
import type { UploadEntry } from "@/types/upload";

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1).replace(".", ",")} GB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

const labels: Record<UploadEntry["status"], string> = {
  queued: "Na fila",
  "creating-session": "Preparando…",
  uploading: "Enviando",
  retrying: "Reconectando…",
  "needs-file": "Selecione de novo",
  completed: "Enviado",
  failed: "Não enviado",
  cancelled: "Cancelado"
};

const RUNNING = new Set(["creating-session", "uploading", "retrying"]);

export function UploadItem({ entry, onRetry, onRemove, onCancel }: {
  entry: UploadEntry; onRetry: () => void; onRemove: () => void; onCancel: () => void;
}) {
  const isVideo = entry.mimeType.startsWith("video/");
  const showPercent = RUNNING.has(entry.status);
  return (
    <article className={`upload-item status-${entry.status}`}>
      <span className="upload-thumb" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element -- miniatura local (blob:), fora do next/image */}
        {entry.previewUrl ? <img src={entry.previewUrl} alt="" /> : <span className="thumb-icon">{isVideo ? "▶" : "◻"}</span>}
        {entry.status === "completed" && <span className="thumb-check">✓</span>}
      </span>
      <div className="upload-info">
        <div className="upload-line">
          <span className="filename" title={entry.filename}>{entry.filename}</span>
          <span className="upload-state">{showPercent ? `${Math.round(entry.progress)}%` : labels[entry.status]}</span>
        </div>
        <div className="upload-meta">
          <span>{formatBytes(entry.size)}</span>
          {showPercent && <span>{labels[entry.status]}</span>}
        </div>
        {entry.status !== "completed" && <ProgressBar value={entry.progress} />}
        {entry.error && <p className="item-error" role="alert">{entry.error}</p>}
        <div className="item-actions">
          {(entry.status === "failed" || entry.status === "cancelled") && entry.file && <button type="button" className="link-button" onClick={onRetry}>Tentar novamente</button>}
          {RUNNING.has(entry.status) && <button type="button" className="link-button muted" onClick={onCancel}>Cancelar</button>}
          {(entry.status === "queued" || entry.status === "failed" || entry.status === "needs-file" || entry.status === "cancelled") && <button type="button" className="link-button muted" onClick={onRemove}>Remover</button>}
        </div>
      </div>
    </article>
  );
}
