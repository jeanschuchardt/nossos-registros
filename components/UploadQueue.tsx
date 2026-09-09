import { UploadItem } from "@/components/UploadItem";
import { ProgressBar } from "@/components/ProgressBar";
import type { UploadEntry } from "@/types/upload";

export function UploadQueue({ entries, onRetry, onRemove }: { entries: UploadEntry[]; onRetry: (id: string) => void; onRemove: (id: string) => void }) {
  if (!entries.length) return null;
  const completed = entries.filter((entry) => entry.status === "completed").length;
  const overall = entries.reduce((sum, entry) => sum + entry.progress, 0) / entries.length;
  return (
    <section className="queue" aria-label="Arquivos selecionados">
      <h2>Arquivos selecionados</h2>
      <div className="queue-list">
        {entries.map((entry) => <UploadItem key={entry.id} entry={entry} onRetry={() => onRetry(entry.id)} onRemove={() => onRemove(entry.id)} />)}
      </div>
      <div className="overall">
        <div className="file-line"><strong>Progresso geral</strong><span>{Math.round(overall)}%</span></div>
        <ProgressBar value={overall} />
        <p>{completed === entries.length ? `${completed} de ${entries.length} enviados` : `Enviando ${completed + 1} de ${entries.length}`}</p>
      </div>
    </section>
  );
}
