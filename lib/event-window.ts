// Janela comercial da V1 (03/11/2026): link disponível 24 h antes do evento e
// envios abertos até 7 dias depois. O Brasil não tem horário de verão desde
// 2019, então São Paulo é sempre UTC-3.
const SAO_PAULO_OFFSET = "-03:00";
const DAY_MS = 24 * 60 * 60 * 1000;

export const DAYS_OPEN_AFTER_EVENT = 7;

export interface UploadWindow {
  eventDate: string;
  startsAt: Date;
  endsAt: Date;
}

export function parseEventDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Use a data no formato AAAA-MM-DD.");
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`Data inválida: ${value}.`);
  }
  return value;
}

/** Início: 00:00 do dia anterior. Fim (exclusivo): 00:00 do 8º dia após o evento. */
export function uploadWindowFor(eventDate: string): UploadWindow {
  const midnight = new Date(`${parseEventDate(eventDate)}T00:00:00${SAO_PAULO_OFFSET}`);
  return {
    eventDate,
    startsAt: new Date(midnight.getTime() - DAY_MS),
    endsAt: new Date(midnight.getTime() + (DAYS_OPEN_AFTER_EVENT + 1) * DAY_MS)
  };
}

export function formatSaoPaulo(date: Date): string {
  return date.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}
