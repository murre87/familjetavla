/** Lampor som inte får tändas på natten (t.ex. ett barns rum): Tänd alla / Tänd inne hoppar över dem. */
export interface QuietLights {
  entities: string[];
  /** "18:00" – från och med. */
  from: string;
  /** "08:00" – till (klockslaget då det är tillåtet igen). */
  to: string;
}

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** True inside the quiet hours; works across midnight (18:00 → 08:00). */
export function isQuietNow(q: QuietLights | undefined, now: Date): boolean {
  if (!q || !q.entities.length) return false;
  const t = now.getHours() * 60 + now.getMinutes();
  const from = minutes(q.from);
  const to = minutes(q.to);
  if (from === to) return false;
  return from < to ? t >= from && t < to : t >= from || t < to;
}

/** The lamps that may be switched ON now: all, except the quiet ones during quiet hours. */
export function allowedToTurnOn(entityIds: string[], q: QuietLights | undefined, now: Date): string[] {
  if (!isQuietNow(q, now)) return entityIds;
  const quiet = new Set(q!.entities);
  return entityIds.filter((id) => !quiet.has(id));
}
