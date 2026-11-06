interface EventCoverProps {
  name: string;
  dateLabel: string | null;
  coverUrl: string | null;
  compact?: boolean;
}

/**
 * Capa do evento. Sem foto escolhida pelo contratante, usa a capa padrão
 * (fundo abstrato), que serve para qualquer tipo de evento.
 */
export function EventCover({ name, dateLabel, coverUrl, compact = false }: EventCoverProps) {
  if (compact) {
    return (
      <header className="cover-compact">
        <span className={`cover-thumb${coverUrl ? "" : " cover-default"}`} aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element -- imagem protegida por token, servida pela própria rota */}
          {coverUrl && <img src={coverUrl} alt="" />}
        </span>
        <div>
          <p className="event-name">{name}</p>
          {dateLabel && <p className="event-date">{dateLabel}</p>}
        </div>
      </header>
    );
  }
  return (
    <header className={`cover${coverUrl ? "" : " cover-default"}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- imagem protegida por token, servida pela própria rota */}
      {coverUrl && <img className="cover-image" src={coverUrl} alt="" />}
      <div className="cover-text">
        <h1 className="event-name">{name}</h1>
        {dateLabel && <p className="event-date">{dateLabel}</p>}
      </div>
    </header>
  );
}
