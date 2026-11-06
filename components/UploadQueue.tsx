import { UploadItem } from "@/components/UploadItem";
import { ProgressBar } from "@/components/ProgressBar";
import type { UploadEntry } from "@/types/upload";

const RUNNING = new Set(["creating-session", "uploading", "retrying"]);

export function UploadQueue({ entries, onRetry, onRemove, onCancel, onClear }: {
  entries: UploadEntry[];
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
  onCancel: (id: string) => void;
  onClear: () => void;
}) {
  if (!entries.length) return null;
  const completed = entries.filter((entry) => entry.status === "completed").length;
  const overall = entries.reduce((sum, entry) => sum + entry.progress, 0) / entries.length;
  const needsFile = entries.some((entry) => entry.status === "needs-file");
  const clearable = entries.some((entry) => !RUNNING.has(entry.status));
  return (
    <section className="queue" aria-label="Arquivos selecionados">
      <div className="queue-header">
        <h2>Arquivos selecionados</h2>
        {clearable && <button type="button" className="text-button muted" onClick={onClear}>Limpar lista</button>}
      </div>
      <div className="queue-list">
        {entries.map((entry) => <UploadItem key={entry.id} entry={entry} onRetry={() => onRetry(entry.id)} onRemove={() => onRemove(entry.id)} onCancel={() => onCancel(entry.id)} />)}
      </div>
      <div className="overall">
        <div className="file-line"><strong>Progresso geral</strong><span>{Math.round(overall)}%</span></div>
        <ProgressBar value={overall} />
        <p>{needsFile ? "Selecione novamente os arquivos indicados para retomar." : completed === entries.length ? `${completed} de ${entries.length} enviados` : `Enviando ${Math.min(completed + 1, entries.length)} de ${entries.length}`}</p>
      </div>
    </section>
  );
}
