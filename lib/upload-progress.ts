export type ProgressState = "uploading" | "retry_pending" | "expired";

/**
 * Offset a partir do header Range de uma resposta 308 do Drive ("bytes=0-N").
 * Sem Range, nenhum byte foi persistido e o envio recomeça do zero.
 */
export function confirmedOffsetFromRange(range: string | null): number {
  const match = range?.match(/bytes=0-(\d+)/);
  return match ? Number(match[1]) + 1 : 0;
}

/**
 * Limita o registro de progresso no servidor: mudanças de estado são enviadas
 * na hora; progresso normal, no máximo a cada `intervalMs`. O registro serve
 * para manter a reserva de capacidade viva, não para exibir progresso.
 */
export class ProgressReporter {
  private lastState: ProgressState | null = null;
  private lastSentAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly send: (bytes: number, state: ProgressState) => void,
    private readonly intervalMs = 30_000,
    private readonly now: () => number = () => Date.now()
  ) {}

  report(bytes: number, state: ProgressState): void {
    const time = this.now();
    if (state === this.lastState && time - this.lastSentAt < this.intervalMs) return;
    this.lastState = state;
    this.lastSentAt = time;
    this.send(bytes, state);
  }
}
