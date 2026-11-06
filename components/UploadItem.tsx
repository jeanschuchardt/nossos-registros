import { ProgressBar } from "@/components/ProgressBar";
import type { UploadEntry } from "@/types/upload";

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const labels = {
  queued: "Na fila",
  "creating-session": "Preparando…",
  uploading: "Enviando",
  retrying: "Reconectando…",
  "needs-file": "Selecione novamente",
  completed: "Enviado ✓",
  failed: "Falhou",
  cancelled: "Cancelado"
};

export function UploadItem({ entry, onRetry, onRemove }: { entry: UploadEntry; onRetry: () => void; onRemove: () => void }) {
  return (
    <article className="upload-item">
      {entry.previewUrl ? <img className="thumbnail" src={entry.previewUrl} alt="" /> : <div className="video-icon" aria-hidden>▶</div>}
      <div className="upload-info">
        <div className="file-line"><span className="filename" title={entry.filename}>{entry.filename}</span><span>{Math.round(entry.progress)}%</span></div>
        <div className="file-meta"><span>{formatBytes(entry.size)}</span><span className={`status status-${entry.status}`}>{labels[entry.status]}</span></div>
        <ProgressBar value={entry.progress} />
        {entry.error && <p className="item-error" role="alert">{entry.error}</p>}
        <div className="item-actions">
          {entry.status === "failed" && <button type="button" className="text-button" onClick={onRetry}>Tentar novamente</button>}
          {(entry.status === "queued" || entry.status === "failed" || entry.status === "needs-file") && <button type="button" className="text-button muted" onClick={onRemove}>Remover</button>}
        </div>
      </div>
    </article>
  );
}
