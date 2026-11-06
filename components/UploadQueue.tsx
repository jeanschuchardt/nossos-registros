import { UploadItem } from "@/components/UploadItem";
import { ProgressBar } from "@/components/ProgressBar";
import type { UploadEntry } from "@/types/upload";

const RUNNING = new Set(["creating-session", "uploading", "retrying"]);

export function UploadQueue({ entries, onRetry, onRemove, onCancel, onClear, onAdd }: {
  entries: UploadEntry[];
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
  onCancel: (id: string) => void;
  onClear: () => void;
  onAdd: () => void;
}) {
  if (!entries.length) return null;
  const completed = entries.filter((entry) => entry.status === "completed").length;
  const overall = entries.reduce((sum, entry) => sum + entry.progress, 0) / entries.length;
  const clearable = entries.some((entry) => !RUNNING.has(entry.status));
  const sendingVideo = entries.some((entry) => RUNNING.has(entry.status) && entry.mimeType.startsWith("video/"));

  return (
    <>
      <section className="queue" aria-label="Seus envios">
        <div className="queue-header">
          <h2>Seus envios</h2>
          {clearable && <button type="button" className="link-button muted" onClick={onClear}>Limpar lista</button>}
        </div>
        <div className="queue-list">
          {entries.map((entry) => (
            <UploadItem key={entry.id} entry={entry}
              onRetry={() => onRetry(entry.id)} onRemove={() => onRemove(entry.id)} onCancel={() => onCancel(entry.id)} />
          ))}
        </div>
      </section>
      <div className="dock">
        <div className="dock-summary">
          <span>{completed} de {entries.length} enviados</span>
          <span className="tabular">{Math.round(overall)}%</span>
        </div>
        <ProgressBar value={overall} />
        {sendingVideo && <p className="fine-print">Vídeos grandes: mantenha esta tela aberta e o celular desbloqueado.</p>}
        <button type="button" className="secondary-button" onClick={onAdd}>+ Adicionar mais</button>
      </div>
    </>
  );
}
