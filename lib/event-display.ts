const MONTHS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"
];

/** "2026-11-21" → "21 de novembro de 2026". Sem fuso: é a data civil do evento. */
export function formatEventDate(eventDate: string | null): string | null {
  const match = eventDate?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const month = MONTHS[Number(match[2]) - 1];
  return month ? `${Number(match[3])} de ${month} de ${match[1]}` : null;
}

export function coverUrl(slug: string, key: string, version: number | null): string | null {
  if (version === null) return null;
  const params = new URLSearchParams({ k: key, v: String(version) });
  return `/e/${encodeURIComponent(slug)}/cover?${params}`;
}

export interface EventDisplay {
  slug: string;
  accessKey: string;
  name: string;
  dateLabel: string | null;
  coverUrl: string | null;
  maxFileSizeBytes: number;
}
