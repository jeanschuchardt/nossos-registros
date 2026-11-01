export type EventStatus = "draft" | "active" | "closed" | "archived";
export type EventAvailability = "available" | "draft" | "closed" | "not_started" | "ended";

interface AvailabilityInput {
  status: EventStatus;
  uploadStartsAt: Date | null;
  uploadEndsAt: Date | null;
}

export function eventAvailability(event: AvailabilityInput, now = new Date()): EventAvailability {
  if (event.status === "draft") return "draft";
  if (event.status !== "active") return "closed";
  if (event.uploadStartsAt && now < event.uploadStartsAt) return "not_started";
  if (event.uploadEndsAt && now >= event.uploadEndsAt) return "ended";
  return "available";
}
