import { describe, expect, it } from "vitest";
import { isPreparationStale, isSessionUsable, matchesOriginalFile } from "./upload-recovery";

describe("recuperação de uploads", () => {
  const now = new Date("2026-11-01T12:05:00Z");

  it("libera uma preparação que ultrapassou o timeout", () => {
    expect(isPreparationStale(new Date("2026-11-01T12:02:59Z"), now, 120_000)).toBe(true);
    expect(isPreparationStale(new Date("2026-11-01T12:04:00Z"), now, 120_000)).toBe(false);
  });

  it("não reutiliza sessão expirada", () => {
    expect(isSessionUsable(new Date("2026-11-01T12:04:59Z"), now)).toBe(false);
    expect(isSessionUsable(new Date("2026-11-01T12:06:00Z"), now)).toBe(true);
    expect(isSessionUsable(null, now)).toBe(true);
  });

  it("reassocia somente o mesmo arquivo original", () => {
    const identity = { filename: "video.mp4", size: 100, lastModified: 123 };
    const same = new File([new Uint8Array(100)], "video.mp4", { type: "video/mp4", lastModified: 123 });
    const changed = new File([new Uint8Array(99)], "video.mp4", { type: "video/mp4", lastModified: 123 });
    expect(matchesOriginalFile(identity, same)).toBe(true);
    expect(matchesOriginalFile(identity, changed)).toBe(false);
  });
});
