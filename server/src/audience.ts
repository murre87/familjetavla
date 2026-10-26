import type { Person } from "./types.js";

/**
 * Vem en kalenderhändelse gäller, som en lista med personnamn.
 *  1. Kalenderns ägare (personId) och/eller flera personer (personIds: "Gäller" Emil + Elin).
 *  2. För delade kalendrar (utan ägare): personer vars förnamn nämns i titeln eller beskrivningen
 *     ("Elin tandläkare", "Alicia och Esther kommer"). Hela ord, versalkänsligt, minst 3 tecken.
 * Tom lista = hela familjen.
 */
export function audience(
  ev: { personId?: string; personIds?: string[]; title: string; description?: string },
  people: Map<string, Pick<Person, "id" | "name">>,
): string[] {
  const out: string[] = [];
  const add = (n: string | undefined) => {
    if (n && !out.includes(n)) out.push(n);
  };
  if (ev.personId) add(people.get(ev.personId)?.name);
  for (const id of ev.personIds ?? []) add(people.get(id)?.name);
  if (out.length === 0) {
    const text = `${ev.title} ${ev.description ?? ""}`;
    for (const p of people.values()) {
      const first = p.name.trim().split(/\s+/)[0] ?? "";
      if (first.length < 3) continue;
      const esc = first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`(^|[^\\p{L}])${esc}(?![\\p{L}])`, "iu").test(text)) add(p.name);
    }
  }
  return out;
}
